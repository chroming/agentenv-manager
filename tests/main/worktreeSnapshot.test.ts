import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, expect, it } from "vitest";
import { copyWorktreeVerified, fingerprintWorktreeTree, hashWorktreeTree, measureWorktreeTree } from "../../src/main/worktrees/worktreeSnapshot";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("reuses a fresh source hash without weakening the source and destination backup verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "aem-worktree-verified-copy-"));
  roots.push(root);
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "note"), "reviewed content");
  const hash = await hashWorktreeTree(source);
  expect(await copyWorktreeVerified(source, join(root, "copy"), hash)).toBe(hash);
  expect(await hashWorktreeTree(join(root, "copy"))).toBe(hash);
  await writeFile(join(source, "note"), "external changes");
  await expect(copyWorktreeVerified(source, join(root, "stale-copy"), hash)).rejects.toThrow("backup copy could not be verified");
  expect(await readFile(join(source, "note"), "utf8")).toBe("external changes");
});

it("reports the newest local file mtime, including ignored files but excluding Git metadata and scan time", async () => {
  const root = await mkdtemp(join(tmpdir(), "aem-worktree-file-time-"));
  roots.push(root);
  await mkdir(join(root, "cache"));
  const old = new Date("2024-03-10T10:00:00Z");
  const recent = new Date("2025-06-20T12:00:00Z");
  for (const [path, content, date] of [
    ["source.txt", "tracked", old], [".gitignore", "cache/", old],
    ["cache/result.txt", "ignored", recent], [".git", "gitdir: fixture", new Date()]
  ] as const) {
    await writeFile(join(root, path), content);
    await utimes(join(root, path), date, date);
  }
  expect((await measureWorktreeTree(root))?.modifiedAt).toBe(recent.toISOString());
  expect((await fingerprintWorktreeTree(root)).modifiedAt).toBe(recent.toISOString());
  const empty = await mkdtemp(join(tmpdir(), "aem-worktree-no-file-time-"));
  roots.push(empty);
  expect(await measureWorktreeTree(empty)).toEqual({ sizeBytes: 0, modifiedAt: undefined });
});

// Original streaming format is the persisted recovery fingerprint contract.
const streamingHash = async (root: string, omitGitFile = false) => {
  const hash = createHash("sha256");
  const walk = async (path: string): Promise<void> => {
    const info = await lstat(path);
    hash.update(relative(root, path).split(sep).join("/") || ".");
    hash.update(`\0${info.mode & 0o777}\0`);
    if (info.isSymbolicLink()) hash.update(`link\0${await readlink(path)}\0`);
    else if (info.isDirectory()) {
      hash.update("dir\0");
      for (const name of (await readdir(path)).sort()) {
        if (path === root && omitGitFile && name === ".git") continue;
        await walk(join(path, name));
      }
    } else {
      hash.update("file\0");
      for await (const part of createReadStream(path)) hash.update(part);
      hash.update("\0");
    }
  };
  await walk(root);
  return hash.digest("hex");
};

it("keeps recovery hashes identical for small/large files, permissions and links while measuring the same pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "aem-worktree-hash-"));
  roots.push(root);
  await mkdir(join(root, "nested"));
  await writeFile(join(root, ".git"), "gitdir: fixture\n");
  await writeFile(join(root, "small"), "hello");
  await writeFile(join(root, "nested", "large"), Buffer.alloc(128 * 1024, 42));
  await writeFile(join(root, "nested", "empty"), "");
  await chmod(join(root, "small"), 0o755);
  if (process.platform !== "win32") await symlink("missing", join(root, "broken"));
  for (const omitGitFile of [false, true]) {
    const fingerprint = await fingerprintWorktreeTree(root, { omitGitFile });
    expect(fingerprint.hash).toBe(await streamingHash(root, omitGitFile));
    expect(fingerprint.sizeBytes).toBe(5 + 128 * 1024 + (process.platform === "win32" ? 0 : 7));
    expect(fingerprint.modifiedAt).toMatch(/^\d{4}-/);
    expect(await hashWorktreeTree(root, { omitGitFile })).toBe(fingerprint.hash);
  }
});

it("benchmarks the fingerprint path against streaming every small file", async () => {
  const root = await mkdtemp(join(tmpdir(), "aem-worktree-hash-perf-"));
  roots.push(root);
  for (let i = 0; i < 400; i++) await writeFile(join(root, `file-${i}`), "fixture\n".repeat(128));
  const before = performance.now();
  const expected = await streamingHash(root);
  const streamingMs = performance.now() - before;
  const started = performance.now();
  const fingerprint = await fingerprintWorktreeTree(root);
  const fingerprintMs = performance.now() - started;
  expect(fingerprint.hash).toBe(expected);
  expect(fingerprint.sizeBytes).toBe(400 * 1024);
  console.info(`Worktree fingerprint fixture: streaming=${Math.round(streamingMs)}ms combined=${Math.round(fingerprintMs)}ms`);
});
