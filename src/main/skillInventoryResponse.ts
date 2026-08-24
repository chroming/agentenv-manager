import type { SkillInventoryScanResult, TargetPaths } from "../shared/types";
import { isTargetInstalled } from "../shared/targetHealth";
import { isSharedSkillInventoryEntry } from "../shared/skillLocationSemantics";
import type { SkillLibraryStore } from "./skillLibraryStoreTypes";
import type { TargetDiscoveryService } from "./targetDiscovery";

type DiscoveredTarget = Awaited<ReturnType<TargetDiscoveryService["listTargets"]>>[number];

export const scanSkillInventoryForRenderer = async (
  skillLibraryStore: Pick<SkillLibraryStore, "scanInventory">,
  targetPaths: TargetPaths[],
  targets: DiscoveredTarget[]
): Promise<SkillInventoryScanResult> => {
  let issues: SkillInventoryScanResult["issues"] = [];
  const inventory = await skillLibraryStore.scanInventory(
    targetPaths,
    undefined,
    (scanIssues) => { issues = scanIssues; }
  );
  const installedTargetIds = new Set(
    targets.filter((target) => isTargetInstalled(target.health)).map((target) => target.id)
  );
  return {
    entries: inventory.map((item) => isSharedSkillInventoryEntry(item)
      ? {
          ...item,
          foundIn: item.foundIn.filter((targetId) => installedTargetIds.has(targetId))
        }
      : item),
    issues
  };
};
