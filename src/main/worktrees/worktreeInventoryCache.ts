import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import type { WorktreeInventory } from "../../shared/worktrees";
import { writeAtomic } from "../fileUtils";

const strings = z.array(z.string());
const inventorySchema = z.object({
  scanRoots: strings, configuredRoots: strings, builtinRoots: strings,
  issues: strings, incomplete: z.boolean(), scannedAt: z.string().datetime(),
  measuring: z.boolean().optional(), measurementRevision: z.number().int().nonnegative().optional(),
  entries: z.array(z.object({
    path: z.string(), repositoryPath: z.string(), commonDir: z.string(),
    head: z.string().optional(), branch: z.string().optional(), main: z.boolean(),
    detached: z.boolean(), locked: z.string().optional(), prunable: z.string().optional(),
    exists: z.boolean(), pathAvailability: z.literal("unknown").optional(), state: z.enum(["candidate", "review", "kept", "unavailable"]),
    reasons: strings, changes: strings, ignored: strings, submodules: z.boolean(),
    reasonDetails: z.array(z.object({ message: z.string(), values: z.record(z.string(), z.union([z.string(), z.number()])).optional(), detail: z.string().optional() })).optional(),
    sizeBytes: z.number().nonnegative().optional(), modifiedAt: z.string().optional(),
    measurementPending: z.boolean().optional(),
    keptReason: z.string().optional(), repositoryKeptReason: z.string().optional(), cleanupReviewAvailable: z.boolean(),
    manualReviewAvailable: z.boolean(), headNeedsProtection: z.boolean(),
    pausedOperations: strings.optional(), localContentUncertain: z.boolean().optional(),
    integration: z.object({ ref: z.string().optional(), head: z.string().optional(),
      merged: z.boolean().optional(), explicit: z.boolean(), choices: strings }).optional()
  }))
});

// Persisted data is display-only: it never restores cleanup authorization.
export const createWorktreeInventoryCache = (path: string) => {
  let inventory: WorktreeInventory | undefined;
  let completedAt = 0;
  let loaded = false;
  let generation = 0;
  let loading: Promise<void> | undefined;
  let writes = Promise.resolve();
  const persist = (operation: () => Promise<void>) => {
    writes = writes.catch(() => undefined).then(operation).catch(() => undefined);
    return writes;
  };
  return {
    markStale() { completedAt = 0; },
    async read() {
      if (!loaded) {
        loaded = true;
        const current = generation;
        loading = (async () => {
          try {
            const raw = JSON.parse(await readFile(path, "utf8"));
            if (raw.version === 1 && current === generation) inventory = inventorySchema.parse(raw.inventory);
          } catch { /* Invalid or missing display caches are rebuilt by scanning. */ }
        })();
      }
      await loading;
      return { inventory, fresh: completedAt > 0 && Date.now() - completedAt < 5 * 60_000 };
    },
    async save(value: WorktreeInventory) {
      generation++;
      loaded = true;
      inventory = value;
      completedAt = value.incomplete ? 0 : Date.now();
      const bytes = JSON.stringify({ version: 1, inventory });
      await persist(() => writeAtomic(path, bytes));
    },
    async enrich(value: WorktreeInventory) {
      if (!inventory || inventory.scannedAt !== value.scannedAt) return;
      inventory = value;
      const bytes = JSON.stringify({ version: 1, inventory });
      await persist(() => writeAtomic(path, bytes));
    },
    async invalidate(keepDisplay = false) {
      generation++;
      loaded = true;
      completedAt = 0;
      if (!keepDisplay) inventory = undefined;
      else if (inventory?.measuring) inventory = { ...inventory, measuring: false,
        measurementRevision: (inventory.measurementRevision ?? 0) + 1,
        entries: inventory.entries.map((entry) => ({ ...entry, measurementPending: false })) };
      await persist(async () => { try {
        await rm(path, { force: true });
      } catch {
        // Cache maintenance must never block the actual resource operation.
        await writeAtomic(path, JSON.stringify({ version: 0 })).catch(() => undefined);
        console.warn("[AgentEnv] Could not remove Worktree display cache; it will be revalidated on restart.");
      } });
    }
  };
};
