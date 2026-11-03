import type { WorktreeInventory } from "../../shared/worktrees";
import { measureWorktreeTree } from "./worktreeSnapshot";

type Measurement = Awaited<ReturnType<typeof measureWorktreeTree>>;

export const createWorktreeMeasurements = (
  cache: Map<string, { at: number; value: Measurement }>,
  publish: (inventory: WorktreeInventory, current: () => boolean) => Promise<void>
) => {
  let controller: AbortController | undefined;
  let publication = Promise.resolve();
  const cancel = () => { controller?.abort(); controller = undefined; };
  return {
    cancel,
    drain: () => publication,
    prepare(inventory: WorktreeInventory, reuse: boolean): WorktreeInventory {
      const entries = inventory.entries.map((entry) => {
        if (entry.main || !entry.exists || entry.state === "unavailable") return { ...entry, measurementPending: false };
        const prior = cache.get(entry.path);
        const reusable = reuse && prior && Date.now() - prior.at < 15 * 60_000;
        return { ...entry, ...(reusable ? prior.value : {}), measurementPending: !reusable };
      });
      return { ...inventory, entries, measuring: entries.some((entry) => entry.measurementPending), measurementRevision: 0 };
    },
    start(inventory: WorktreeInventory) {
      cancel();
      if (!inventory.measuring) return;
      const abort = new AbortController();
      controller = abort;
      const current = () => controller === abort && !abort.signal.aborted;
      let snapshot = inventory, index = 0;
      let lastPublished = performance.now();
      const pending = inventory.entries.filter((entry) => entry.measurementPending);
      // Metrics are optional enrichment; never join this job from Preview or a mutation.
      void Promise.all(Array.from({ length: Math.min(2, pending.length) }, async () => {
        while (current() && index < pending.length) {
          const entry = pending[index++];
          let value: Measurement;
          try { value = await measureWorktreeTree(entry.path, abort.signal); }
          catch { if (!current()) return; }
          if (!current()) return;
          cache.set(entry.path, { at: Date.now(), value });
          const entries = snapshot.entries.map((row) => row.path === entry.path && row.commonDir === entry.commonDir
            ? { ...row, sizeBytes: value?.sizeBytes, modifiedAt: value?.modifiedAt, measurementPending: false } : row);
          snapshot = { ...snapshot, entries, measuring: entries.some((row) => row.measurementPending), measurementRevision: (snapshot.measurementRevision ?? 0) + 1 };
          if (snapshot.measuring && performance.now() - lastPublished < 100) continue;
          lastPublished = performance.now();
          const updated = snapshot;
          publication = publication.then(async () => { if (current()) await publish(updated, current); }).catch(() => undefined);
          await publication;
        }
      })).finally(() => { if (controller === abort) controller = undefined; }).catch(() => undefined);
    }
  };
};
