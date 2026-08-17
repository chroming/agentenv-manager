import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Maximize2,
  MinusCircle,
  TriangleAlert
} from "lucide-react";
import type {
  SkillUpdatePlan,
  SkillUpdatePreviewBatchResult
} from "../../shared/types";
import type { SkillUpdateRun, SkillUpdateRunItem } from "../skillUpdateQueue";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { DiffWorkspaceDialog } from "./DiffWorkspaceDialog";
import { OverflowTooltip as PreviewText } from "./OverflowTooltip";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  ModalFrame,
  Switch
} from "./ui";

interface BulkSkillUpdateDialogProps {
  plans: SkillUpdatePlan[];
  failures: SkillUpdatePreviewBatchResult["failed"];
  updateRun: SkillUpdateRun;
  isBusy: boolean;
  previewingAllUpdates: boolean;
  updateActivityBusy: boolean;
  stopRequested: boolean;
  onClose(): void;
  onPreview(ids: string[]): void;
  onStop(): void;
  onUpdate(plans: SkillUpdatePlan[], syncCopiedInstalls?: boolean): void;
}

const isRunning = (item?: SkillUpdateRunItem) =>
  item?.status === "queued" || item?.status === "updating";

const isFinished = (item?: SkillUpdateRunItem) =>
  item?.status === "updated" || item?.status === "failed" || item?.status === "skipped";

export const BulkSkillUpdateDialog = ({
  plans,
  failures,
  updateRun,
  isBusy,
  previewingAllUpdates,
  updateActivityBusy,
  stopRequested,
  onClose,
  onPreview,
  onStop,
  onUpdate
}: BulkSkillUpdateDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const expandPreviewRef = useRef<HTMLButtonElement>(null);
  const [diffWorkspaceOpen, setDiffWorkspaceOpen] = useState(false);
  const [syncCopiedInstalls, setSyncCopiedInstalls] = useState(false);
  const applicablePlans = plans.filter(
    (plan) => plan.changes.length > 0 && plan.errors.length === 0
  );
  const started = applicablePlans.some((plan) => Boolean(updateRun[plan.id]));
  const running = applicablePlans.some((plan) => isRunning(updateRun[plan.id]));
  const completedCount = applicablePlans.filter((plan) => isFinished(updateRun[plan.id])).length;
  const failedPlans = applicablePlans.filter((plan) => updateRun[plan.id]?.status === "failed");
  const skippedPlans = applicablePlans.filter((plan) => updateRun[plan.id]?.status === "skipped");
  const finished = started && !running && completedCount === applicablePlans.length;
  const copiedInstallCount = applicablePlans.reduce(
    (total, plan) => total + (plan.impact?.copiedInstallCount ?? 0),
    0
  );
  const dismissDisabled = previewingAllUpdates || running || (isBusy && !finished);
  const workspaceChanges = useMemo(
    () => plans.flatMap((plan) => plan.changes.map((change) => ({
      ...change,
      path: `${plan.name}/${change.path}`
    }))),
    [plans]
  );
  useModalDialog({
    open: true,
    dialogRef,
    initialFocusRef,
    dismissDisabled,
    onDismiss: onClose
  });

  const progressLabel = (progress?: SkillUpdateRunItem) => progress?.status === "queued"
    ? t("Waiting")
    : progress?.status === "updating"
      ? t("Updating...")
      : progress?.status === "updated"
        ? t("Done")
        : progress?.status === "failed"
          ? t("Failed")
          : progress?.status === "skipped"
            ? t("Skipped")
            : undefined;

  return (
    <>
      <ModalFrame
        ariaLabel={t("Update all skills")}
        className="bulk-update-dialog ui-dialog-shell"
        dialogRef={dialogRef}
        dismissDisabled={dismissDisabled}
        onDismiss={onClose}
        suspended={diffWorkspaceOpen}
      >
        <DialogHeader
          title={t("Update all skills")}
          description={t("Review every tracked change before updating the shared library.")}
          actions={(
            <IconButton
              ref={expandPreviewRef}
              label={t("Maximize preview")}
              variant="ghost"
              disabled={workspaceChanges.length === 0}
              onClick={() => setDiffWorkspaceOpen(true)}
            >
              <Maximize2 size={16} strokeWidth={2.2} />
            </IconButton>
          )}
        />
        <DialogBody className="bulk-update-body">
          {copiedInstallCount > 0 && !started ? (
            <div className="skill-update-copy-option">
              <span className="skill-update-copy-option__copy">
                <strong>{t("Also update Agent copies")}</strong>
                <small>
                  {syncCopiedInstalls
                    ? t("{{count}} clean managed copies will update in the same backed-up operation.", {
                        count: copiedInstallCount
                      })
                    : t("Off: {{count}} Agent copies will show Apply pending.", {
                        count: copiedInstallCount
                      })}
                </small>
              </span>
              <Switch
                checked={syncCopiedInstalls}
                disabled={isBusy || updateActivityBusy}
                label={t("Also update Agent copies")}
                onClick={() => setSyncCopiedInstalls((current) => !current)}
              />
            </div>
          ) : null}
          <div className="bulk-update-list">
            {failures.length > 0 ? (
              <section className="bulk-update-failures" aria-label={t("Preview failures")}>
                <div className="bulk-update-failures__heading">
                  <TriangleAlert size={15} aria-hidden="true" />
                  <strong>
                    {t("{{count}} update previews could not be prepared", {
                      count: failures.length
                    })}
                  </strong>
                </div>
                {failures.map((failure) => (
                  <div className="bulk-update-failure" key={failure.id}>
                    <strong>{failure.id}</strong>
                    <PreviewText className="bulk-update-failure__error" text={failure.error} />
                  </div>
                ))}
              </section>
            ) : null}
            {plans.map((plan) => {
              const progress = updateRun[plan.id];
              const label = progressLabel(progress);
              return (
                <details
                  key={plan.id}
                  open={plan.errors.length > 0 || progress?.status === "failed"}
                >
                  <summary>
                    <span className="bulk-update-summary-identity">
                      <ChevronDown className="bulk-update-disclosure" size={15} strokeWidth={2.2} />
                      <strong>{plan.name}</strong>
                    </span>
                    <span className="bulk-update-summary-meta">
                      <span>
                        {plan.errors.length > 0
                          ? t("Blocked")
                          : t("{{count}} file changes", { count: plan.changes.length })}
                      </span>
                      {progress && label ? (
                        <span
                          className={`bulk-update-progress bulk-update-progress--${progress.status}`}
                          role="status"
                          aria-label={t("{{name}}: {{status}}", { name: plan.name, status: label })}
                        >
                          {progress.status === "queued" ? (
                            <Clock3 size={13} aria-hidden="true" />
                          ) : progress.status === "updating" ? (
                            <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
                          ) : progress.status === "updated" ? (
                            <CheckCircle2 size={13} aria-hidden="true" />
                          ) : progress.status === "skipped" ? (
                            <MinusCircle size={13} aria-hidden="true" />
                          ) : (
                            <CircleAlert size={13} aria-hidden="true" />
                          )}
                          {label}
                        </span>
                      ) : null}
                    </span>
                  </summary>
                  {plan.impact ? (
                    <p className="skill-update-impact">
                      {t(syncCopiedInstalls
                        ? "{{profiles}} Profiles · {{linked}} linked installs update now · {{copied}} copied installs update now"
                        : "{{profiles}} Profiles · {{linked}} linked installs update now · {{copied}} copied installs need Apply", {
                        profiles: plan.impact.profileNames.length,
                        linked: plan.impact.linkedInstallCount,
                        copied: plan.impact.copiedInstallCount
                      })}
                    </p>
                  ) : null}
                  {plan.errors.map((error) => <p className="error" key={error}>{error}</p>)}
                  {progress?.error ? (
                    <div className="bulk-update-run-error">
                      <PreviewText className="bulk-update-run-error__message" text={progress.error} />
                      <Button disabled={isBusy || running} size="compact" onClick={() => onUpdate([plan], syncCopiedInstalls)}>
                        {t("Retry")}
                      </Button>
                    </div>
                  ) : null}
                  {plan.changes.map((change) => <code key={change.path}>{change.path}</code>)}
                </details>
              );
            })}
          </div>
        </DialogBody>
        <DialogFooter className="preview-actions">
          <Button ref={initialFocusRef} disabled={dismissDisabled} onClick={onClose}>
            {t(started ? "Close" : "Cancel")}
          </Button>
          {running ? (
            <Button disabled={stopRequested} onClick={onStop}>
              {t(stopRequested ? "Stopping..." : "Stop")}
            </Button>
          ) : null}
          {failures.length > 0 ? (
            <Button
              disabled={isBusy || previewingAllUpdates || running}
              busy={previewingAllUpdates}
              onClick={() => onPreview([
                ...plans.map((plan) => plan.id),
                ...failures.map((failure) => failure.id)
              ])}
            >
              {t(isBusy ? "Preparing..." : "Retry failed previews")}
            </Button>
          ) : null}
          {finished && failedPlans.length > 0 ? (
            <Button disabled={isBusy} onClick={() => onUpdate(failedPlans, syncCopiedInstalls)}>
              {t("Retry failed updates")}
            </Button>
          ) : null}
          {running ? (
            <Button busy variant="primary" disabled>
              {t("Updating {{completed}} of {{total}}", {
                completed: completedCount,
                total: applicablePlans.length
              })}
            </Button>
          ) : skippedPlans.length > 0 ? (
            <Button
              variant="primary"
              disabled={isBusy || updateActivityBusy}
              onClick={() => onUpdate(skippedPlans, syncCopiedInstalls)}
            >
              {t("Continue updates")}
            </Button>
          ) : !started ? (
            <Button
              variant="primary"
              disabled={isBusy || updateActivityBusy || applicablePlans.length === 0}
              onClick={() => onUpdate(applicablePlans, syncCopiedInstalls)}
            >
              {t(
                applicablePlans.length === 1 ? "Update {{count}} skill" : "Update {{count}} skills",
                { count: applicablePlans.length }
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </ModalFrame>
      <DiffWorkspaceDialog
        changes={workspaceChanges}
        open={diffWorkspaceOpen}
        returnFocusRef={expandPreviewRef}
        title={t("Update all skills")}
        onClose={() => setDiffWorkspaceOpen(false)}
      />
    </>
  );
};
