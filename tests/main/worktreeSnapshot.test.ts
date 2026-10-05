import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, expect, it } from "vitest";
import { fingerprintWorktreeTree, hashWorktreeTree } from "../../src/main/worktrees/worktreeSnapshot";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

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
