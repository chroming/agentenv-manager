import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import type {
  NativeMcpConnection,
  NativeMcpInspectionIssue,
  ProfileResources,
  TargetInfo
} from "../../shared/types";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import { Button, RefreshAction, ResourcePanelToolbar, Switch } from "./ui";
import { ProductIcon } from "../productIcons";

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
  const profileManages = canManage && policy.mode === "manage";
  const profileDisables = policy.mode === "disable";
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

  const explicitStateFor = (name: string): boolean | undefined => {
    const selection = policy.selections.find((item) => item.name === name);
    return selection?.enabled;
  };

  const effectiveStateFor = (name: string, enabled: boolean) => {
    if (profileDisables) return false;
    if (policy.mode === "ignore") return enabled;
    return explicitStateFor(name) ?? enabled;
  };

  const updateState = (name: string, enabled: boolean) => {
    const otherSelections = policy.selections.filter((selection) => selection.name !== name);
    updatePolicy({
      mode: policy.mode === "ignore" ? "manage" : policy.mode,
      selections: [...otherSelections, { name, enabled }]
    });
  };

  return (
    <div className="profile-mcp-editor">
      <ResourcePanelToolbar
        aria-label={t("Profile MCP actions")}
        className="profile-mcp-toolbar"
      >
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
          <RefreshAction
            label={t("Refresh MCP connections")}
            presentation="icon"
            size="compact"
            variant="ghost"
            busy={refreshing}
            onRefresh={() => void refresh()}
          />
        </span>
      </ResourcePanelToolbar>

      {connections === undefined ? (
        <div className="profile-mcp-empty">{t("Loading MCP connections...")}</div>
      ) : targetIssues.length > 0 ? (
        <div className="profile-mcp-inspection-error" role="alert">
          <AlertTriangle size={17} strokeWidth={2.2} aria-hidden="true" />
          <span>
            <strong>{t("Could not inspect MCP connections")}</strong>
            <small>{targetIssues.map((issue) => issue.message).join(" · ")}</small>
          </span>
          <RefreshAction
            busy={refreshing}
            label={t("Retry")}
            size="compact"
            variant="secondary"
            onRefresh={() => void refresh()}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="profile-mcp-empty">
          <ProductIcon name="mcps" size={17} strokeWidth={2} />
          <span>{t("No MCP connections are configured in {{name}}.", { name: target.name })}</span>
        </div>
      ) : (
        <div className="ui-resource-children profile-mcp-list">
          {rows.map((connection) => {
            const missing = connection.detail === "setup-required";
            const duplicate = connection.detail === "duplicate-user-sources";
            const effectiveEnabled = effectiveStateFor(connection.name, connection.enabled);
            const editable = profileManages && connection.controllable;
            return (
              <div
                className={`ui-resource-children__item profile-mcp-row${profileDisables ? " is-policy-disabled" : ""}${
                  policy.mode === "ignore" ? " is-unmanaged" : ""
                }`}
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
                      ? effectiveEnabled
                        ? t("Missing in Agent · Apply blocked")
                        : t("Not configured · No change")
                      : t(connection.enabled ? "On in Agent" : "Off in Agent")}
                    {connection.transport ? ` · ${connection.transport}` : ""}
                  </small>
                </span>
                {canManage && connection.controllable ? (
                  <Switch
                    className="profile-mcp-switch"
                    checked={effectiveEnabled}
                    disabled={!editable}
                    label={t(effectiveEnabled ? "Turn off {{name}}" : "Turn on {{name}}", {
                      name: connection.name
                    })}
                    onClick={() => updateState(connection.name, !effectiveEnabled)}
                  />
                ) : effectiveEnabled !== undefined ? (
                  <span className="profile-mcp-agent-state">
                    {t("Agent controlled")}
                  </span>
                ) : (
                  <span className="profile-mcp-agent-state">
                    {t("Unavailable")}
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
