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

  if (isStatic && selectedTarget) {
    const selectedItem = items[0];
    return (
      <div
        aria-label={t("Current Agent {{name}}", { name: selectedTarget.name })}
        className={`agent-context-switcher agent-context-switcher--static ${className}`.trim()}
      >
        <span className="agent-context-switcher__static-icon" aria-hidden="true">
          {selectedItem.icon}
        </span>
        <span className="agent-context-switcher__static-name">{selectedTarget.name}</span>
      </div>
    );
  }

  return (
    <ObjectSwitcher
      ariaLabel={selectionLabel}
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
      showTriggerDescription={false}
      onOpenChange={onOpenChange}
      onQueryChange={onQueryChange}
      onSelect={onSelect}
    />
  );
};
