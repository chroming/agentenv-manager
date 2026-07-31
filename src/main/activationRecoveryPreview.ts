import { lstat, readFile, readlink } from "node:fs/promises";
import { createUnifiedDiff } from "./diff";
import {
  pathEntryExists,
  pathExists,
  readTextIfExists
} from "./fileUtils";
import type { BackupManifest, PlannedFileChange } from "../shared/types";

const readRollbackTextIfExists = async (path: string) => {
  try {
    return await readTextIfExists(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EISDIR"
    ) {
      return "[directory]\n";
    }
    throw error;
  }
};

export const createRollbackChange = async (
  entry: BackupManifest["entries"][number]
): Promise<PlannedFileChange> => {
  if (entry.kind === "symlink") {
    const currentStats = (await pathEntryExists(entry.sourcePath))
      ? await lstat(entry.sourcePath)
      : undefined;
    const before = currentStats?.isSymbolicLink()
      ? `[link] ${await readlink(entry.sourcePath)}\n`
      : currentStats?.isDirectory()
        ? "[directory]\n"
        : currentStats?.isFile()
          ? "[file]\n"
          : "";
    const after = entry.missing
      ? ""
      : `[link] ${entry.linkTarget ?? await readlink(entry.backupPath ?? "")}\n`;
    return {
      path: entry.sourcePath,
      before,
      after,
      diff: createUnifiedDiff(entry.sourcePath, before, after)
    };
  }
  if (entry.kind === "directory") {
    const before = (await pathExists(entry.sourcePath)) ? "[directory]\n" : "";
    const after = entry.missing ? "" : "[directory]\n";

    return {
      path: entry.sourcePath,
      before,
      after,
      diff: createUnifiedDiff(entry.sourcePath, before, after)
    };
  }

  const before = await readRollbackTextIfExists(entry.sourcePath);
  const after = entry.missing ? "" : await readFile(entry.backupPath ?? "", "utf8");

  return {
    path: entry.sourcePath,
    before,
    after,
    diff: createUnifiedDiff(entry.sourcePath, before, after)
  };
};
