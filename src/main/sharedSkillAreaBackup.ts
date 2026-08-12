import { join } from "node:path";
import type { SkillCleanupBackupManifest } from "./skillCleanupBackupStore";
import { pathEntryExists } from "./fileUtils";

export const backupSharedSkillAreaState = async (
  statePath: string,
  backupDir: string,
  slot: number,
  entries: SkillCleanupBackupManifest["entries"],
  copyEntry: (
    entries: SkillCleanupBackupManifest["entries"],
    originalPath: string,
    backupPath: string
  ) => Promise<void>
) => {
  if (!await pathEntryExists(statePath)) return;
  await copyEntry(
    entries,
    statePath,
    join(backupDir, "locations", `${slot}-shared-skill-area.json`)
  );
};
