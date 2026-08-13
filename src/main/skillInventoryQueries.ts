import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type {
  SkillInventoryEntry,
  TargetPaths,
  UnmanagedSkillEntry
} from "../shared/types";
import { pathExists } from "./fileUtils";
import { legacyOwnedLibraryId } from "./skillLegacyOwnershipMigration";

export const findManagedSkillInstallPaths = async (
  libraryId: string,
  targetPaths: TargetPaths[]
): Promise<string[]> => {
  const safeId = SafeIdSchema.parse(libraryId);
  const matches = new Set<string>();
  for (const target of targetPaths) {
    const scanRoots = [
      ...new Set([target.skillsDir, ...(target.skillScanDirs ?? [])].filter(Boolean))
    ];
    for (const scanRoot of scanRoots) {
      if (!scanRoot || !(await pathExists(scanRoot))) continue;
      const entries = await readdir(scanRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const skillDir = join(scanRoot, entry.name);
        if ((await legacyOwnedLibraryId(skillDir)) === safeId) matches.add(skillDir);
      }
    }
  }
  return [...matches].sort();
};

export const scanUnmanagedSkillInventory = async (
  targetPaths: TargetPaths[],
  scanInventory: (targetPaths: TargetPaths[]) => Promise<SkillInventoryEntry[]>
): Promise<UnmanagedSkillEntry[]> =>
  (await scanInventory(targetPaths))
    .filter((skill) => skill.status === "outside")
    .map(({ id, name, description, path, foundIn, modifiedAt }) => ({
      id,
      name,
      description,
      path,
      foundIn,
      modifiedAt
    }));
