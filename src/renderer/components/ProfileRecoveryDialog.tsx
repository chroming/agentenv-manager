import { AlertTriangle, History, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  AppliedProfileSnapshotSummary,
  ProfileDetail,
  ProfileRecoverySummary
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  ModalFrame,
  Notice,
  ResourceRow
} from "./ui";

export type ProfileRecoveryMode = "applied" | "history";

export const ProfileRecoveryDialog = ({
  mode,
  open,
  profileId,
  profileName,
  targetName,
  appliedSnapshot,
  onClose,
  onRestored,
  onRestoreApplied
}: {
  mode: ProfileRecoveryMode;
  open: boolean;
  profileId: string;
  profileName: string;
  targetName?: string;
  appliedSnapshot?: AppliedProfileSnapshotSummary;
  onClose(): void;
  onRestored(profile: ProfileDetail): Promise<void> | void;
  onRestoreApplied?(): Promise<void>;
}) => {
  const { t, formatDate } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<ProfileRecoverySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setItems([]);
    setError("");
    try {
      setItems(await window.agentEnv.listProfileRecovery(profileId));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && mode === "history") void load();
  }, [mode, open, profileId]);

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: closeRef,
    dismissDisabled: Boolean(busyId),
    onDismiss: onClose
  });

  const restore = async (item: ProfileRecoverySummary) => {
    setBusyId(item.id);
    setError("");
    try {
      const restored = await window.agentEnv.restoreProfileRecovery(profileId, item.id);
      await onRestored(restored);
      onClose();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusyId(undefined);
    }
  };

  const restoreApplied = async () => {
    if (!onRestoreApplied) return;
    setBusyId("applied");
    setError("");
    try {
      await onRestoreApplied();
      onClose();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusyId(undefined);
    }
  };

  if (!open) return null;
  const dialogTitle = mode === "applied"
    ? t("Restore last applied Profile")
    : t("Profile Recovery");
  return (
    <ModalFrame
      ariaLabel={dialogTitle}
      className="project-recovery-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={Boolean(busyId)}
      onDismiss={onClose}
    >
      <DialogHeader
        title={dialogTitle}
        description={mode === "applied"
          ? t("Restore {{name}} to the version last successfully applied to {{target}}. Agent files will not be changed.", {
              name: profileName,
              target: targetName ?? t("this Agent")
            })
          : t("Restore an earlier saved version of {{name}}. Agents will not be changed.", { name: profileName })}
      />
      <DialogBody className="project-recovery-dialog__body">
        {error ? (
          <Notice tone="danger" role="alert" icon={<AlertTriangle size={15} />}>{error}</Notice>
        ) : null}
        {mode === "history" && loading ? <div className="project-editor-loading">{t("Loading recovery points…")}</div> : null}
        {mode === "history" && !loading && items.length === 0 ? (
          <div className="project-recovery-empty">{t("No earlier Profile versions are available.")}</div>
        ) : null}
        {mode === "applied" && appliedSnapshot ? (
          <ResourceRow
            className="project-recovery-entry"
            density="default"
            description={t("{{skills}} Skills · {{mcps}} MCPs · {{characters}} instruction characters", {
              skills: appliedSnapshot.skillCount,
              mcps: appliedSnapshot.mcpCount,
              characters: appliedSnapshot.instructionsLength
            })}
            icon={<RotateCcw size={15} />}
            metadata={t("Applied {{date}}", { date: formatDate(appliedSnapshot.capturedAt) })}
            title={appliedSnapshot.profileName}
          />
        ) : null}
        {mode === "history" && items.map((item) => (
          <ResourceRow
            className="project-recovery-entry"
            density="default"
            description={t("{{skills}} Skills · {{mcps}} MCPs · {{characters}} instruction characters", {
              skills: item.skillCount,
              mcps: item.mcpCount,
              characters: item.instructionsLength
            })}
            icon={<History size={15} />}
            key={item.id}
            metadata={formatDate(item.createdAt)}
            title={item.profileName}
            actions={(
              <Button
                size="compact"
                icon={<RotateCcw size={14} />}
                busy={busyId === item.id}
                disabled={Boolean(busyId)}
                onClick={() => void restore(item)}
              >
                {t("Restore")}
              </Button>
            )}
          />
        ))}
      </DialogBody>
      <DialogFooter>
        <Button ref={closeRef} disabled={Boolean(busyId)} onClick={onClose}>{t("Close")}</Button>
        {mode === "applied" ? (
          <Button
            variant="primary"
            icon={<RotateCcw size={14} />}
            busy={busyId === "applied"}
            disabled={Boolean(busyId) || !appliedSnapshot || !onRestoreApplied}
            onClick={() => void restoreApplied()}
          >
            {t("Restore Profile")}
          </Button>
        ) : null}
      </DialogFooter>
    </ModalFrame>
  );
};
