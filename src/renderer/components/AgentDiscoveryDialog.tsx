import { CheckCircle2, Monitor } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TargetInfo } from "../../shared/types";
import type { AgentSetupAction } from "../agentSetup";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { targetIconFor } from "./ProfileSidebar";
import { Button, ModalFrame } from "./ui";

interface AgentDiscoveryDialogProps {
  agents: TargetInfo[];
  busy: boolean;
  open: boolean;
  phase: "choose" | "setup";
  setupActions: Record<string, AgentSetupAction>;
  suppressedAgentIds: string[];
  onConfigure(agentId: string): void;
  onDismiss(): void;
  onEnable(agentIds: string[]): Promise<void>;
  onRestore(agentId: string): Promise<void>;
  onSuppress(agentId: string): Promise<void>;
}

export const AgentDiscoveryDialog = ({
  agents,
  busy,
  open,
  phase,
  setupActions,
  suppressedAgentIds,
  onConfigure,
  onDismiss,
  onEnable,
  onRestore,
  onSuppress
}: AgentDiscoveryDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const agentKey = agents.map((agent) => agent.id).join(":");

  useLayoutEffect(() => {
    if (open && phase === "choose") setSelectedIds(agents.map((agent) => agent.id));
  }, [agentKey, open, phase]);

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: dismissRef,
    onDismiss,
    dismissDisabled: busy
  });

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const suppressed = useMemo(() => new Set(suppressedAgentIds), [suppressedAgentIds]);
  if (!open) return null;
  const setupPhase = phase === "setup";
  const dialogTitle = setupPhase ? t("Agents enabled") : t("Choose Agents");
  const dialogDescription = setupPhase
    ? t("Agent files have not changed. Review an Agent now, or continue later from Agents.")
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
          const evidence = agent.health.executablePath
            ?? agent.health.installationEvidence[0]?.path;
          const checked = selected.has(agent.id);
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
                  disabled={busy}
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
                  {phase === "setup" || evidence ? (
                    <small title={phase === "setup" ? setupCopy : evidence}>
                      {phase === "setup" ? setupCopy : evidence}
                    </small>
                  ) : null}
                </span>
              </label>
              {phase === "setup" ? (
                <Button size="compact" disabled={busy} onClick={() => onConfigure(agent.id)}>
                  {setupLabel}
                </Button>
              ) : (
                <button
                  className="text-action agent-discovery-suppress"
                  type="button"
                  disabled={busy}
                  aria-label={suppressed.has(agent.id)
                    ? t("Suggest {{name}} again", { name: agent.name })
                    : t("Don't suggest {{name}} again", { name: agent.name })}
                  onClick={() => void (suppressed.has(agent.id)
                    ? onRestore(agent.id)
                    : onSuppress(agent.id))}
                >
                  {t(suppressed.has(agent.id) ? "Suggest again" : "Don't suggest again")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <footer className="preview-actions">
        <Button ref={dismissRef} disabled={busy} onClick={onDismiss}>
          {dismissLabel}
        </Button>
        {phase === "choose" && agents.length > 0 ? (
          <Button
            variant="primary"
            busy={busy}
            disabled={selectedIds.length === 0}
            onClick={() => void onEnable(selectedIds)}
          >
            {t(selectedIds.length === 1 ? "Enable 1 Agent" : "Enable {{count}} Agents", {
              count: selectedIds.length
            })}
          </Button>
        ) : null}
      </footer>
    </ModalFrame>
  );
};
