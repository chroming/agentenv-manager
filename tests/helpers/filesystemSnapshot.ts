import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { relative, resolve } from "node:path";

export interface FilesystemSnapshotEntry {
  kind: "directory" | "file" | "symlink";
  mode: number;
  size?: number;
  mtimeMs?: number;
  hash?: string;
  target?: string;
}

export type FilesystemSnapshot = Record<string, FilesystemSnapshotEntry>;

export interface FilesystemSnapshotOptions {
  includeTimestamps?: boolean;
}

const digest = (content: Buffer) =>
  createHash("sha256").update(content).digest("hex");

export const snapshotFilesystemTree = async (
  root: string,
  options: FilesystemSnapshotOptions = {}
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
    const metadata = options.includeTimestamps
      ? { size: stats.size, mtimeMs: stats.mtimeMs }
      : {};
    if (stats.isSymbolicLink()) {
      snapshot[key] = {
        kind: "symlink",
        mode,
        ...metadata,
        target: await readlink(path)
      };
      return;
    }
    if (stats.isDirectory()) {
      snapshot[key] = { kind: "directory", mode, ...metadata };
      const entries = await readdir(path);
      for (const name of entries.sort((left, right) => left.localeCompare(right))) {
        await visit(resolve(path, name));
      }
      return;
    }
    snapshot[key] = {
      kind: "file",
      mode,
      ...metadata,
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

const normalizedSnapshotPath = (path: string) => path.replaceAll("\\", "/");

export const snapshotPathIsWithin = (path: string, allowedPath: string) => {
  const candidate = normalizedSnapshotPath(path);
  const allowed = normalizedSnapshotPath(allowedPath).replace(/\/$/, "");
  return candidate === allowed || candidate.startsWith(`${allowed}/`);
};

export const assertSnapshotChangesWithin = (
  before: FilesystemSnapshot,
  after: FilesystemSnapshot,
  allowedPaths: readonly string[]
): string[] => {
  const changed = changedSnapshotPaths(before, after);
  const unexpected = changed.filter(
    (path) => !allowedPaths.some((allowed) => snapshotPathIsWithin(path, allowed))
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Filesystem mutation escaped the previewed scope: ${unexpected.join(", ")}`
    );
  }
  return changed;
};

export const assertFilesystemSnapshotEqual = (
  before: FilesystemSnapshot,
  after: FilesystemSnapshot,
  label = "filesystem"
): void => {
  const changed = changedSnapshotPaths(before, after);
  if (changed.length > 0) {
    throw new Error(`${label} changed unexpectedly: ${changed.join(", ")}`);
  }
};
