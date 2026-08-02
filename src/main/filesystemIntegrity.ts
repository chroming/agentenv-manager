import { createHash } from "node:crypto";
import { cp, lstat, open, readFile, readdir, readlink } from "node:fs/promises";
import { relative, sep } from "node:path";

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const portableRelativePath = (root: string, path: string) => {
  const value = relative(root, path);
  return value ? value.split(sep).join("/") : ".";
};

export const hashFileContent = (content: string | Uint8Array): string => {
  const hash = createHash("sha256");
  hash.update(".");
  hash.update("\0");
  hash.update("file\0");
  hash.update(content);
  hash.update("\0");
  return hash.digest("hex");
};

export const hashPathEntry = async (path: string): Promise<string | undefined> => {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }

  const hash = createHash("sha256");
  const walk = async (currentPath: string): Promise<void> => {
    const stats = await lstat(currentPath);
    hash.update(portableRelativePath(path, currentPath));
    hash.update("\0");
    if (stats.isSymbolicLink()) {
      hash.update("symlink\0");
      hash.update(await readlink(currentPath));
      hash.update("\0");
      return;
    }
    if (stats.isDirectory()) {
      hash.update("directory\0");
      const entries = await readdir(currentPath, { withFileTypes: true });
      entries.sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
      );
      for (const entry of entries) {
        await walk(`${currentPath}${sep}${entry.name}`);
      }
      return;
    }
    if (stats.isFile()) {
      hash.update("file\0");
      hash.update(await readFile(currentPath));
      hash.update("\0");
      return;
    }
    throw new Error(`Unsupported filesystem entry in AgentEnv data: ${currentPath}`);
  };

  await walk(path);
  return hash.digest("hex");
};

export const hashRequiredPathEntry = async (path: string): Promise<string> => {
  const hash = await hashPathEntry(path);
  if (!hash) throw new Error(`Filesystem entry disappeared while being preserved: ${path}`);
  return hash;
};

export const hashSymlinkTarget = (target: string): string => {
  const hash = createHash("sha256");
  hash.update(".");
  hash.update("\0");
  hash.update("symlink\0");
  hash.update(target);
  hash.update("\0");
  return hash.digest("hex");
};

const syncFile = async (path: string, platform: NodeJS.Platform) => {
  // Windows requires a write-capable handle for FlushFileBuffers.
  const handle = await open(path, platform === "win32" ? "r+" : "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const syncPathTree = async (
  path: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> => {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) return;
  if (stats.isFile()) {
    await syncFile(path, platform);
    return;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsupported filesystem entry in AgentEnv data: ${path}`);
  }
  const entries = await readdir(path);
  for (const entry of entries) await syncPathTree(`${path}${sep}${entry}`, platform);
  if (platform !== "win32") await syncFile(path, platform);
};

export const copyPathVerified = async (
  sourcePath: string,
  destinationPath: string,
  options: {
    dereference?: boolean;
    platform?: NodeJS.Platform;
    recursive?: boolean;
  } = {}
): Promise<string> => {
  const sourceBefore = await hashRequiredPathEntry(sourcePath);
  await cp(sourcePath, destinationPath, {
    dereference: options.dereference ?? false,
    recursive: options.recursive ?? true,
    verbatimSymlinks: true
  });
  await syncPathTree(destinationPath, options.platform);
  const [sourceAfter, destinationHash] = await Promise.all([
    hashRequiredPathEntry(sourcePath),
    hashRequiredPathEntry(destinationPath)
  ]);
  if (sourceAfter !== sourceBefore) {
    throw new Error(`Filesystem entry changed while its backup was being created: ${sourcePath}`);
  }
  if (destinationHash !== sourceAfter) {
    throw new Error(`Backup copy does not match its source: ${sourcePath}`);
  }
  return destinationHash;
};
