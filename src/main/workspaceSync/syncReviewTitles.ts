import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceSyncChange } from "../../shared/workspaceSync";
import type { WorkspaceSnapshotDescriptor, WorkspaceSyncPlan } from "./syncPlanner";

export const resolveSyncReviewTitles = async (plan: WorkspaceSyncPlan, snapshots: {
  local: WorkspaceSnapshotDescriptor;
  remote?: WorkspaceSnapshotDescriptor;
  base?: WorkspaceSnapshotDescriptor;
}): Promise<void> => {
  const cache = new Map<string, Promise<string | undefined>>();
  const nameFor = (snapshot: WorkspaceSnapshotDescriptor | undefined, change: WorkspaceSyncChange) => {
    if (!snapshot || change.resourceKind === "source" || change.resourceKind === "group") return undefined;
    const file = change.resourceKind === "profile" ? "profile.json" :
      change.resourceKind === "instruction" ? "instruction.json" : "metadata.json";
    const path = join(snapshot.root, "workspace", `${change.resourceKind}s`, change.resourceId, file);
    if (!cache.has(path)) cache.set(path, (async () => {
      try {
        const value = JSON.parse(await readFile(path, "utf8"));
        return typeof value.name === "string" && value.name.trim() ? value.name.trim() : undefined;
      } catch {
        // Display metadata is optional; integrity validation remains owned by the codec.
        return undefined;
      }
    })());
    return cache.get(path);
  };
  await Promise.all(plan.review.changes.map(async (change) => {
    if (change.resourceKind === "source" || change.resourceKind === "group") return;
    const [local, remote, base] = await Promise.all([
      nameFor(snapshots.local, change), nameFor(snapshots.remote, change), nameFor(snapshots.base, change)
    ]);
    change.title = change.direction === "conflict" && local && remote && local !== remote
      ? `${local} / ${remote}`
      : (change.direction === "remote" ? remote ?? local : local ?? remote) ?? base ?? change.resourceId;
  }));
};
