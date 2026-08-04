import { LoaderCircle, Monitor, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  TargetDescriptor,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import { targetIconFor } from "./ProfileSidebar";
import { Button, Switch } from "./ui";

interface AgentSettingsSectionProps {
  supportedAgents: TargetDescriptor[];
  enabledAgentIds: string[];
  agents: TargetInfo[];
  agentStates: TargetManagementState[];
  suppressedAgentIds: string[];
  busy: boolean;
  onSetEnabled(agentId: string, enabled: boolean): Promise<void>;
  onSetSuggestionSuppressed(agentId: string, suppressed: boolean): Promise<void>;
  onOpenRecovery(): void;
  configRoots: Record<string, string>;
  commandOverrides: Record<string, string>;
  onChooseConfigRoot(agentId: string): Promise<void>;
  onResetConfigRoot(agentId: string): Promise<void>;
  onSetCommandOverride(agentId: string, command?: string): Promise<void>;
}

const healthLabel: Record<TargetInfo["health"]["status"], string> = {
  ready: "Ready",
  "needs-setup": "Needs setup",
  missing: "Not detected",
  guarded: "Protected",
  unknown: "Check failed"
};

export const AgentSettingsSection = ({
  supportedAgents,
  enabledAgentIds,
  agents,
  agentStates,
  suppressedAgentIds,
  busy,
  onSetEnabled,
  onSetSuggestionSuppressed,
  onOpenRecovery,
  configRoots,
  commandOverrides,
  onChooseConfigRoot,
  onResetConfigRoot,
  onSetCommandOverride
}: AgentSettingsSectionProps) => {
  const { t } = useI18n();
  const [disableCandidate, setDisableCandidate] = useState<TargetDescriptor>();
  const [pendingAgentId, setPendingAgentId] = useState<string>();
  const [pendingPathAction, setPendingPathAction] = useState<{
    agentId: string;
    action: "choose" | "reset";
  }>();
  const [commandDrafts, setCommandDrafts] = useState<Record<string, string>>(
    commandOverrides
  );
  const [pendingCommandAgentId, setPendingCommandAgentId] = useState<string>();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pendingReturnFocusRef = useRef<HTMLElement | null>(null);
  const enabledIds = new Set(enabledAgentIds);
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const statesById = new Map(agentStates.map((state) => [state.targetId, state]));
  const suppressedIds = new Set(suppressedAgentIds);

  useEffect(() => {
    setCommandDrafts(commandOverrides);
  }, [commandOverrides]);

  useEffect(() => {
    const returnTarget = pendingReturnFocusRef.current;
    if (pendingAgentId || !returnTarget) return undefined;
    pendingReturnFocusRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (returnTarget.isConnected && !returnTarget.matches(":disabled")) {
        returnTarget.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingAgentId]);

  useModalDialog({
    open: Boolean(disableCandidate),
    dialogRef,
    initialFocusRef: cancelRef,
    fallbackFocusRef: returnFocusRef,
    dismissDisabled: busy,
    onDismiss: () => setDisableCandidate(undefined)
  });

  const commitChange = async (agentId: string, enabled: boolean) => {
    setPendingAgentId(agentId);
    try {
      await onSetEnabled(agentId, enabled);
    } finally {
      setPendingAgentId(undefined);
    }
  };

  const requestChange = (agent: TargetDescriptor, enabled: boolean) => {
    if (enabled) {
      void commitChange(agent.id, true);
      return;
    }
    const state = statesById.get(agent.id);
    if (state?.status === "managed") {
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setDisableCandidate(agent);
      return;
    }
    void onSetEnabled(agent.id, false);
  };

  const commitPathChange = async (
    agentId: string,
    action: "choose" | "reset"
  ) => {
    setPendingPathAction({ agentId, action });
    try {
      if (action === "choose") await onChooseConfigRoot(agentId);
      else await onResetConfigRoot(agentId);
    } finally {
      setPendingPathAction(undefined);
    }
  };

  const commitCommandOverride = async (agentId: string, command?: string) => {
    setPendingCommandAgentId(agentId);
    try {
      await onSetCommandOverride(agentId, command);
    } finally {
      setPendingCommandAgentId(undefined);
    }
  };

  return (
    <>
      <section className="resource-section settings-section" aria-labelledby="agent-settings-heading">
        <div className="settings-section-title">
          <div>
            <div className="resource-heading" id="agent-settings-heading">{t("Agents")}</div>
            <p className="settings-muted">
              {t("Choose which local Agents AgentEnv displays and can manage. Detection remains read-only.")}
            </p>
          </div>
        </div>
        <div className="agent-settings-list">
          {supportedAgents.map((agent) => {
            const enabled = enabledIds.has(agent.id);
            const detected = agentsById.get(agent.id);
            const state = statesById.get(agent.id);
            const recoveryRequired = state?.lifecycleStatus === "recovery-required";
            const icon = targetIconFor(agent);
            return (
              <div className="agent-settings-row" key={agent.id}>
                <span className={`agent-settings-icon agent-settings-icon--${icon.flavor}`} aria-hidden="true">
                  {icon.assetUrl ? <img src={icon.assetUrl} alt="" /> : <Monitor size={18} />}
                </span>
                <span className="agent-settings-copy">
                  <strong>{agent.name}</strong>
                  <small>{t(agent.description)}</small>
                </span>
                <div className="agent-settings-state">
                  <span className={`agent-settings-status${recoveryRequired ? " is-warning" : ""}`}>
                    {pendingAgentId === agent.id ? (
                      <><LoaderCircle className="is-spinning" size={14} aria-hidden="true" />{t("Saving...")}</>
                    ) : recoveryRequired ? (
                      <><TriangleAlert size={14} aria-hidden="true" />{t("Recovery required")}</>
                    ) : !enabled ? (
                      t("Off")
                    ) : detected ? (
                      t(healthLabel[detected.health.status])
                    ) : (
                      <><LoaderCircle className="is-spinning" size={14} aria-hidden="true" />{t("Checking...")}</>
                    )}
                  </span>
                  {recoveryRequired ? (
                    <button className="text-action" type="button" onClick={onOpenRecovery}>
                      {t("Open Recovery")}
                    </button>
                  ) : null}
                  {!enabled && suppressedIds.has(agent.id) ? (
                    <button
                      className="text-action"
                      type="button"
                      disabled={busy || Boolean(pendingAgentId)}
                      aria-label={t("Suggest {{name}} again", { name: agent.name })}
                      onClick={() => void onSetSuggestionSuppressed(agent.id, false)}
                    >
                      {t("Suggest again")}
                    </button>
                  ) : null}
                </div>
                <Switch
                  checked={enabled}
                  disabled={busy || Boolean(pendingAgentId) || recoveryRequired}
                  label={t(enabled ? "Turn off {{name}}" : "Turn on {{name}}", { name: agent.name })}
                  onClick={() => requestChange(agent, !enabled)}
                />
              </div>
            );
          })}
        </div>
        <details className="agent-path-settings">
          <summary>{t("Custom folders")}</summary>
          <p className="settings-muted">
            {t("Choose where AgentEnv reads and manages each Agent's global files. Existing files are not moved.")}
          </p>
          <div className="agent-path-list">
            {supportedAgents.map((agent) => {
              const customRoot = configRoots[agent.id];
              const defaultRoot = agentsById.get(agent.id)?.paths.configDir;
              const pendingAction = pendingPathAction?.agentId === agent.id
                ? pendingPathAction.action
                : undefined;
              const fullPath = customRoot ?? defaultRoot ?? t("Default location");
              return (
                <div className="agent-path-row" key={agent.id} aria-busy={Boolean(pendingAction)}>
                  <span className="agent-path-copy">
                    <strong>{agent.name}</strong>
                    <OverflowTooltip
                      className="agent-path-value"
                      displayText={customRoot
                        ? `${t("Custom")} · ${customRoot.split(/[\\/]/).filter(Boolean).slice(-2).join("/")}`
                        : t("Default location")}
                      text={fullPath}
                    />
                  </span>
                  <Button
                    size="compact"
                    disabled={busy || Boolean(pendingPathAction)}
                    icon={pendingAction === "choose" ? <LoaderCircle className="is-spinning" size={14} /> : undefined}
                    onClick={() => void commitPathChange(agent.id, "choose")}
                  >
                    {pendingAction === "choose"
                      ? t("Choosing...")
                      : customRoot
                        ? t("Change")
                        : t("Choose")}
                  </Button>
                  {customRoot ? (
                    <button
                      className="text-action agent-path-reset"
                      type="button"
                      disabled={busy || Boolean(pendingPathAction)}
                      onClick={() => void commitPathChange(agent.id, "reset")}
                    >
                      {pendingAction === "reset" ? (
                        <LoaderCircle className="is-spinning" size={14} aria-hidden="true" />
                      ) : null}
                      {pendingAction === "reset" ? t("Saving...") : t("Use default")}
                    </button>
                  ) : <span aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        </details>
        <details className="agent-path-settings agent-command-settings">
          <summary>{t("Custom commands")}</summary>
          <p className="settings-muted">
            {t("Override command detection and launch for an Agent. This never changes which files AgentEnv may manage.")}
          </p>
          <div className="agent-command-list">
            {supportedAgents.map((agent) => {
              const savedCommand = commandOverrides[agent.id] ?? "";
              const draft = commandDrafts[agent.id] ?? "";
              const pending = pendingCommandAgentId === agent.id;
              return (
                <div className="agent-command-row" key={agent.id} aria-busy={pending}>
                  <label className="agent-command-copy" htmlFor={`agent-command-${agent.id}`}>
                    <strong>{agent.name}</strong>
                    <small>{t("Default: {{command}}", {
                      command: agent.executableCandidates[0] ?? agent.executableName ?? t("Unavailable")
                    })}</small>
                  </label>
                  <input
                    id={`agent-command-${agent.id}`}
                    aria-label={t("Command for {{name}}", { name: agent.name })}
                    autoComplete="off"
                    disabled={busy || Boolean(pendingCommandAgentId)}
                    placeholder={agent.executableCandidates[0] ?? agent.executableName}
                    spellCheck={false}
                    value={draft}
                    onChange={(event) => setCommandDrafts((current) => ({
                      ...current,
                      [agent.id]: event.target.value
                    }))}
                  />
                  <Button
                    size="compact"
                    aria-label={t("Save {{name}} command", { name: agent.name })}
                    disabled={
                      busy ||
                      Boolean(pendingCommandAgentId) ||
                      !draft.trim() ||
                      draft.trim() === savedCommand
                    }
                    icon={pending ? <LoaderCircle className="is-spinning" size={14} /> : undefined}
                    onClick={() => void commitCommandOverride(agent.id, draft.trim())}
                  >
                    {pending ? t("Saving...") : t("Save")}
                  </Button>
                  {savedCommand ? (
                    <button
                      className="text-action agent-command-reset"
                      type="button"
                      aria-label={t("Use default {{name}} command", { name: agent.name })}
                      disabled={busy || Boolean(pendingCommandAgentId)}
                      onClick={() => void commitCommandOverride(agent.id)}
                    >
                      {t("Use default")}
                    </button>
                  ) : <span aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        </details>
      </section>

      {disableCandidate ? (
        <div
          className="preview-modal-backdrop"
          data-dismiss-policy="standard"
          onClick={busy ? undefined : () => setDisableCandidate(undefined)}
        >
          <section
            ref={dialogRef}
            className="profile-form-dialog profile-form-dialog--compact"
            role="dialog"
            aria-modal="true"
            aria-label={t("Turn off {{name}}?", { name: disableCandidate.name })}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="profile-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Turn off {{name}}?", { name: disableCandidate.name })}</div>
                <p className="muted ui-dialog-description">
                  {t("Its current files stay unchanged. AgentEnv will stop showing, checking, and applying to this Agent until you turn it on again. Existing managed files stay in place; turn this Agent on again before changing or recovering them.")}
                </p>
              </div>
            </header>
            <footer className="preview-actions">
              <Button ref={cancelRef} disabled={busy} onClick={() => setDisableCandidate(undefined)}>
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  const agentId = disableCandidate.id;
                  pendingReturnFocusRef.current = returnFocusRef.current;
                  setDisableCandidate(undefined);
                  void commitChange(agentId, false);
                }}
              >
                {t("Turn off {{name}}", { name: disableCandidate.name })}
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
};
