import { AlertTriangle, Network, RefreshCw } from "lucide-react";
import type {
  AssetPolicy,
  NativeMcpConnection,
  NativeMcpInspectionIssue,
  TargetInfo
} from "../../shared/types";
import { OverflowTooltip } from "./OverflowTooltip";
import { useI18n } from "../i18n";

type McpSelectionMode = "agent" | "on" | "off";

interface ProfileMcpEditorProps {
  target?: TargetInfo;
  connections?: NativeMcpConnection[];
  issues?: NativeMcpInspectionIssue[];
  value: AssetPolicy;
  onChange(value: AssetPolicy): void;
  onRefresh(): Promise<void>;
}

const modeFor = (
  value: AssetPolicy,
  targetId: string,
  name: string
): McpSelectionMode => {
  const selection = (value.mcpSelections ?? []).find(
    (item) => item.targetId === targetId && item.name === name
  );
  if (!selection) return "agent";
  return selection.enabled === false ? "off" : "on";
};

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
    return (
      <div className="profile-mcp-empty">
        {t("Select an Agent to inspect MCP connections.")}
      </div>
    );
  }

  const targetConnections = (connections ?? []).filter(
    (connection) => connection.targetId === target.id
  );
  const targetIssues = issues.filter((issue) => issue.targetId === target.id);
  const liveNames = new Set(
    targetConnections.map((connection) => connection.name)
  );
  const missingSelections: NativeMcpConnection[] = (value.mcpSelections ?? [])
    .filter(
      (selection) =>
        selection.targetId === target.id && !liveNames.has(selection.name)
    )
    .map((selection) => ({
      targetId: target.id,
      name: selection.name,
      scope: "unknown" as const,
      enabled: selection.enabled !== false,
      controllable: target.capabilities.mcpActivation === true,
      sourcePath: target.paths.mcpConfigPath ?? target.paths.configPath,
      transport: undefined,
      detail: "setup-required"
    }));
  const rows = [...targetConnections, ...missingSelections].sort(
    (left, right) => left.name.localeCompare(right.name)
  );

  const updateMode = (name: string, mode: McpSelectionMode) => {
    const otherSelections = (value.mcpSelections ?? []).filter(
      (selection) =>
        !(selection.targetId === target.id && selection.name === name)
    );
    onChange({
      ...value,
      mcpSelections:
        mode === "agent"
          ? otherSelections
          : [
              ...otherSelections,
              { targetId: target.id, name, enabled: mode === "on" }
            ]
    });
  };

  return (
    <div className="profile-mcp-editor">
      <header className="profile-mcp-editor__header">
        <div>
          <strong>{target.name}</strong>
          <span>
            {target.capabilities.mcpActivation
              ? t(
                  "Definitions and sign-in stay in the Agent. Choose only what this Profile turns on or off."
                )
              : t(
                  "MCP connections stay controlled by this Agent and are shown here for reference."
                )}
          </span>
        </div>
        <button
          className="icon-action"
          type="button"
          aria-label={t("Refresh MCP connections")}
          title={t("Refresh MCP connections")}
          onClick={() => void onRefresh()}
        >
          <RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </header>
      {connections === undefined ? (
        <div className="profile-mcp-empty">
          {t("Loading MCP connections...")}
        </div>
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
          <span>
            {t("No MCP connections are configured in {{name}}.", {
              name: target.name
            })}
          </span>
        </div>
      ) : (
        <div className="profile-mcp-list">
          {rows.map((connection) => {
            const missing = connection.detail === "setup-required";
            const mode = modeFor(value, target.id, connection.name);
            return (
              <div
                className="profile-mcp-row"
                key={`${target.id}:${connection.name}`}
              >
                <span className="profile-mcp-row__identity">
                  <strong>
                    <OverflowTooltip
                      className="profile-mcp-name"
                      text={connection.name}
                    />
                  </strong>
                  <small>
                    {missing
                      ? t("Setup required")
                      : t(connection.enabled ? "On in Agent" : "Off in Agent")}
                    {connection.transport ? ` · ${connection.transport}` : ""}
                  </small>
                </span>
                {target.capabilities.mcpActivation ? (
                  <select
                    className="profile-mcp-mode"
                    aria-label={t("{{name}} Profile behavior", {
                      name: connection.name
                    })}
                    value={mode}
                    onChange={(event) =>
                      updateMode(
                        connection.name,
                        event.target.value as McpSelectionMode
                      )
                    }
                  >
                    <option value="agent">{t("Use Agent setting")}</option>
                    <option value="on">{t("On")}</option>
                    <option value="off">{t("Off")}</option>
                  </select>
                ) : (
                  <span className="profile-mcp-readonly">
                    {t("Agent controlled")}
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
