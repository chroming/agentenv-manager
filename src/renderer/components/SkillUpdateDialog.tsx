import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Maximize2
} from "lucide-react";
import type { PlannedFileChange, SkillUpdatePlan } from "../../shared/types";
import type { SkillUpdateRunItem } from "../skillUpdateQueue";
import type { SkillUpdateActionResult } from "../skillLibraryContracts";
import { useModalDialog } from "../hooks/useModalDialog";
import { DiffViewer } from "./DiffViewer";
import { DiffWorkspaceDialog } from "./DiffWorkspaceDialog";
import { Button, IconButton, ModalFrame, Switch } from "./ui";
import { useI18n } from "../i18n";

interface SkillUpdateDialogProps {
  plan?: SkillUpdatePlan;
  impact?: string;
  busy?: boolean;
  progress?: SkillUpdateRunItem;
  onClose(): void;
  onReadChange?(previewId: string, path: string): Promise<PlannedFileChange>;
  onConfirm(
    plan: SkillUpdatePlan,
    syncCopiedInstalls?: boolean
  ): Promise<SkillUpdateActionResult>;
}

const SkillUpdateChange = ({
  change,
  initiallyOpen,
  onReadChange
}: {
  change: PlannedFileChange;
  initiallyOpen: boolean;
  onReadChange?(): Promise<PlannedFileChange>;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(initiallyOpen);
  const [resolved, setResolved] = useState<PlannedFileChange>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const visibleChange = resolved ?? change;

  useEffect(() => {
    if (!open || !change.contentDeferred || resolved || !onReadChange) return;
    let active = true;
    setLoading(true);
    setError("");
    void onReadChange().then(
      (next) => {
        if (active) setResolved(next);
      },
      (nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    ).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [change.contentDeferred, onReadChange, open, resolved]);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{change.path}</summary>
      {open && loading ? (
        <div className="inline-loading" role="status">
          <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
          <span>{t("Loading preview")}</span>
        </div>
      ) : null}
      {open && error ? <p className="field-error">{error}</p> : null}
      {open && !loading && !error ? (
        <DiffViewer path={visibleChange.path} diff={visibleChange.diff} />
      ) : null}
    </details>
  );
};

export const SkillUpdateDialog = ({
  plan,
  impact,
  busy = false,
  progress,
  onClose,
  onReadChange,
  onConfirm
}: SkillUpdateDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const expandPreviewRef = useRef<HTMLButtonElement>(null);
  const [diffWorkspaceOpen, setDiffWorkspaceOpen] = useState(false);
  const [commitResult, setCommitResult] = useState<SkillUpdateActionResult>();
  const [syncCopiedInstalls, setSyncCopiedInstalls] = useState(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setCommitResult(undefined);
    setSyncCopiedInstalls(false);
  }, [plan?.previewId]);

  useEffect(() => {
    if (
      commitResult?.status !== "completed" ||
      busy ||
      diffWorkspaceOpen ||
      progress?.status !== "updated"
    ) {
      return;
    }
    const timeout = window.setTimeout(() => onCloseRef.current(), 700);
    return () => window.clearTimeout(timeout);
  }, [busy, commitResult?.status, diffWorkspaceOpen, progress?.status]);

  useModalDialog({
    open: Boolean(plan),
    dialogRef,
    initialFocusRef,
    onDismiss: onClose,
    dismissDisabled: busy,
    focusKey: plan?.id
  });

  if (!plan || plan.changes.length === 0) {
    return null;
  }

  const planImpact = plan.impact ?? {
    profileNames: [],
    linkedInstallCount: 0,
    linkedTargetIds: [],
    copiedInstallCount: 0,
    copiedTargetIds: []
  };
  const impactSummary = impact ?? (() => {
    const parts: string[] = [];
    if (planImpact.profileNames.length > 0) {
      parts.push(t("Used by {{count}} Profiles", { count: planImpact.profileNames.length }));
    }
    if (planImpact.linkedInstallCount > 0) {
      parts.push(t("{{count}} linked Agent installs change immediately", {
        count: planImpact.linkedInstallCount
      }));
    }
    if (planImpact.copiedInstallCount > 0) {
      parts.push(t(
        syncCopiedInstalls
          ? "{{count}} copied Agent installs update with this Library change"
          : "{{count}} copied Agent installs will need Apply",
        { count: planImpact.copiedInstallCount }
      ));
    }
    return parts.length > 0
      ? parts.join(" · ")
      : t("No Profiles or managed Agent installs currently use this Skill");
  })();
  const completionError = commitResult?.status === "partial" ? commitResult.error : undefined;
  const progressLabel = completionError
    ? t("Updated with issues")
    : progress?.status === "queued"
    ? t("Waiting")
    : progress?.status === "updating"
      ? t("Updating...")
      : progress?.status === "updated"
        ? t("Done")
        : progress?.status === "failed"
          ? t("Failed")
          : undefined;
  const running = progress?.status === "queued" || progress?.status === "updating";
  const finished = progress?.status === "updated" || progress?.status === "failed";

  return (
    <>
      <ModalFrame
      ariaLabel={t("Update preview for {{id}}", { id: plan.id })}
      className="skill-update-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={busy}
      onDismiss={onClose}
      suspended={diffWorkspaceOpen}
    >
        <header className="profile-dialog-header ui-dialog-header">
          <div className="ui-dialog-header__copy">
            <div className="section-title ui-dialog-title">{t("Update {{name}}", { name: plan.name })}</div>
            <p className="muted ui-dialog-description">
              {t("{{count}} file changes", { count: plan.changes.length })}
              {plan.latestRevision
                ? ` · ${(plan.currentRevision ?? "current").slice(0, 7)} → ${plan.latestRevision.slice(0, 7)}`
                : ""}
            </p>
            <p className="skill-update-impact">{impactSummary}</p>
            {progressLabel ? (
              <div
                className={`skill-update-progress skill-update-progress--${completionError ? "failed" : progress!.status}`}
                role="status"
                aria-label={t("{{name}}: {{status}}", {
                  name: plan.name,
                  status: progressLabel
                })}
              >
                {completionError ? (
                  <CircleAlert size={15} aria-hidden="true" />
                ) : progress!.status === "queued" ? (
                  <Clock3 size={15} aria-hidden="true" />
                ) : progress!.status === "updating" ? (
                  <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
                ) : progress!.status === "updated" ? (
                  <CheckCircle2 size={15} aria-hidden="true" />
                ) : (
                  <CircleAlert size={15} aria-hidden="true" />
                )}
                <span>
                  <strong>{progressLabel}</strong>
                  {completionError || progress?.error ? (
                    <small>{completionError ?? progress?.error}</small>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>
          <IconButton
            ref={expandPreviewRef}
            label={t("Maximize preview")}
            size="compact"
            variant="ghost"
            onClick={() => setDiffWorkspaceOpen(true)}
          >
            <Maximize2 size={16} strokeWidth={2.2} />
          </IconButton>
        </header>
        <div className="skill-update-dialog__body">
          {planImpact.copiedInstallCount > 0 && progress?.status !== "updated" ? (
            <div className="skill-update-copy-option">
              <span className="skill-update-copy-option__copy">
                <strong>{t("Also update Agent copies")}</strong>
                <small>
                  {syncCopiedInstalls
                    ? t("{{count}} clean managed copies will update in the same backed-up operation.", {
                        count: planImpact.copiedInstallCount
                      })
                    : t("Off: {{count}} Agent copies will show Apply pending.", {
                        count: planImpact.copiedInstallCount
                      })}
                </small>
              </span>
              <Switch
                checked={syncCopiedInstalls}
                disabled={busy || running}
                label={t("Also update Agent copies")}
                onClick={() => setSyncCopiedInstalls((current) => !current)}
              />
            </div>
          ) : null}
          <div className="update-change-list ui-dialog-body">
            {plan.changes.map((change, index) => (
              <SkillUpdateChange
                change={change}
                initiallyOpen={index === 0}
                key={change.path}
                onReadChange={plan.previewId && onReadChange
                  ? () => onReadChange(plan.previewId!, change.path)
                  : undefined}
              />
            ))}
          </div>
        </div>
        <footer className="preview-actions ui-dialog-footer">
          <Button
            ref={initialFocusRef}
            disabled={running || (busy && !finished)}
            onClick={onClose}
          >
            {t(finished ? "Close" : "Cancel")}
          </Button>
          {progress?.status !== "updated" ? (
            <Button
              aria-label={t(
                running
                  ? "Updating {{id}}"
                  : progress?.status === "failed"
                    ? "Retry update {{id}}"
                    : "Apply update {{id}}",
                { id: plan.id }
              )}
              busy={running}
              busyLabel={t("Updating...")}
              disabled={running || (busy && progress?.status !== "failed")}
              variant="primary"
              onClick={() => {
                setCommitResult(undefined);
                void Promise.resolve(onConfirm(plan, syncCopiedInstalls)).then((result) => {
                  if (result) setCommitResult(result);
                });
              }}
            >
              {t(
                progress?.status === "failed"
                    ? "Retry"
                    : "Update Skill"
              )}
            </Button>
          ) : null}
        </footer>
      </ModalFrame>
      <DiffWorkspaceDialog
        changes={plan.changes}
        onReadChange={plan.previewId && onReadChange
          ? (change) => onReadChange(plan.previewId!, change.path)
          : undefined}
        open={diffWorkspaceOpen}
        returnFocusRef={expandPreviewRef}
        title={t("Update {{name}}", { name: plan.name })}
        onClose={() => setDiffWorkspaceOpen(false)}
      />
    </>
  );
};
