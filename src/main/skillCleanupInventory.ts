import { resolve } from "node:path";
import { isSkillCleanupManageable } from "../shared/skillCleanup";
import { isSharedSkillInventoryEntry } from "../shared/skillLocationSemantics";
import type { SkillInventoryEntry } from "../shared/types";

export type SkillCleanupInventoryIndex = Map<string, SkillInventoryEntry[]>;

export const indexSkillCleanupInventory = (
  inventory: readonly SkillInventoryEntry[]
): SkillCleanupInventoryIndex => {
  const byPath: SkillCleanupInventoryIndex = new Map();
  for (const item of inventory) {
    const path = resolve(item.path);
    byPath.set(path, [...(byPath.get(path) ?? []), item]);
  }
  return byPath;
};

const targetCandidatePriority = (item: SkillInventoryEntry) =>
  (isSkillCleanupManageable(item) ? 100 : 0) +
  (isSharedSkillInventoryEntry(item) ? 0 : 20) +
  (item.locationRole === "preferred-runtime" ? 10 : 0) +
  (item.status === "managed" ? 5 : 0);

export const findTargetSkillCleanupEntry = (
  inventoryByPath: SkillCleanupInventoryIndex,
  input: {
    path: string;
    targetId: string;
    skillKey: string;
    contentHash: string;
  }
): SkillInventoryEntry | undefined =>
  [...(inventoryByPath.get(resolve(input.path)) ?? [])]
    .filter(
      (item) =>
        item.skillKey === input.skillKey &&
        item.contentHash === input.contentHash &&
        item.foundIn.includes(input.targetId)
    )
    .sort((left, right) => targetCandidatePriority(right) - targetCandidatePriority(left))[0];

export const findSharedSkillCleanupEntry = (
  inventoryByPath: SkillCleanupInventoryIndex,
  input: {
    path: string;
    skillKey: string;
    contentHash: string;
  }
): SkillInventoryEntry | undefined =>
  (inventoryByPath.get(resolve(input.path)) ?? []).find(
    (item) =>
      item.skillKey === input.skillKey &&
      item.contentHash === input.contentHash &&
      isSharedSkillInventoryEntry(item)
  );
