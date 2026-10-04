import { z } from "zod";

const usage = z.enum(["all", "referenced", "unreferenced"]);
const sourceKind = z.enum(["all", "online", "local"]);
export const CatalogViewsSchema = z.object({
  skills: z.object({
    sort: z.enum(["name", "source-updated", "references"]),
    statusFilter: z.enum(["all", "enabled", "updates", "disabled"]),
    sourceFilter: sourceKind,
    tagFilter: z.string(),
    targetFilter: z.enum(["all", "managed", "library", "outside", "left-unmanaged", "not-installed"]),
    usageFilter: usage
  }).partial().strict(),
  sources: z.object({
    sort: z.enum(["name", "changes"]),
    scopeFilter: z.enum(["all", "monitored", "manual"]),
    sourceKindFilter: sourceKind,
    resultFilter: z.enum(["all", "changes", "failed", "not-checked"])
  }).partial().strict(),
  groups: z.object({ sort: z.enum(["name", "updates"]), filter: z.enum(["all", "updates"]) }).partial().strict(),
  instructions: z.object({ sort: z.enum(["name", "modified"]), usageFilter: usage }).partial().strict(),
  backups: z.object({
    sort: z.enum(["newest", "oldest", "size"]),
    kindFilter: z.enum(["all", "target-recovery", "skill-cleanup", "workspace-sync"]),
    statusFilter: z.enum(["all", "eligible", "protected"]),
    targetFilter: z.string()
  }).partial().strict()
}).partial().strict();

export type CatalogViews = z.infer<typeof CatalogViewsSchema>;
export type CatalogView<K extends keyof CatalogViews> = NonNullable<CatalogViews[K]>;

export const mergeCatalogViews = (current: CatalogViews = {}, patch: CatalogViews = {}): CatalogViews =>
  Object.fromEntries(Object.keys({ ...current, ...patch }).map((key) => {
    const view = key as keyof CatalogViews;
    return [view, { ...current[view], ...patch[view] }];
  }));
