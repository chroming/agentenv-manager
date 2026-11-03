import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { WorktreeFileProgress } from "../../shared/worktrees";
import { syncPathTree } from "../filesystemIntegrity";

type FileProgressCallback = (progress: WorktreeFileProgress) => void;

const countedProgress = (step: WorktreeFileProgress["step"], callback?: FileProgressCallback) => {
  let filesCounted = 0, bytesCounted = 0, lastReport = -Infinity;
  const report = (force = false) => {
    if (!callback) return;
    const now = performance.now();
    if (!force && now - lastReport < 150) return;
    lastReport = now;
    try { Promise.resolve(callback({ step, filesCounted, bytesCounted })).catch(() => undefined); }
    catch { /* Feedback cannot fail verification. */ }
  };
  report();
  return {
    add: (files: number, bytes: number) => { filesCounted += files; bytesCounted += bytes; report(); },
    finish: () => report(true)
  };
};

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

export const fingerprintWorktreeTree = async (root: string, options: {
  omitGitFile?: boolean;
  progress?: FileProgressCallback;
  step?: Exclude<WorktreeFileProgress["step"], "copying">;
} = {}) => {
  const hash = createHash("sha256");
  const progress = countedProgress(options.step ?? "fingerprinting", options.progress);
  let sizeBytes = 0;
  let modifiedMs = 0;
  const walk = async (path: string): Promise<void> => {
    const info = await lstat(path);
    if (!info.isDirectory() && relative(root, path) !== ".git") {
      sizeBytes += info.size;
      modifiedMs = Math.max(modifiedMs, info.mtimeMs);
    }
    hash.update(relative(root, path).split(sep).join("/") || ".");
    hash.update("\0");
    hash.update(String(info.mode & 0o777));
    hash.update("\0");
    if (info.isSymbolicLink()) {
      hash.update("link\0");
      const target = await readlink(path);
      hash.update(target);
      hash.update("\0");
      progress.add(1, Buffer.byteLength(target));
    } else if (info.isDirectory()) {
      hash.update("dir\0");
      for (const name of (await readdir(path)).sort()) {
        if (path === root && options.omitGitFile && name === ".git") continue;
        await walk(join(path, name));
      }
    } else if (info.isFile()) {
      hash.update("file\0");
      // Avoid constructing a stream for every small source file; keep large files bounded.
      if (info.size <= 64 * 1024) {
        const content = await readFile(path);
        hash.update(content);
        progress.add(0, content.length);
      } else for await (const part of createReadStream(path)) {
        hash.update(part);
        progress.add(0, part.length);
      }
      hash.update("\0");
      progress.add(1, 0);
    } else {
      throw new Error(`Unsupported filesystem entry in worktree: ${path}`);
    }
  };
  await walk(root);
  progress.finish();
  return { hash: hash.digest("hex"), sizeBytes, modifiedAt: modifiedMs ? new Date(modifiedMs).toISOString() : undefined };
};

export const hashWorktreeTree = async (root: string, options: Parameters<typeof fingerprintWorktreeTree>[1] = {}): Promise<string> =>
  (await fingerprintWorktreeTree(root, options)).hash;

export const copyWorktreeVerified = async (
  source: string, destination: string, expectedHash?: string, onProgress?: FileProgressCallback
): Promise<string> => {
  // Cleanup already read this exact fingerprint; both trees must still match it after copying.
  const before = expectedHash ?? await hashWorktreeTree(source, { progress: onProgress });
  const copying = countedProgress("copying", onProgress);
  await cp(source, destination, {
    recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true,
    ...(onProgress ? { filter: async (path: string) => {
      try {
        const info = await lstat(path);
        if (!info.isDirectory()) copying.add(1, info.size);
      } catch { /* Optional accounting must not change cp's own error handling. */ }
      return true;
    } } : {})
  });
  copying.finish();
  await syncPathTree(destination);
  const [after, copied] = await Promise.all([
    hashWorktreeTree(source, { progress: onProgress, step: "verifying-source" }),
    hashWorktreeTree(destination, { progress: onProgress, step: "verifying-backup" })
  ]);
  if (before !== after || copied !== after) {
    throw new Error("Worktree changed or backup copy could not be verified");
  }
  return copied;
};
