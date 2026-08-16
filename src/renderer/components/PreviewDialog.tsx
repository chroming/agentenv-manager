import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Layers3,
  ShieldCheck
} from "lucide-react";
import type {
  ApplyIssue,
  ActivationPreview,
  RollbackPreview,
  StopManagingPreview
} from "../../shared/types";
import { useI18n, type TranslationValues } from "../i18n";
import { activationPreviewHasWork } from "../activationPreview";
import { ProductIcon } from "../productIcons";
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";
import { OverflowTooltip } from "./OverflowTooltip";
import { PreviewChangeList } from "./PreviewChangeList";
import { DiffWorkspaceDialog } from "./DiffWorkspaceDialog";
import { Button, type ButtonVariant } from "./ui";

interface PreviewDialogProps {
  preview?: ActivationPreview | RollbackPreview | StopManagingPreview;
  title?: string;
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
  cancelDisabled?: boolean;
  confirmLabel?: string;
  confirmVariant?: ButtonVariant;
  cancelLabel?: string;
  errorMessage?: string;
  compareDisabled?: boolean;
  compareDescription?: string;
  suspended?: boolean;
  targetNames?: TargetNameIndex;
  onOpenRecovery?(): void;
  onAdoptTargetChanges?(): void;
  onCompare?(): void;
  onLeaveSkillUnmanaged?(issue: ApplyIssue): Promise<void> | void;
  onReviewSkillCollection?(issue: ApplyIssue): void;
  onManageLocalSkills?(): void;
  onManageSharedSkills?(): void;
  onCancel?(): void;
  onConfirm?(): void;
}

const FOCUSABLE_SELECTOR = [
  "summary",
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const presentIssue = (
  issue: ApplyIssue,
  targetName: string,
  t: (message: string, values?: TranslationValues) => string
) => {
  if (issue.code === "managed-resource-drift") {
    const kind = issue.resourceKind === "instructions" ? t("Instructions") : t("Skill");
    const identity =
      issue.resourceKind !== "instructions" && issue.resourceId ? ` ${issue.resourceId}` : "";
    return {
      title: t("{{kind}}{{identity}} changed outside AgentEnv", { kind, identity }),
      detail: issue.detail ?? issue.path
    };
  }

  if (issue.code === "outside-skill-replacement") {
    const identity = issue.resourceId ?? t("unnamed Skill");
    return {
      title: t('Bring Skill "{{name}}" under AgentEnv', { name: identity }),
      detail: issue.detail ?? issue.path
    };
  }

  if (issue.code === "outside-skill-removal") {
    const identity = issue.resourceId ?? t("unnamed Skill");
    return {
      title: t('Remove external Skill "{{name}}"', { name: identity }),
      detail: issue.detail ?? issue.path
    };
  }

  return { title: t(issue.message), detail: issue.detail ?? issue.path };
};

export const PreviewDialog = ({
  preview,
  title = "Preview",
  confirmDisabled = false,
  confirmBusy = false,
  cancelDisabled = false,
  confirmLabel = "Confirm",
  confirmVariant = "primary",
  cancelLabel = "Cancel",
  errorMessage,
  compareDisabled = false,
  compareDescription,
  suspended = false,
  targetNames = {},
  onOpenRecovery,
  onAdoptTargetChanges,
  onCompare,
  onLeaveSkillUnmanaged,
  onReviewSkillCollection,
  onManageLocalSkills,
  onManageSharedSkills,
  onCancel,
  onConfirm
}: PreviewDialogProps) => {
  const { t } = useI18n();
  const hasActions = Boolean(onCancel || onConfirm);
  const isModalOpen = Boolean(preview && hasActions && !suspended);
  const dialogRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const expandPreviewRef = useRef<HTMLButtonElement>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  const [resolvingIssueId, setResolvingIssueId] = useState<string>();
  const [diffWorkspaceOpen, setDiffWorkspaceOpen] = useState(false);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const updateBodyOverflow = () => {
    const body = bodyRef.current;
    if (!body) {
      setHasMoreBelow(false);
      return;
    }
    setHasMoreBelow(body.scrollTop + body.clientHeight < body.scrollHeight - 2);
  };

  useEffect(() => {
    if (!preview || !hasActions) {
      setHasMoreBelow(false);
      return undefined;
    }
    const frame = window.requestAnimationFrame(updateBodyOverflow);
    window.addEventListener("resize", updateBodyOverflow);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateBodyOverflow);
    };
  }, [preview, hasActions]);

  useEffect(() => {
    if (!isModalOpen) return undefined;

    const invokingControl =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    cancelButtonRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Tab") return;

      const dialog = dialogRef.current;
      const modalDialogs = document.querySelectorAll<HTMLElement>(
        '[role="dialog"][aria-modal="true"]'
      );
      const topmostDialog = modalDialogs.item(modalDialogs.length - 1);
      if (!dialog || topmostDialog !== dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (onCancelRef.current) {
          onCancelRef.current();
        }
        return;
      }

      const focusableControls = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusableControls.length === 0) return;

      const firstControl = focusableControls[0];
      const lastControl = focusableControls.at(-1);
      if (!focusableControls.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? lastControl : firstControl)?.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl?.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (invokingControl?.isConnected) invokingControl.focus();
    };
  }, [isModalOpen]);

  if (!preview) return null;

  const targetName =
    "targetName" in preview
      ? preview.targetName
      : "targetId" in preview
        ? targetNameFor(preview.targetId, targetNames, "Agent")
        : "Agent";
  const isActivationPreview = "profileId" in preview;
  const issues: ApplyIssue[] = isActivationPreview
    ? preview.issues
    : [
        ...preview.errors.map((message, index) => ({
          id: `legacy-block:${index}`,
          code: "operation-precondition" as const,
          disposition: "block" as const,
          resolution: "external-action" as const,
          resourceKind: "target" as const,
          message
        })),
        ...preview.warnings.map((message, index) => ({
          id: `legacy-notice:${index}`,
          code: "operation-notice" as const,
          disposition: "notice" as const,
          resolution: "preserve" as const,
          resourceKind: "target" as const,
          message
        }))
      ];
  const managedDriftIssues = issues.filter((issue) => issue.code === "managed-resource-drift");
  const blockedItems = issues
    .filter((issue) => issue.disposition === "block")
    .map((issue) => ({ issue, id: issue.id, ...presentIssue(issue, targetName, t) }));
  const reviewItems = issues
    .filter((issue) => issue.disposition === "review")
    .map((issue) => ({ issue, id: issue.id, ...presentIssue(issue, targetName, t) }));
  const preservedItems = issues
    .filter((issue) => issue.disposition === "notice" && issue.resolution === "preserve")
    .map((issue) => ({ issue, id: issue.id, ...presentIssue(issue, targetName, t) }));
  const noteItems = issues
    .filter((issue) => issue.disposition === "notice" && issue.resolution !== "preserve")
    .map((issue) => ({ id: issue.id, ...presentIssue(issue, targetName, t) }));
  const sharedSkillItems = preservedItems.filter(
    (item) => item.issue.code === "shared-skill-deferred"
  );
  const sharedSkillPaths = [...new Set(
    sharedSkillItems.flatMap((item) => item.issue.path ? [item.issue.path] : [])
  )];
  const payload = isActivationPreview ? preview.effectivePayload : undefined;
  const isNoOp =
    isActivationPreview &&
    !activationPreviewHasWork(preview);
  const status =
    blockedItems.length > 0 ? "blocked" : reviewItems.length > 0 ? "review" : "ready";
  const statusTitle =
    status === "blocked"
      ? t("Cannot apply")
      : status === "review"
        ? t("Review required")
        : isNoOp
          ? t("No changes to apply")
          : t("Ready to apply");
  const statusDetail =
    status === "blocked"
      ? isActivationPreview
        ? t("Resolve {{count}} blocking issues before applying this Profile.", {
            count: blockedItems.length
          })
        : t("Resolve {{count}} blocking issues before continuing.", {
            count: blockedItems.length
          })
      : status === "review"
        ? t("Existing Agent resources need confirmation before they can be replaced.")
        : isNoOp
          ? t("This Agent already matches the Profile.")
        : isActivationPreview
          ? t("Review the changes below before applying this Profile.")
          : t("Review the changes below before continuing.");
  const genericOutcome =
    "mode" in preview
      ? preview.mode === "keep-current"
        ? t("{{target}} files will stay in place and AgentEnv ownership will be removed.", {
            target: targetName
          })
        : t("{{target}} will be restored to its pre-takeover environment.", {
            target: targetName
          })
      : t("Review the changes below before continuing.");

  const issueList = (
    items: Array<{ issue: ApplyIssue; id: string; title: string; detail?: string }>,
    kind: "blocked" | "review"
  ) => (
    <section className={`apply-preview-issues apply-preview-issues--${kind}`}>
      <header>
        {kind === "blocked" ? (
          <Ban size={17} strokeWidth={2.1} aria-hidden="true" />
        ) : (
          <AlertTriangle size={17} strokeWidth={2.1} aria-hidden="true" />
        )}
        <strong>
          {kind === "blocked" ? t("Blocking issues") : t("Protected Agent changes")}
        </strong>
        <span className="apply-preview-count">{items.length}</span>
      </header>
      <div>
        {items.map((item) => (
          <article key={item.id}>
            <strong>{item.title}</strong>
            {kind === "review" &&
            onLeaveSkillUnmanaged &&
            (item.issue.code === "outside-skill-replacement" ||
              item.issue.code === "outside-skill-removal") ? (
              <Button
                className="apply-preview-issue-action"
                disabled={Boolean(resolvingIssueId)}
                busy={resolvingIssueId === item.id}
                size="compact"
                onClick={() => {
                  setResolvingIssueId(item.id);
                  void Promise.resolve(onLeaveSkillUnmanaged(item.issue)).finally(() => {
                    setResolvingIssueId(undefined);
                  });
                }}
              >
                {t("Leave unmanaged")}
              </Button>
            ) : null}
            {kind === "blocked" &&
            onReviewSkillCollection &&
            item.issue.resolution === "review-local-skills" ? (
              <Button
                className="apply-preview-issue-action"
                size="compact"
                onClick={() => onReviewSkillCollection(item.issue)}
              >
                {t("Review collection")}
              </Button>
            ) : null}
            {item.detail ? (
              <OverflowTooltip
                ariaLabel={t("Full issue detail")}
                className="apply-preview-issue-detail apply-preview-issue-location"
                displayText={item.detail}
                text={item.detail}
                tooltipClassName="apply-preview-path-tooltip"
              />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );

  const content = (
    <section
      ref={dialogRef}
      className={`preview-dialog${hasActions ? " preview-dialog--modal apply-preview-dialog" : ""}`}
      role={hasActions ? "dialog" : undefined}
      aria-label={t("Preview")}
      aria-hidden={hasActions && (diffWorkspaceOpen || suspended) ? true : undefined}
      aria-modal={hasActions && !diffWorkspaceOpen && !suspended ? true : undefined}
      inert={hasActions && (diffWorkspaceOpen || suspended) ? true : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="preview-header ui-dialog-header">
        <div>
          <div className="section-title">{t(title)}</div>
          <p className="preview-outcome">
            {isActivationPreview
              ? t("Based on the current {{target}} environment.", { target: targetName })
              : genericOutcome}
          </p>
        </div>
      </header>

      <div className="apply-preview-body-frame">
        <div
          ref={bodyRef}
          className="apply-preview-body"
          onScroll={updateBodyOverflow}
          onClick={() => window.requestAnimationFrame(updateBodyOverflow)}
        >
          <section
            className={`apply-preview-status apply-preview-status--${status}`}
            aria-label={statusTitle}
          >
            <span className="apply-preview-status__icon" aria-hidden="true">
              {status === "blocked" ? (
                <Ban size={20} strokeWidth={2.1} />
              ) : status === "review" ? (
                <CircleAlert size={20} strokeWidth={2.1} />
              ) : (
                <CheckCircle2 size={20} strokeWidth={2.1} />
              )}
            </span>
            <span>
              <strong>{statusTitle}</strong>
              <small>{statusDetail}</small>
            </span>
          </section>

          {blockedItems.length > 0 ? issueList(blockedItems, "blocked") : null}
          {reviewItems.length > 0 ? issueList(reviewItems, "review") : null}

          {managedDriftIssues.length > 0 && (onAdoptTargetChanges || onOpenRecovery) ? (
            <section
              className="preview-drift-recovery"
              aria-label={t("Protected Agent change options")}
            >
              <div className="preview-drift-actions">
                {onAdoptTargetChanges ? (
                  <Button
                    size="compact"
                    variant="secondary"
                    onClick={onAdoptTargetChanges}
                  >
                    {t("Adopt compatible changes")}
                  </Button>
                ) : null}
                {onOpenRecovery ? (
                  <Button
                    size="compact"
                    variant="secondary"
                    onClick={onOpenRecovery}
                  >
                    {t("Open recovery history")}
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {sharedSkillItems.length > 0 ? (
            <section
              className="apply-preview-shared-boundary"
              aria-label={t("Shared Skills remain Agent controlled")}
            >
              <span className="apply-preview-shared-boundary__icon" aria-hidden="true">
                <AlertTriangle size={17} strokeWidth={2.1} />
              </span>
              <span className="apply-preview-shared-boundary__copy">
                <strong>{t("Shared Skills remain Agent controlled")}</strong>
                <small>{t(
                  "This Apply keeps shared copies active, so this Profile cannot control their availability."
                )}</small>
                {sharedSkillPaths.length > 0 ? (
                  <OverflowTooltip
                    ariaLabel={t("Shared Skill paths")}
                    className="apply-preview-shared-boundary__path"
                    displayText={sharedSkillPaths.length > 1
                      ? t("{{path}} and {{count}} more", {
                          path: sharedSkillPaths[0],
                          count: sharedSkillPaths.length - 1
                        })
                      : sharedSkillPaths[0]}
                    text={sharedSkillPaths.join("\n")}
                  />
                ) : null}
              </span>
              {onManageSharedSkills ? (
                <Button
                  className="apply-preview-shared-boundary__action"
                  disabled={confirmBusy}
                  icon={<Layers3 size={14} strokeWidth={2.1} />}
                  size="compact"
                  variant="warning"
                  onClick={onManageSharedSkills}
                >
                  {t("Move and remove shared copies…")}
                </Button>
              ) : null}
            </section>
          ) : null}

          {payload && !isNoOp ? (
            <section className="apply-preview-payload" aria-label={t("After applying")}>
              <header className="apply-preview-section-heading">
                <strong>{t("After applying")}</strong>
              </header>
              <div>
                <article>
                  <ProductIcon name="instructions" size={18} strokeWidth={2} />
                  <span>
                    <strong>{payload.instructions}</strong>
                    <small>{t("Instruction files")}</small>
                  </span>
                </article>
                <article>
                  <ProductIcon name="skills" size={18} strokeWidth={2} />
                  <span>
                    <strong>{payload.skills}</strong>
                    <small>{t(sharedSkillItems.length > 0 ? "Skills after move" : "Skills")}</small>
                  </span>
                </article>
                <article>
                  <ProductIcon name="mcps" size={18} strokeWidth={2} />
                  <span>
                    <strong>{payload.mcpServers}</strong>
                    <small>{t("MCP overrides")}</small>
                  </span>
                </article>
              </div>
            </section>
          ) : null}

          {isActivationPreview && preview.localFootprint && !isNoOp ? (
            <section className="apply-preview-footprint" aria-label={t("Local footprint")}>
              <header className="apply-preview-section-heading">
                <strong>{t("Local footprint")}</strong>
                {onManageLocalSkills ? (
                  <Button
                    className="apply-preview-manage-skills"
                    disabled={confirmBusy}
                    icon={<Layers3 size={14} strokeWidth={2.1} />}
                    size="compact"
                    variant="secondary"
                    onClick={onManageLocalSkills}
                  >
                    {t("Review local Skills")}
                  </Button>
                ) : null}
              </header>
              <div>
                <span>{t("Adopt existing")}: <strong>{preview.localFootprint.adopted}</strong></span>
                <span>{t("Modify")}: <strong>{preview.localFootprint.modified}</strong></span>
                <span>{t("Create")}: <strong>{preview.localFootprint.created}</strong></span>
                <span>{t("Remove")}: <strong>{preview.localFootprint.removed}</strong></span>
                <span>{t("Live links")}: <strong>{preview.localFootprint.liveLinks}</strong></span>
              </div>
            </section>
          ) : null}

          {isActivationPreview && !preview.localFootprint && !isNoOp && onManageLocalSkills ? (
            <div className="apply-preview-secondary-actions">
              <Button
                className="apply-preview-manage-skills"
                disabled={confirmBusy}
                icon={<Layers3 size={14} strokeWidth={2.1} />}
                size="compact"
                variant="secondary"
                onClick={onManageLocalSkills}
              >
                {t("Review local Skills")}
              </Button>
            </div>
          ) : null}

          <PreviewChangeList
            preview={preview}
            activation={isActivationPreview}
            expandButtonRef={expandPreviewRef}
            onExpandPreview={() => setDiffWorkspaceOpen(true)}
          />

          {noteItems.length > 0 ? (
            <details className="apply-preview-disclosure">
              <summary>
                <span>{t("Review notes")}</span>
                <strong>{noteItems.length}</strong>
              </summary>
              <div>
                {noteItems.map((item) => (
                  <article key={item.id}>
                    <strong>{item.title}</strong>
                    {item.detail ? <span>{item.detail}</span> : null}
                  </article>
                ))}
              </div>
            </details>
          ) : null}

          {preservedItems.length > 0 ? (
            <details className="apply-preview-disclosure">
              <summary>
                <span>{t("Preserved outside this Profile")}</span>
                <strong>{preservedItems.length}</strong>
              </summary>
              <div>
                {preservedItems.map((item) => (
                  <article key={item.id}>
                    <strong>{item.title}</strong>
                    {item.detail ? (
                      <OverflowTooltip
                        ariaLabel={t("Full preserved path")}
                        className="apply-preview-issue-detail"
                        text={item.detail}
                        tooltipClassName="apply-preview-path-tooltip"
                      />
                    ) : null}
                  </article>
                ))}
              </div>
            </details>
          ) : null}

          {errorMessage ? (
            <p className="error preview-action-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
        {hasMoreBelow ? (
          <div className="apply-preview-scroll-cue" aria-hidden="true">
            <ChevronDown size={14} strokeWidth={2.2} />
            <span>{t("More changes below")}</span>
          </div>
        ) : null}
      </div>

      {hasActions ? (
        <footer className={`preview-actions ui-dialog-footer${onCompare ? " has-compare" : ""}`}>
          <p className={`apply-preview-footer-note apply-preview-footer-note--${status}`}>
            <ShieldCheck size={15} strokeWidth={2} aria-hidden="true" />
            <span>
              {status === "blocked"
                ? isActivationPreview
                  ? t("Resolve blocking issues before Apply.")
                  : t("Resolve blocking issues before continuing.")
                : isNoOp
                  ? t("No files or AgentEnv state will change.")
                : isActivationPreview
                    ? t("A recovery point will be created before changes.")
                    : t("Review the changes below before continuing.")}
            </span>
          </p>
          <Button
            ref={cancelButtonRef}
            disabled={cancelDisabled}
            variant="secondary"
            onClick={onCancel}
          >
            {t(isNoOp ? "Close" : cancelLabel)}
          </Button>
          {!isNoOp && onCompare ? (
            <Button
              disabled={compareDisabled || confirmBusy}
              title={compareDescription}
              variant="secondary"
              onClick={onCompare}
            >
              {t("Compare")}
            </Button>
          ) : null}
          {!isNoOp ? (
            <Button
              disabled={confirmDisabled}
              busy={confirmBusy}
              variant={confirmVariant}
              onClick={onConfirm}
            >
              {t(confirmLabel)}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );

  const workspace = (
    <DiffWorkspaceDialog
      changes={preview.changes}
      open={diffWorkspaceOpen}
      returnFocusRef={expandPreviewRef}
      title={t("Planned changes")}
      onClose={() => setDiffWorkspaceOpen(false)}
    />
  );
  if (!hasActions) return <>{content}{workspace}</>;
  return (
    <>
      <div
        className={`preview-modal-backdrop apply-preview-backdrop${diffWorkspaceOpen || suspended ? " is-suspended" : ""}`}
        data-dismiss-policy="standard"
        onClick={diffWorkspaceOpen || suspended ? undefined : onCancel}
      >
        {content}
      </div>
      {workspace}
    </>
  );
};
