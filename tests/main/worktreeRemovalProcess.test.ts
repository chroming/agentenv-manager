import * as cp from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { removeWorktreeContents, WorktreeRemovalCancelledError } from "../../src/main/worktrees/worktreeRemovalProcess";

vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>() }));
let root = "";
const children: cp.ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    const closed = new Promise((done) => child.once("close", done)); child.kill("SIGKILL"); await closed;
  }
  if (root) await rm(root, { recursive: true, force: true }); root = "";
});
const fixture = async () => {
  root = await mkdtemp(join(tmpdir(), "aem-removal-process-"));
  const path = join(root, "files"); await mkdir(path);
  await writeFile(join(path, "first.txt"), "first"); await writeFile(join(path, "remaining.txt"), "remaining");
  const identity = await lstat(path, { bigint: true });
  return { path, device: String(identity.dev), inode: String(identity.ino) };
};

it("removes only the pinned directory and waits for the cleanup process to exit", async () => {
  const request = await fixture();
  const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "keep.txt"), "keep");
  await symlink(outside, join(request.path, "outside"), process.platform === "win32" ? "junction" : "dir");
  const original = cp.fork;
  vi.spyOn(cp, "fork").mockImplementation((...args: Parameters<typeof cp.fork>) => { const child = original(...args); children.push(child); return child; });
  await removeWorktreeContents(request, new AbortController().signal);
  await expect(lstat(request.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
  expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true);
});

it("terminates an actually pending child before returning cancellation, preserving remaining contents", async () => {
  const request = await fixture(), hook = join(root, "hold-removal.cjs");
  await writeFile(hook, `const fs = require("node:fs/promises");
fs.rm = async (path) => { await fs.unlink(require("node:path").join(path, "first.txt")); await new Promise(() => {}); };\n`);
  const original = cp.fork;
  vi.spyOn(cp, "fork").mockImplementation((modulePath, args, options) => {
    const child = original(modulePath, args as string[], { ...options, execArgv: ["--require", hook] }); children.push(child); return child;
  });
  const controller = new AbortController();
  const pending = removeWorktreeContents(request, controller.signal);
  const rejected = expect(pending).rejects.toBeInstanceOf(WorktreeRemovalCancelledError);
  await vi.waitFor(async () => expect(await lstat(join(request.path, "first.txt")).catch(() => undefined)).toBeUndefined());
  controller.abort(); await rejected;
  expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true);
  expect(await readFile(join(request.path, "remaining.txt"), "utf8")).toBe("remaining");
});

it("rejects changed directory identities before deleting contents", async () => {
  const request = await fixture();
  await expect(removeWorktreeContents({ ...request, inode: "0" }, new AbortController().signal)).rejects.toThrow("identity changed");
  expect(await readFile(join(request.path, "first.txt"), "utf8")).toBe("first");
});

it("times out an unresponsive cleanup, waits for forced exit and retains its remainder", async () => {
  const request = await fixture(), hook = join(root, "timeout-removal.cjs");
  await writeFile(hook, `const fs = require("node:fs/promises");
process.on("SIGTERM", () => {});
console.error("fixture filesystem wait");
fs.rm = async (path) => { await fs.unlink(require("node:path").join(path, "first.txt")); await new Promise(() => {}); };\n`);
  const original = cp.fork;
  vi.spyOn(cp, "fork").mockImplementation((modulePath, args, options) => {
    const child = original(modulePath, args as string[], { ...options, execArgv: ["--require", hook] }); children.push(child); return child;
  });
  const controller = new AbortController();
  const outcome = removeWorktreeContents(request, controller.signal, { timeoutMs: 500 }).catch((error: Error) => error);
  try {
    await vi.waitFor(() => expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true), { timeout: 2000 });
    expect(await outcome).toMatchObject({ name: "WorktreeRemovalTimeoutError" });
    expect(await outcome).toMatchObject({ diagnostics: {
      stage: "removing", exitConfirmed: true, forceKillRequested: true,
      elapsedMs: expect.any(Number), pid: expect.any(Number), stderr: expect.stringContaining("fixture filesystem wait")
    } });
    expect(await readFile(join(request.path, "remaining.txt"), "utf8")).toBe("remaining");
  } finally { controller.abort(); await outcome; }
});

it("reports the actual worker stages without treating progress messages as completion", async () => {
  const request = await fixture(), snapshots: Array<{ stage: string; exitConfirmed?: boolean }> = [];
  await removeWorktreeContents(request, undefined, { onDiagnostic: (value) => snapshots.push(value) });
  expect(snapshots.map((value) => value.stage)).toEqual(["starting", "spawned", "ready", "validating", "removing", "completed", "completed"]);
  expect(snapshots.at(-1)?.exitConfirmed).toBe(true);
  await expect(lstat(request.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("distinguishes a worker that never reaches its request handler", async () => {
  const request = await fixture(), hook = join(root, "unready-worker.mjs");
  await writeFile(hook, 'process.on("message", () => {}); setInterval(() => {}, 1000);\n');
  const original = cp.fork;
  vi.spyOn(cp, "fork").mockImplementation((_modulePath, args, options) => {
    const child = original(hook, args as string[], options); children.push(child); return child;
  });
  await expect(removeWorktreeContents(request, undefined, { timeoutMs: 500 })).rejects.toMatchObject({
    diagnostics: { stage: "spawned", exitConfirmed: true, pid: expect.any(Number) }
  });
  expect(await readFile(join(request.path, "first.txt"), "utf8")).toBe("first");
});

it("does not let a failed diagnostic observer block physical deletion", async () => {
  const request = await fixture();
  await removeWorktreeContents(request, undefined, { onDiagnostic: () => { throw new Error("Observer unavailable"); } });
  await expect(lstat(request.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not launch a cleanup process for an already cancelled request", async () => {
  const request = await fixture(), controller = new AbortController(); controller.abort();
  const fork = vi.spyOn(cp, "fork");
  await expect(removeWorktreeContents(request, controller.signal)).rejects.toBeInstanceOf(WorktreeRemovalCancelledError);
  expect(fork).not.toHaveBeenCalled();
  expect(await readFile(join(request.path, "first.txt"), "utf8")).toBe("first");
});

it("does not launch a cleanup process after the shared budget is exhausted", async () => {
  const request = await fixture(), fork = vi.spyOn(cp, "fork");
  await expect(removeWorktreeContents(request, undefined, { timeoutMs: 0 })).rejects.toMatchObject({ name: "WorktreeRemovalTimeoutError" });
  expect(fork).not.toHaveBeenCalled();
  expect(await readFile(join(request.path, "first.txt"), "utf8")).toBe("first");
});
