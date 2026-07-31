import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  recoverAtomicReplacement,
  replacePathAtomically,
  syncParentDirectory,
  writeAtomic
} from "../../src/main/fileUtils";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("durable file utilities", () => {
  it("creates private parent directories and files by default", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "private", "nested", "state.json");

    await writeAtomic(target, "{}\n");

    if (process.platform !== "win32") {
      expect((await stat(join(root, "private", "nested"))).mode & 0o777).toBe(0o700);
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    }
    await expect(readFile(target, "utf8")).resolves.toBe("{}\n");
  });

  it("atomically replaces an existing file without a replacement journal", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "state.json");
    await writeFile(target, "before\n", "utf8");

    await writeAtomic(target, "after\n");

    await expect(readFile(target, "utf8")).resolves.toBe("after\n");
    await expect(
      readFile(`${target}.agentenv-replace.json`, "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the original path when preparing a replacement fails", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "skill");
    await mkdir(target);
    await writeFile(join(target, "SKILL.md"), "# Original\n");

    await expect(
      replacePathAtomically(target, async (staging) => {
        await mkdir(staging);
        await writeFile(join(staging, "SKILL.md"), "# Incomplete\n");
        throw new Error("copy failed");
      })
    ).rejects.toThrow("copy failed");

    await expect(readFile(join(target, "SKILL.md"), "utf8")).resolves.toBe("# Original\n");
  });

  it("restores the previous path after an interrupted committed replacement", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "profile");
    const previous = `${target}.agentenv-previous`;
    await mkdir(previous);
    await writeFile(join(previous, "AGENTS.md"), "# Previous\n");
    await writeAtomic(
      `${target}.agentenv-replace.json`,
      `${JSON.stringify({ targetPath: target, hadTarget: true })}\n`
    );

    await recoverAtomicReplacement(target);

    await expect(readFile(join(target, "AGENTS.md"), "utf8")).resolves.toBe("# Previous\n");
    await expect(readFile(`${target}.agentenv-replace.json`, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("skips unsupported directory fsync on Windows", async () => {
    let syncCalls = 0;
    await syncParentDirectory("C:\\AgentEnv", {
      platform: "win32",
      sync: async () => {
        syncCalls += 1;
        throw new Error("directory handles are unsupported");
      }
    });

    expect(syncCalls).toBe(0);
  });

  it("still fsyncs parent directories on POSIX systems", async () => {
    let syncedPath = "";
    await syncParentDirectory("/tmp/agentenv", {
      platform: "linux",
      sync: async (path) => {
        syncedPath = path;
      }
    });

    expect(syncedPath).toBe("/tmp/agentenv");
  });
});
