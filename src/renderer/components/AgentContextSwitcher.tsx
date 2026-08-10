import { Monitor } from "lucide-react";
import type { TargetInfo } from "../../shared/types";
import { useI18n } from "../i18n";
import { targetIconFor } from "./ProfileSidebar";
import { ObjectSwitcher } from "./ui";

interface AgentContextSwitcherProps {
  className?: string;
  open: boolean;
  query: string;
  selectedId?: string;
  selectionLabel: string;
  targets: TargetInfo[];
  onOpenChange(open: boolean): void;
  onQueryChange(query: string): void;
  onSelect(id: string): void;
}

export const AgentContextSwitcher = ({
  className = "",
  open,
  query,
  selectedId,
  selectionLabel,
  targets,
  onOpenChange,
  onQueryChange,
  onSelect
}: AgentContextSwitcherProps) => {
  const { t } = useI18n();
  const isStatic = targets.length === 1;
  const selectedTarget = targets.find((target) => target.id === selectedId)
    ?? (isStatic ? targets[0] : undefined);
  const items = targets.map((target) => {
    const icon = targetIconFor(target);
    return {
      id: target.id,
      icon: icon.assetUrl ? (
        <img
          className={`agent-context-switcher__logo agent-context-switcher__logo--${icon.flavor}`}
          src={icon.assetUrl}
          alt=""
        />
      ) : (
        <Monitor size={16} strokeWidth={2.1} aria-hidden="true" />
      ),
      searchText: target.name,
      title: target.name
    };
  });

  return (
    <ObjectSwitcher
      ariaLabel={isStatic && selectedTarget
        ? t("Current Agent {{name}}", { name: selectedTarget.name })
        : selectionLabel}
      className={`agent-context-switcher ${className}`.trim()}
      disabled={targets.length === 0}
      emptyMessage={t("No enabled Agents")}
      fullWidth
      items={items}
      open={open}
      query={query}
      searchLabel={t("Search Agents")}
      searchPlaceholder={t("Search Agents")}
      selectedId={selectedTarget?.id}
      static={isStatic}
      showTriggerDescription={false}
      onOpenChange={onOpenChange}
      onQueryChange={onQueryChange}
      onSelect={onSelect}
    />
  );
};
