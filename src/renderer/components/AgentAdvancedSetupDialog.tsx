import { FolderOpen, Monitor, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TargetInfo, TargetManagementState } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  ModalFrame,
  TextField
} from "./ui";

interface AgentAdvancedSetupDialogProps {
  busy: boolean;
  commandOverride?: string;
  configRoot?: string;
  open: boolean;
  target?: TargetInfo;
  managementState?: TargetManagementState;
  onChooseConfigRoot(targetId: string): Promise<void>;
  onClose(): void;
  onResolveOwnership(targetId: string): void;
  onResetConfigRoot(targetId: string): Promise<void>;
  onSetCommandOverride(targetId: string, command?: string): Promise<void>;
}

export const AgentAdvancedSetupDialog = ({
  busy,
  commandOverride,
  configRoot,
  open,
  target,
  managementState,
  onChooseConfigRoot,
  onClose,
  onResolveOwnership,
  onResetConfigRoot,
  onSetCommandOverride
}: AgentAdvancedSetupDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [commandDraft, setCommandDraft] = useState(commandOverride ?? "");
  const [pendingAction, setPendingAction] = useState<"choose-root" | "reset-root" | "save-command" | "reset-command">();

  useEffect(() => setCommandDraft(commandOverride ?? ""), [commandOverride, target?.id]);
  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: closeRef,
    onDismiss: onClose,
    dismissDisabled: busy || Boolean(pendingAction)
  });

  if (!open || !target) return null;
  const defaultCommand = target.executableCandidates[0] ?? target.executableName ?? t("Unavailable");
  const rootPath = configRoot ?? target.paths.configDir;
  const rootChangeBlocked = managementState?.status === "managed";
  const recoveryRequired = managementState?.lifecycleStatus === "recovery-required";
  const run = async (
    action: NonNullable<typeof pendingAction>,
    operation: () => Promise<void>
  ) => {
    setPendingAction(action);
    try {
      await operation();
    } finally {
      setPendingAction(undefined);
    }
  };

  return (
    <ModalFrame
      ariaLabel={t("Advanced setup for {{name}}", { name: target.name })}
      className="agent-advanced-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={busy || Boolean(pendingAction)}
      onDismiss={onClose}
    >
      <DialogHeader
        title={t("Advanced setup")}
        description={target.name}
      />
      <DialogBody className="agent-advanced-dialog__body">
        <section className="agent-advanced-section" aria-labelledby="agent-advanced-folder-heading">
          <div className="agent-advanced-section__heading">
            <div>
              <strong id="agent-advanced-folder-heading">{t("Agent folder")}</strong>
              <small>{t("Choose where AgentEnv reads and manages this Agent's global files. Existing files are not moved.")}</small>
            </div>
            <div className="settings-row-actions">
              <IconButton
                busy={pendingAction === "choose-root"}
                disabled={busy || Boolean(pendingAction) || rootChangeBlocked}
                label={t("Choose folder")}
                onClick={() => void run("choose-root", () => onChooseConfigRoot(target.id))}
              >
                <FolderOpen size={15} />
              </IconButton>
              {configRoot ? (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={busy || Boolean(pendingAction) || rootChangeBlocked}
                  onClick={() => void run("reset-root", () => onResetConfigRoot(target.id))}
                >
                  {t("Use default")}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="agent-advanced-value">
            <Monitor size={14} aria-hidden="true" />
            <OverflowTooltip className="agent-advanced-path" text={rootPath} />
          </div>
          {rootChangeBlocked ? (
            <div className="ui-notice ui-notice--warning agent-advanced-ownership" role="status">
              <span className="ui-notice__icon" aria-hidden="true"><TriangleAlert size={15} /></span>
              <div className="ui-notice__copy">
                <strong>{t(recoveryRequired ? "Recovery required" : "Agent folder is managed")}</strong>
                <span>{t(recoveryRequired
                  ? "Complete recovery before changing this Agent folder."
                  : "Stop AgentEnv management before changing this Agent folder.")}</span>
              </div>
              <div className="ui-notice__actions">
                <Button
                  size="compact"
                  variant="secondary"
                  disabled={busy || Boolean(pendingAction)}
                  onClick={() => onResolveOwnership(target.id)}
                >
                  {t(recoveryRequired ? "Open Recovery" : "Stop managing")}
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="agent-advanced-section" aria-labelledby="agent-advanced-command-heading">
          <div className="agent-advanced-section__heading">
            <div>
              <strong id="agent-advanced-command-heading">{t("Launch command")}</strong>
              <small>{t("Override command detection and launch for this Agent. Managed file boundaries do not change.")}</small>
            </div>
          </div>
          <TextField
            id={`agent-command-${target.id}`}
            autoComplete="off"
            disabled={busy || Boolean(pendingAction)}
            label={t("Command for {{name}}", { name: target.name })}
            labelHidden
            placeholder={defaultCommand}
            spellCheck={false}
            value={commandDraft}
            onChange={(event) => setCommandDraft(event.target.value)}
          />
          <div className="agent-advanced-command-actions">
            <span className="muted">{t("Default: {{command}}", { command: defaultCommand })}</span>
            <div className="settings-row-actions">
              {commandOverride ? (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={busy || Boolean(pendingAction)}
                  onClick={() => void run("reset-command", async () => {
                    await onSetCommandOverride(target.id);
                    setCommandDraft("");
                  })}
                >
                  {t("Use default")}
                </Button>
              ) : null}
              <Button
                size="compact"
                variant="primary"
                busy={pendingAction === "save-command"}
                disabled={
                  busy ||
                  Boolean(pendingAction) ||
                  !commandDraft.trim() ||
                  commandDraft.trim() === (commandOverride ?? "")
                }
                onClick={() => void run("save-command", () =>
                  onSetCommandOverride(target.id, commandDraft.trim()))}
              >
                {t("Save")}
              </Button>
            </div>
          </div>
        </section>
      </DialogBody>
      <DialogFooter>
        <Button ref={closeRef} disabled={busy || Boolean(pendingAction)} onClick={onClose}>
          {t("Close")}
        </Button>
      </DialogFooter>
    </ModalFrame>
  );
};
