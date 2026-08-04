import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type {
  NativeMcpConnection,
  NativeMcpInspectionIssue,
  ProfileResources,
  TargetInfo
} from "../../shared/types";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import { Button, IconButton } from "./ui";
import { ProductIcon } from "../productIcons";

type McpSelectionMode = "agent" | "on" | "off";

const mcpModeOptions: Array<{
  label: "Agent" | "On" | "Off";
  title: "Use Agent setting" | "Turn on in this Profile" | "Turn off in this Profile";
  value: McpSelectionMode;
}> = [
  { label: "Agent", title: "Use Agent setting", value: "agent" },
  { label: "On", title: "Turn on in this Profile", value: "on" },
  { label: "Off", title: "Turn off in this Profile", value: "off" }
];

interface ProfileMcpEditorProps {
  target?: TargetInfo;
  connections?: NativeMcpConnection[];
  issues?: NativeMcpInspectionIssue[];
  value: ProfileResources;
  onChange(value: ProfileResources): void;
  onRefresh(): Promise<void>;
}

export const ProfileMcpEditor = ({
  target,
  connections,
  issues = [],
  value,
  onChange,
  onRefresh
}: ProfileMcpEditorProps) => {
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (!target) {
    return <div className="profile-mcp-empty">{t("Select an Agent to inspect MCP connections.")}</div>;
  }

  const canManage = target.capabilities.mcpActivation === true;
  const policy = value.mcpByTarget[target.id] ?? { mode: "ignore" as const, selections: [] };
  const managing = canManage && policy.mode !== "ignore";
  const targetConnections = (connections ?? []).filter(
    (connection) => connection.targetId === target.id
  );
  const targetIssues = issues.filter((issue) => issue.targetId === target.id);
  const liveNames = new Set(targetConnections.map((connection) => connection.name));
  const rows = [
    ...targetConnections,
    ...policy.selections
      .filter((selection) => !liveNames.has(selection.name))
      .map((selection) => ({
        targetId: target.id,
        name: selection.name,
        scope: "unknown" as const,
        enabled: false,
        controllable: canManage,
        sourcePath: target.paths.mcpConfigPath ?? target.paths.configPath,
        transport: undefined,
        detail: "setup-required"
      }))
  ].sort((left, right) => left.name.localeCompare(right.name));

  const updatePolicy = (nextPolicy: ProfileResources["mcpByTarget"][string]) => {
    onChange({
      ...value,
      mcpByTarget: { ...value.mcpByTarget, [target.id]: nextPolicy }
    });
  };

  const modeFor = (name: string): McpSelectionMode => {
    const selection = policy.selections.find((item) => item.name === name);
    if (!selection) return "agent";
    return selection.enabled ? "on" : "off";
  };

  const updateMode = (name: string, mode: McpSelectionMode) => {
    const otherSelections = policy.selections.filter((selection) => selection.name !== name);
    updatePolicy({
      mode: policy.mode === "ignore" ? "manage" : policy.mode,
      selections: mode === "agent"
        ? otherSelections
        : [...otherSelections, { name, enabled: mode === "on" }]
    });
  };

  const handleModeKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    name: string,
    mode: McpSelectionMode
  ) => {
    const currentIndex = mcpModeOptions.findIndex((option) => option.value === mode);
    let nextIndex: number | undefined;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = mcpModeOptions.length - 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + mcpModeOptions.length) % mcpModeOptions.length;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % mcpModeOptions.length;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextMode = mcpModeOptions[nextIndex]!.value;
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-mcp-mode="${nextMode}"]`)
      ?.focus();
    if (nextMode !== mode) updateMode(name, nextMode);
  };

  return (
    <div className="profile-mcp-editor">
      <div className="profile-mcp-toolbar">
        <span className="profile-mcp-toolbar__scope">
          {t("Configured in {{name}}", { name: target.name })}
        </span>
        <span className="profile-mcp-toolbar__actions">
          {!canManage && policy.mode !== "ignore" ? (
            <Button
              size="compact"
              variant="secondary"
              onClick={() => updatePolicy({ mode: "ignore", selections: policy.selections })}
            >
              {t("Remove override")}
            </Button>
          ) : null}
          <IconButton
            label={t("Refresh MCP connections")}
            size="compact"
            variant="ghost"
            aria-busy={refreshing}
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? (
              <LoaderCircle className="is-spinning" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
          </IconButton>
        </span>
      </div>

      {connections === undefined ? (
        <div className="profile-mcp-empty">{t("Loading MCP connections...")}</div>
      ) : targetIssues.length > 0 ? (
        <div className="profile-mcp-inspection-error" role="alert">
          <AlertTriangle size={17} strokeWidth={2.2} aria-hidden="true" />
          <span>
            <strong>{t("Could not inspect MCP connections")}</strong>
            <small>{targetIssues.map((issue) => issue.message).join(" · ")}</small>
          </span>
          <Button
            busy={refreshing}
            size="compact"
            variant="secondary"
            onClick={() => void refresh()}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="profile-mcp-empty">
          <ProductIcon name="mcps" size={17} strokeWidth={2} />
          <span>{t("No MCP connections are configured in {{name}}.", { name: target.name })}</span>
        </div>
      ) : (
        <div className="profile-mcp-list">
          {rows.map((connection) => {
            const missing = connection.detail === "setup-required";
            const duplicate = connection.detail === "duplicate-user-sources";
            const mode = modeFor(connection.name);
            return (
              <div
                className={`profile-mcp-row${managing ? "" : " is-unmanaged"}`}
                key={`${target.id}:${connection.name}`}
              >
                <span className="profile-mcp-row__identity">
                  <strong>
                    <OverflowTooltip className="profile-mcp-name" text={connection.name} />
                  </strong>
                  <small>
                    {duplicate
                      ? t("Defined in multiple Agent files · Agent controlled")
                      : missing
                      ? mode === "on"
                        ? t("Missing in Agent · Apply blocked")
                        : t("Not configured · No change")
                      : t(connection.enabled ? "On in Agent" : "Off in Agent")}
                    {connection.transport ? ` · ${connection.transport}` : ""}
                  </small>
                </span>
                {!managing ? null : canManage && connection.controllable ? (
                  <div
                    className={`profile-mcp-mode ui-segmented-control ui-segmented-control--compact${mode === "agent" ? "" : " is-profile-override"}`}
                    role="radiogroup"
                    aria-label={t("{{name}} Profile behavior", { name: connection.name })}
                    onKeyDown={(event) => handleModeKeyDown(event, connection.name, mode)}
                  >
                    {mcpModeOptions.map((option) => {
                      const selected = option.value === mode;
                      return (
                        <button
                          className={`profile-mcp-mode__option ui-segmented-control__option${selected ? " is-selected" : ""}`}
                          data-mcp-mode={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          tabIndex={selected ? 0 : -1}
                          title={t(option.title)}
                          key={option.value}
                          onClick={() => {
                            if (!selected) updateMode(connection.name, option.value);
                          }}
                        >
                          {t(option.label)}
                        </button>
                      );
                    })}
                  </div>
                ) : mode !== "agent" ? (
                  <Button
                    className="profile-mcp-reset"
                    size="compact"
                    variant="secondary"
                    onClick={() => updateMode(connection.name, "agent")}
                  >
                    {t("Remove override")}
                  </Button>
                ) : (
                  <span className="profile-mcp-agent-state">
                    {t(!connection.controllable && canManage
                      ? "Agent controlled"
                      : connection.enabled ? "On in Agent" : "Off in Agent")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
