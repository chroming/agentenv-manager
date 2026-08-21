import type { TargetInfo } from "../../shared/types";
import { useI18n } from "../i18n";
import { AgentEndpointIcon } from "./AgentEndpointIcon";
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
    const isRemote = target.location?.kind === "ssh";
    const title = target.location?.agentName ?? target.name;
    const description = isRemote ? `${target.location?.deviceName} · SSH` : undefined;
    const unavailable = isRemote && target.health.status !== "ready";
    return {
      id: target.id,
      ariaLabel: description ? `${title} · ${description}` : title,
      description,
      disabled: unavailable,
      groupLabel: isRemote ? target.location?.deviceName : t("This Mac"),
      icon: <AgentEndpointIcon target={target} size={16} />,
      searchText: [title, description, target.location?.host].filter(Boolean).join(" "),
      status: unavailable ? t("Offline") : undefined,
      title,
      tooltip: unavailable ? target.health.summary : undefined
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
        <span className="agent-context-switcher__static-copy">
          <span className="agent-context-switcher__static-name">
            {selectedTarget.location?.agentName ?? selectedTarget.name}
          </span>
          {selectedTarget.location ? (
            <span className="agent-context-switcher__static-location">
              {selectedTarget.location.deviceName} · SSH
            </span>
          ) : null}
        </span>
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
