import { readFile, readlink, rm, symlink } from "node:fs/promises";
import type { BackupManifest } from "../shared/types";
import {
  replacePathAtomically,
  replacePathWithCopy,
  writeAtomic
} from "./fileUtils";

export const restoreBackupEntries = async (backup: BackupManifest) => {
  for (const entry of backup.entries) {
    if (entry.missing) {
      await rm(entry.sourcePath, { recursive: true, force: true });
      continue;
    }

    if (entry.kind === "directory") {
      await replacePathWithCopy(entry.backupPath ?? "", entry.sourcePath, {
        dereference: false
      });
      continue;
    }

    if (entry.kind === "symlink") {
      const linkTarget =
        entry.linkTarget ?? await readlink(entry.backupPath ?? "");
      await replacePathAtomically(entry.sourcePath, (stagingPath) =>
        symlink(linkTarget, stagingPath, entry.linkType ?? "dir")
      );
      continue;
    }

    const content = await readFile(entry.backupPath ?? "", "utf8");
    await writeAtomic(entry.sourcePath, content, { mode: entry.mode });
  }
};
