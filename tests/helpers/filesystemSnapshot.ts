import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { relative, resolve } from "node:path";

export interface FilesystemSnapshotEntry {
  kind: "directory" | "file" | "symlink";
  mode: number;
  hash?: string;
  target?: string;
}

export type FilesystemSnapshot = Record<string, FilesystemSnapshotEntry>;

const digest = (content: Buffer) =>
  createHash("sha256").update(content).digest("hex");

export const snapshotFilesystemTree = async (
  root: string
): Promise<FilesystemSnapshot> => {
  const absoluteRoot = resolve(root);
  const snapshot: FilesystemSnapshot = {};

  const visit = async (path: string): Promise<void> => {
    const stats = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stats) return;
    const key = relative(absoluteRoot, path) || ".";
    const mode = stats.mode & 0o777;
    if (stats.isSymbolicLink()) {
      snapshot[key] = {
        kind: "symlink",
        mode,
        target: await readlink(path)
      };
      return;
    }
    if (stats.isDirectory()) {
      snapshot[key] = { kind: "directory", mode };
      const entries = await readdir(path);
      for (const name of entries.sort((left, right) => left.localeCompare(right))) {
        await visit(resolve(path, name));
      }
      return;
    }
    snapshot[key] = {
      kind: "file",
      mode,
      hash: digest(await readFile(path))
    };
  };

  await visit(absoluteRoot);
  return snapshot;
};

export const changedSnapshotPaths = (
  before: FilesystemSnapshot,
  after: FilesystemSnapshot
) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
    .sort((left, right) => left.localeCompare(right));
