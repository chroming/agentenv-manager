import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import type { WorktreeInventory } from "../../shared/worktrees";
import { writeAtomic } from "../fileUtils";

const strings = z.array(z.string());
const inventorySchema = z.object({
  scanRoots: strings, configuredRoots: strings, builtinRoots: strings,
  issues: strings, incomplete: z.boolean(), scannedAt: z.string().datetime(),
  entries: z.array(z.object({
    path: z.string(), repositoryPath: z.string(), commonDir: z.string(),
    head: z.string().optional(), branch: z.string().optional(), main: z.boolean(),
    detached: z.boolean(), locked: z.string().optional(), prunable: z.string().optional(),
    exists: z.boolean(), state: z.enum(["candidate", "review", "kept", "unavailable"]),
    reasons: strings, changes: strings, ignored: strings, submodules: z.boolean(),
    reasonDetails: z.array(z.object({ message: z.string(), values: z.record(z.string(), z.union([z.string(), z.number()])).optional(), detail: z.string().optional() })).optional(),
    sizeBytes: z.number().nonnegative().optional(), modifiedAt: z.string().optional(),
    keptReason: z.string().optional(), repositoryKeptReason: z.string().optional(), cleanupReviewAvailable: z.boolean(),
    manualReviewAvailable: z.boolean(), headNeedsProtection: z.boolean(),
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
      await writeAtomic(path, JSON.stringify({ version: 1, inventory })).catch(() => undefined);
    },
    async invalidate(keepDisplay = false) {
      generation++;
      loaded = true;
      completedAt = 0;
      if (!keepDisplay) inventory = undefined;
      try {
        await rm(path, { force: true });
      } catch {
        // Cache maintenance must never block the actual resource operation.
        await writeAtomic(path, JSON.stringify({ version: 0 })).catch(() => undefined);
        console.warn("[AgentEnv] Could not remove Worktree display cache; it will be revalidated on restart.");
      }
    }
  };
};
