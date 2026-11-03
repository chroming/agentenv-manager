import { Check, ClipboardCheck, X } from "lucide-react";
import type { WorktreeEntry } from "../../shared/worktrees";
import { canSelectWorktreeForCleanup, isAutomaticCleanupCandidate } from "../../shared/worktrees";
import { useI18n } from "../i18n";
import { selectRepositoryWorktrees, toggleAutomaticWorktreeSelection, worktreeEntryKey, type WorktreeSelection } from "../worktreeSelection";
import { ToolbarOverflowMenu } from "./ui";

export function WorktreeSelectionMenu({ entries, selected, onChange, scope, disabled }: {
  entries: WorktreeEntry[]; selected: WorktreeSelection[];
  onChange(update: (current: WorktreeSelection[]) => WorktreeSelection[]): void;
  scope: "view" | "repository"; disabled: boolean;
}) {
  const { t } = useI18n();
  const eligible = entries.filter(isAutomaticCleanupCandidate);
  const selectedKeys = new Set(selected.map((item) => item.key));
  const label = scope === "view" ? t("Select Worktrees in this view") : t("Select Worktrees in this repository");
  return <ToolbarOverflowMenu triggerVariant="button" triggerContent={t("Select")} labelLayout="wrap"
    label={label}
    menuLabel={label}
    disabled={disabled} items={[
      { id: "automatic", label: t("Select integrated, unchanged Worktrees"), icon: <Check size={15} />,
        title: t("Only integrated Worktrees without local changes or ignored files are selected."), disabled: !eligible.length,
        onSelect: () => onChange((current) => eligible.every((entry) => current.some((item) => item.key === worktreeEntryKey(entry)))
          ? current : toggleAutomaticWorktreeSelection(current, eligible)) },
      { id: "manual", label: t("Select all removable Worktrees"), icon: <ClipboardCheck size={15} />,
        title: t("Includes local changes. Recovery copies are prepared before removal."), disabled: !entries.some(canSelectWorktreeForCleanup),
        onSelect: () => onChange((current) => selectRepositoryWorktrees(current, entries, true)) },
      { id: "clear", label: t("Clear Worktree selection"), icon: <X size={15} />,
        disabled: !entries.some((entry) => selectedKeys.has(worktreeEntryKey(entry))),
        onSelect: () => onChange((current) => selectRepositoryWorktrees(current, entries, false)) }
    ]} />;
}
