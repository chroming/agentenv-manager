import { CheckCircle2, Monitor, TriangleAlert } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { isTargetInstalled } from "../../shared/targetHealth";
import type { TargetInfo, TargetManagementState } from "../../shared/types";
import type { AgentSetupAction } from "../agentSetup";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { targetIconFor } from "./ProfileSidebar";
import { Button, ModalFrame } from "./ui";

interface AgentDiscoveryDialogProps {
  agents: TargetInfo[];
  allowSuggestionPreferences: boolean;
  busy: boolean;
  enabledAgentIds: string[];
  managementStates?: TargetManagementState[];
  manualSelection: boolean;
  open: boolean;
  phase: "choose" | "setup";
  setupActions: Record<string, AgentSetupAction>;
  onConfigure(agentId: string): void;
  onDismiss(): void;
  onEnable(agentIds: string[]): Promise<void>;
  onRecovery?(agentId: string): void;
  onSuppress(agentId: string): Promise<void>;
}

export const AgentDiscoveryDialog = ({
  agents,
  allowSuggestionPreferences,
  busy,
  enabledAgentIds,
  managementStates,
  manualSelection,
  open,
  phase,
  setupActions,
  onConfigure,
  onDismiss,
  onEnable,
  onRecovery,
  onSuppress
}: AgentDiscoveryDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const recoveryAgentIds = useMemo(() => new Set(
    (managementStates ?? [])
      .filter((state) => state.lifecycleStatus === "recovery-required")
      .map((state) => state.targetId)
  ), [managementStates]);
  const agentKey = agents
    .map((agent) => `${agent.id}:${isTargetInstalled(agent.health) ? "installed" : "missing"}`)
    .join(":");

  useLayoutEffect(() => {
    if (open && phase === "choose") {
      const defaults = manualSelection
        ? agents.filter((agent) => enabledAgentIds.includes(agent.id)).map((agent) => agent.id)
        : agents.filter((agent) => isTargetInstalled(agent.health)).map((agent) => agent.id);
      setSelectedIds([...new Set([
        ...defaults,
        ...agents.filter((agent) => recoveryAgentIds.has(agent.id)).map((agent) => agent.id)
      ])]);
    }
  }, [agentKey, enabledAgentIds, manualSelection, open, phase, recoveryAgentIds]);

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: dismissRef,
    onDismiss,
    dismissDisabled: busy
  });

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const managedTurnOffCount = (managementStates ?? []).filter((state) =>
    state.status === "managed" &&
    enabledAgentIds.includes(state.targetId) &&
    !selected.has(state.targetId)
  ).length;
  if (!open) return null;
  const setupPhase = phase === "setup";
  const dialogTitle = setupPhase ? t("Agents enabled") : t("Choose Agents");
  const dialogDescription = setupPhase
    ? t("Agent files have not changed. Review an Agent now, or continue later from Agents.")
    : manualSelection
      ? t("Choose which local Agents appear in AgentEnv. Turning one off keeps its files and management records unchanged.")
      : t("AgentEnv found installed Agents. Enabling only adds them to AgentEnv; it does not Capture, Apply, or change Agent files.");
  const dismissLabel = setupPhase ? t("Set up later") : t("Not now");

  return (
    <ModalFrame
      ariaLabel={dialogTitle}
      className="agent-discovery-dialog profile-form-dialog--compact"
      dialogRef={dialogRef}
      dismissDisabled={busy}
      onDismiss={onDismiss}
    >
      <header className="profile-dialog-header">
        <div className="ui-dialog-header__copy">
          <div className="section-title ui-dialog-title">
            {dialogTitle}
          </div>
          <p className="muted ui-dialog-description">
            {dialogDescription}
          </p>
        </div>
      </header>

      <div className="agent-discovery-list">
        {agents.length === 0 ? (
          <div className="inline-state agent-discovery-empty">
            <span className="inline-state__icon" aria-hidden="true"><Monitor size={15} /></span>
            <span>{t("No installed Agents detected")}</span>
          </div>
        ) : null}
        {agents.map((agent) => {
          const icon = targetIconFor(agent);
          const installed = isTargetInstalled(agent.health);
          const evidence = agent.health.executableSource === "bundled-runtime"
            ? agent.health.installationEvidence[0]?.path ?? agent.health.executablePath
            : agent.health.executablePath ?? agent.health.installationEvidence[0]?.path;
          const detectionSummary = !installed
            ? t("Not detected")
            : agent.health.executableSource === "bundled-runtime"
              ? t("Detected via desktop app")
              : agent.health.executableSource === "override"
                ? t("Custom command")
                : t("Detected");
          const checked = selected.has(agent.id);
          const recoveryRequired = recoveryAgentIds.has(agent.id);
          const setupAction = setupActions[agent.id] ?? { kind: "review-current" as const };
          const setupCopy = setupAction.kind === "open-profile"
            ? t("{{name}} is active", { name: setupAction.profileName })
            : setupAction.kind === "continue-profile"
              ? t("Continue with {{name}}", { name: setupAction.profileName })
              : setupAction.kind === "repair-profile"
                ? t("{{name}} needs repair", { name: setupAction.profileName })
                : t("Current setup is ready to review");
          const setupLabel = setupAction.kind === "open-profile"
            ? t("Open Profile")
            : setupAction.kind === "continue-profile"
              ? t("Continue setup")
              : setupAction.kind === "repair-profile"
                ? t("Review Profile")
                : t("Review current setup");
          return (
            <div className={`agent-discovery-row${phase === "setup" ? " agent-discovery-row--setup" : ""}`} key={agent.id}>
              {phase === "choose" ? (
                <input
                  id={`agent-discovery-${agent.id}`}
                  type="checkbox"
                  aria-label={agent.name}
                  checked={checked}
                  disabled={busy || recoveryRequired}
                  onChange={() => setSelectedIds((current) =>
                    checked
                      ? current.filter((id) => id !== agent.id)
                      : [...current, agent.id]
                  )}
                />
              ) : (
                <span className="agent-discovery-ready" aria-hidden="true">
                  <CheckCircle2 size={16} strokeWidth={2.2} />
                </span>
              )}
              <label className="agent-discovery-choice" htmlFor={phase === "choose" ? `agent-discovery-${agent.id}` : undefined}>
                <span className={`agent-settings-icon agent-settings-icon--${icon.flavor}`} aria-hidden="true">
                  {icon.assetUrl ? <img src={icon.assetUrl} alt="" /> : <Monitor size={18} />}
                </span>
                <span className="agent-discovery-copy">
                  <span>{agent.name}</span>
                  <small title={phase === "setup"
                    ? setupCopy
                    : evidence ?? detectionSummary}
                  >
                    {phase === "setup"
                    ? setupCopy
                    : recoveryRequired
                      ? t("Recovery required")
                      : detectionSummary}
                  </small>
                </span>
              </label>
              {phase === "setup" ? (
                <Button size="compact" disabled={busy} onClick={() => onConfigure(agent.id)}>
                  {setupLabel}
                </Button>
              ) : recoveryRequired && onRecovery ? (
                <Button
                  size="compact"
                  variant="ghost"
                  icon={<TriangleAlert size={14} />}
                  disabled={busy}
                  onClick={() => onRecovery(agent.id)}
                >
                  {t("Open Recovery")}
                </Button>
              ) : allowSuggestionPreferences && installed ? (
                <button
                  className="text-action agent-discovery-suppress"
                  type="button"
                  disabled={busy}
                  aria-label={t("Don't suggest {{name}} again", { name: agent.name })}
                  onClick={() => void onSuppress(agent.id)}
                >
                  {t("Don't suggest again")}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {manualSelection && managedTurnOffCount > 0 ? (
        <div className="inline-state agent-discovery-impact" role="status">
          <span className="inline-state__icon" aria-hidden="true"><Monitor size={15} /></span>
          <span>{t(
            managedTurnOffCount === 1
              ? "Turning off 1 managed Agent keeps its files and management records."
              : "Turning off {{count}} managed Agents keeps their files and management records.",
            { count: managedTurnOffCount }
          )}</span>
        </div>
      ) : null}

      <footer className="preview-actions">
        <Button ref={dismissRef} disabled={busy} onClick={onDismiss}>
          {dismissLabel}
        </Button>
        {phase === "choose" && agents.length > 0 ? (
          <Button
            variant="primary"
            busy={busy}
            disabled={!manualSelection && selectedIds.length === 0}
            onClick={() => void onEnable([
              ...new Set([...selectedIds, ...recoveryAgentIds])
            ])}
          >
            {manualSelection
              ? t("Save Agent choices")
              : t(selectedIds.length === 1 ? "Enable 1 Agent" : "Enable {{count}} Agents", {
                  count: selectedIds.length
                })}
          </Button>
        ) : null}
      </footer>
    </ModalFrame>
  );
};
