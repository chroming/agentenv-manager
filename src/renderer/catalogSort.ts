import type { InstructionBlock, ManagedBackupItem, SkillLibraryEntry, SkillSourceGroupView } from "../shared/types";
import type { CatalogView } from "../shared/catalogViews";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const compareCatalogNames = (left: string, right: string) => collator.compare(left, right) || left.localeCompare(right);
const timestamp = (value?: string) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : undefined;
};
const compareTimes = (left: string | undefined, right: string | undefined, oldest = false) => {
  const a = timestamp(left), b = timestamp(right);
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  return oldest ? a - b : b - a;
};

export const sortLibrarySkills = (skills: readonly SkillLibraryEntry[], sort: CatalogView<"skills">["sort"],
  usage: Record<string, string[]>) => [...skills].sort((a, b) =>
  (sort === "source-updated" ? compareTimes(a.upstream?.updatedAt, b.upstream?.updatedAt)
    : sort === "references" ? new Set(usage[b.id]).size - new Set(usage[a.id]).size : 0) ||
  compareCatalogNames(a.name, b.name) || compareCatalogNames(a.id, b.id));

export const sourceChangeCount = (group: SkillSourceGroupView) =>
  group.counts.updates + group.counts.new + group.counts.removed;
export const sortSourceGroups = (groups: readonly SkillSourceGroupView[], sort: CatalogView<"sources">["sort"]) =>
  [...groups].sort((a, b) => (sort === "changes" ? sourceChangeCount(b) - sourceChangeCount(a) : 0) ||
    compareCatalogNames(a.displayName || a.canonicalLink, b.displayName || b.canonicalLink) ||
    compareCatalogNames(a.sourceId, b.sourceId));

export const projectInstructions = (blocks: readonly InstructionBlock[], view: Required<CatalogView<"instructions">>) =>
  blocks.filter((block) => view.usageFilter === "all" ||
    (view.usageFilter === "referenced" ? Boolean(block.usedByProfiles?.length) : !block.usedByProfiles?.length))
    .sort((a, b) => (view.sort === "modified" ? compareTimes(a.updatedAt, b.updatedAt) : 0) ||
      compareCatalogNames(a.name, b.name) || compareCatalogNames(a.id, b.id));

export const projectBackups = (items: readonly ManagedBackupItem[], view: Required<CatalogView<"backups">>) =>
  items.filter((item) => (view.kindFilter === "all" || item.kind === view.kindFilter) &&
    (view.targetFilter === "all" || item.targetId === view.targetFilter) &&
    (view.statusFilter === "all" || (view.statusFilter === "eligible"
      ? item.cleanupStatus === "eligible" && item.deletable : !item.deletable)))
    .sort((a, b) => (view.sort === "size" ? b.sizeBytes - a.sizeBytes : 0) ||
      compareTimes(a.createdAt, b.createdAt, view.sort === "oldest") ||
      compareCatalogNames(`${a.kind}:${a.id}`, `${b.kind}:${b.id}`));
