import type { ManagedBackupInventory, ManagedBackupItem } from "../shared/types";
import type { useFreshnessCoordinator } from "./hooks/useFreshnessCoordinator";

export const refreshBackupInventory = async (
  run: ReturnType<typeof useFreshnessCoordinator>["run"],
  reason: "page-entry" | "mutation" | "manual",
  read: () => Promise<ManagedBackupInventory>
) => {
  let performed = false;
  const task = () => { performed = true; return read(); };
  try {
    await run("backups", reason, task);
  } catch (error) {
    if (reason !== "mutation" || performed) throw error;
  }
  // An older in-flight scan, even a failed one, cannot satisfy a post-deletion refresh.
  if (reason === "mutation" && !performed) await run("backups", reason, task);
};

export const withoutDeletedBackup = (
  current: ManagedBackupInventory | undefined,
  deleted: Pick<ManagedBackupItem, "id" | "kind">
): ManagedBackupInventory | undefined => {
  if (!current) return current;
  const items = current.items.filter((item) => item.id !== deleted.id || item.kind !== deleted.kind);
  const eligible = items.filter((item) => item.cleanupStatus === "eligible");
  return {
    ...current,
    items,
    totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    eligibleBytes: eligible.reduce((total, item) => total + item.sizeBytes, 0),
    eligibleCount: eligible.length
  };
};
