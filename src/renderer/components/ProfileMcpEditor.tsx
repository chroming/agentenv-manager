import { AlertTriangle, Network, RefreshCw } from "lucide-react";
import type {
  NativeMcpConnection,
  NativeMcpInspectionIssue,
  ProfileResources,
  TargetInfo
} from "../../shared/types";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";

type McpSelectionMode = "agent" | "on" | "off";

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
  if (!target) {
    return <div className="profile-mcp-empty">{t("Select an Agent to inspect MCP connections.")}</div>;
  }

  const canManage = target.capabilities.mcpActivation === true;
  const policy = value.mcpByTarget[target.id] ?? { mode: "ignore" as const, selections: [] };
  const managing = canManage && policy.mode === "manage";
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
      mode: "manage",
      selections: mode === "agent"
        ? otherSelections
        : [...otherSelections, { name, enabled: mode === "on" }]
    });
  };

  return (
    <div className="profile-mcp-editor">
      <div className="profile-mcp-toolbar">
        <span>{t("{{count}} MCPs", { count: rows.length })}</span>
        <span className="profile-mcp-toolbar__actions">
          {!canManage && policy.mode === "manage" ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => updatePolicy({ mode: "ignore", selections: policy.selections })}
            >
              {t("Remove override")}
            </button>
          ) : null}
          <button
            className="icon-action"
            type="button"
            aria-label={t("Refresh MCP connections")}
            title={t("Refresh MCP connections")}
            onClick={() => void onRefresh()}
          >
            <RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" />
          </button>
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
          <button className="secondary-action" type="button" onClick={() => void onRefresh()}>
            {t("Retry")}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="profile-mcp-empty">
          <Network size={17} strokeWidth={2} aria-hidden="true" />
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
                      ? t("Defined in multiple Agent files · Unchanged")
                      : missing
                      ? mode === "on"
                        ? t("Missing in Agent · Apply blocked")
                        : t("Not configured · No change")
                      : t(connection.enabled ? "On in Agent" : "Off in Agent")}
                    {connection.transport ? ` · ${connection.transport}` : ""}
                  </small>
                </span>
                {!managing ? null : canManage && connection.controllable ? (
                  <select
                    className="profile-mcp-mode"
                    aria-label={t("{{name}} Profile behavior", { name: connection.name })}
                    value={mode}
                    disabled={!managing}
                    onChange={(event) => updateMode(connection.name, event.target.value as McpSelectionMode)}
                  >
                    <option value="agent">{t("Unchanged")}</option>
                    <option value="on">{t("On")}</option>
                    <option value="off">{t("Off")}</option>
                  </select>
                ) : mode !== "agent" ? (
                  <button
                    className="secondary-action profile-mcp-reset"
                    type="button"
                    onClick={() => updateMode(connection.name, "agent")}
                  >
                    {t("Remove override")}
                  </button>
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
