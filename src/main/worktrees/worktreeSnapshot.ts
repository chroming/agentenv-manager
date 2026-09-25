import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, readdir, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { syncPathTree } from "../filesystemIntegrity";

export const measureWorktreeTree = async (
  root: string,
  signal?: AbortSignal
): Promise<{ sizeBytes: number; modifiedAt?: string } | undefined> => {
  const pending = [root];
  const deadline = Date.now() + 2_000;
  let inspected = 0;
  let sizeBytes = 0;
  let modifiedMs = 0;
  while (pending.length) {
    signal?.throwIfAborted();
    if (++inspected > 30_000 || Date.now() > deadline) return undefined;
    const path = pending.pop()!;
    const info = await lstat(path);
    if (info.isDirectory()) {
      for (const child of await readdir(path)) {
        if (path === root && child === ".git") continue;
        pending.push(join(path, child));
      }
    } else {
      sizeBytes += info.size;
      modifiedMs = Math.max(modifiedMs, info.mtimeMs);
    }
  }
  return { sizeBytes, modifiedAt: modifiedMs ? new Date(modifiedMs).toISOString() : undefined };
};

export const hashWorktreeTree = async (root: string, options: { omitGitFile?: boolean } = {}): Promise<string> => {
  const hash = createHash("sha256");
  const walk = async (path: string): Promise<void> => {
    const info = await lstat(path);
    hash.update(relative(root, path).split(sep).join("/") || ".");
    hash.update("\0");
    hash.update(String(info.mode & 0o777));
    hash.update("\0");
    if (info.isSymbolicLink()) {
      hash.update("link\0");
      hash.update(await readlink(path));
      hash.update("\0");
    } else if (info.isDirectory()) {
      hash.update("dir\0");
      for (const name of (await readdir(path)).sort()) {
        if (path === root && options.omitGitFile && name === ".git") continue;
        await walk(join(path, name));
      }
    } else if (info.isFile()) {
      hash.update("file\0");
      for await (const part of createReadStream(path)) hash.update(part);
      hash.update("\0");
    } else {
      throw new Error(`Unsupported filesystem entry in worktree: ${path}`);
    }
  };
  await walk(root);
  return hash.digest("hex");
};

export const copyWorktreeVerified = async (source: string, destination: string): Promise<string> => {
  const before = await hashWorktreeTree(source);
  await cp(source, destination, {
    recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true
  });
  await syncPathTree(destination);
  const [after, copied] = await Promise.all([
    hashWorktreeTree(source), hashWorktreeTree(destination)
  ]);
  if (before !== after || copied !== after) {
    throw new Error("Worktree changed or backup copy could not be verified");
  }
  return copied;
};
