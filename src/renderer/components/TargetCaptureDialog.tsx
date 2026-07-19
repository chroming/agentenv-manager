import {
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  Monitor,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";
import type { RefObject } from "react";
import type {
  TargetCapturePreview,
  TargetCaptureResource,
  TargetInfo
} from "../../shared/types";
import { targetIconFor } from "./ProfileSidebar";
import { useI18n } from "../i18n";

type CaptureActivity = "idle" | "reviewing" | "creating";

interface TargetCaptureDialogProps {
  target?: TargetInfo;
  targets: TargetInfo[];
  name: string;
  origin: "profiles" | "targets";
  preview?: TargetCapturePreview;
  activity: CaptureActivity;
  nameError?: string;
  flowError?: string;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onNameChange(value: string): void;
  onTargetChange(targetId: string): void;
  onBack(): void;
  onCancel(): void;
  onReview(): void;
  onCreate(): void;
  onRefreshReview(): void;
}

const resourceKindOrder: TargetCaptureResource["kind"][] = [
  "instructions",
  "skill",
  "mcp",
  "agent",
  "config"
];

const resourceKindLabels: Record<TargetCaptureResource["kind"], string> = {
  instructions: "Instructions",
  skill: "Skills",
  mcp: "MCP servers",
  agent: "Agents",
  config: "Configuration"
};

const resourceActionLabels: Record<TargetCaptureResource["action"], string> = {
  include: "Add to profile",
  reuse: "Use Library copy",
  import: "Import to Library",
  exclude: "Leave untouched"
};

export const TargetCaptureDialog = ({
  target,
  targets,
  name,
  origin,
  preview,
  activity,
  nameError,
  flowError,
  dialogRef,
  initialFocusRef,
  onNameChange,
  onTargetChange,
  onBack,
  onCancel,
  onReview,
  onCreate,
  onRefreshReview
}: TargetCaptureDialogProps) => {
  const { t } = useI18n();
  const isReview = Boolean(preview);
  const isBusy = activity !== "idle";
  const targetIcon = target ? targetIconFor(target) : undefined;
  const includedResources = preview?.resources.filter((resource) => resource.action !== "exclude") ?? [];
  const importedResources = preview?.resources.filter((resource) => resource.action === "import") ?? [];
  const groupedResources = resourceKindOrder
    .map((kind) => ({
      kind,
      resources: preview?.resources.filter((resource) => resource.kind === kind) ?? []
    }))
    .filter((group) => group.resources.length > 0);

  return (
    <div className="preview-modal-backdrop" onClick={isBusy ? undefined : onCancel}>
      <section
        ref={dialogRef}
        className="capture-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isReview
          ? t("Review {{name}} capture", { name: target?.name ?? t("Agent") })
          : t("Create profile from {{name}}", { name: target?.name ?? t("Agent") })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="capture-dialog__header">
          <div>
            <span className="capture-dialog__eyebrow">{t(isReview ? "Step 2 of 2" : "Step 1 of 2")}</span>
            <h2>{isReview ? t("Review captured Profile") : t("Create profile from {{name}}", { name: target?.name ?? t("Agent") })}</h2>
            <p>
              {isReview
                ? t("Confirm what AgentEnv will save from {{name}}.", { name: target?.name ?? t("this Agent") })
                : t("Save the current environment as a reusable Profile without changing the Agent.")}
            </p>
          </div>
        </header>

        <div className="capture-dialog__body">
          {!isReview ? (
            <div className="capture-setup">
              {origin === "profiles" ? (
                <label className="capture-field">
                  <span>{t("Source Agent")}</span>
                  <select
                    aria-label={t("Profile source Agent")}
                    value={target?.id ?? ""}
                    disabled={isBusy}
                    onChange={(event) => onTargetChange(event.currentTarget.value)}
                  >
                    {targets.map((candidate) => (
                      <option
                        value={candidate.id}
                        key={candidate.id}
                        disabled={!candidate.health.executableFound}
                      >
                        {candidate.name}{candidate.health.executableFound ? "" : t(" (missing)")}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="capture-target-row" aria-label={t("Source Agent")}>
                  <span className={`capture-target-row__icon capture-target-row__icon--${targetIcon?.flavor ?? "blue"}`} aria-hidden="true">
                    {targetIcon?.assetUrl ? <img src={targetIcon.assetUrl} alt="" /> : <Monitor size={18} />}
                  </span>
                  <span>
                    <small>{t("Source Agent")}</small>
                    <strong>{target?.name ?? t("Agent")}</strong>
                    <em>{t(target?.health.executableFound ? "Command detected" : "Command missing")}</em>
                  </span>
                </div>
              )}
              <label className="capture-field">
                <span>{t("Profile name")}</span>
                <input
                  aria-label={t("Profile name")}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? "capture-profile-name-error" : undefined}
                  value={name}
                  disabled={isBusy}
                  onChange={(event) => onNameChange(event.currentTarget.value)}
                />
                {nameError ? <small className="field-error" id="capture-profile-name-error">{nameError}</small> : null}
              </label>
              <div className="capture-safety-note">
                <ShieldCheck size={18} strokeWidth={2.1} aria-hidden="true" />
                <span>
                  <strong>{t("Non-invasive capture")}</strong>
                  <small>{t("AgentEnv reads the current files and saves copies to Library and Profile. Source files stay unchanged.")}</small>
                </span>
              </div>
            </div>
          ) : (
            <div className="capture-review" role="region" aria-label={t("Capture impact")}>
              <div className="capture-review__target">
                <span className={`capture-target-row__icon capture-target-row__icon--${targetIcon?.flavor ?? "blue"}`} aria-hidden="true">
                  {targetIcon?.assetUrl ? <img src={targetIcon.assetUrl} alt="" /> : <Monitor size={18} />}
                </span>
                <span><small>{t("Agent")}</small><strong>{target?.name ?? preview?.targetName}</strong></span>
                <span><small>{t("New Profile")}</small><strong>{name}</strong></span>
              </div>

              <div className="capture-review__summary" aria-label={t("Capture summary")}>
                <span><strong>{includedResources.length}</strong><small>{t("Profile resources")}</small></span>
                <span><strong>{importedResources.length}</strong><small>{t(importedResources.length === 1 ? "Library import" : "Library imports")}</small></span>
                <span><strong>0</strong><small>{t("Source changes")}</small></span>
              </div>

              {preview && preview.errors.length > 0 ? (
                <div className="capture-errors" role="alert">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <span><strong>{t("Capture is blocked")}</strong>{preview.errors.map((error) => <small key={error}>{error}</small>)}</span>
                </div>
              ) : null}

              {preview && preview.warnings.length > 0 ? (
                <details className="capture-advisory">
                  <summary>
                    <TriangleAlert size={16} strokeWidth={2.1} aria-hidden="true" />
                    <span><strong>{t("{{count}} items will remain outside AgentEnv", { count: preview.warnings.length })}</strong><small>{t("These files may still be used by another installed Agent.")}</small></span>
                  </summary>
                  <ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </details>
              ) : null}

              <div className="capture-safety-note">
                <ShieldCheck size={18} strokeWidth={2.1} aria-hidden="true" />
                <span>
                  <strong>{t("Agent stays unchanged")}</strong>
                  <small>{t("After saving, review the Profile and use Apply when you are ready to take over this Agent.")}</small>
                </span>
              </div>

              <div className="capture-resource-groups">
                {groupedResources.map((group) => (
                  <section className="capture-resource-group" aria-label={t(resourceKindLabels[group.kind])} key={group.kind}>
                    <header><strong>{t(resourceKindLabels[group.kind])}</strong><span>{group.resources.length}</span></header>
                    {group.resources.map((resource) => {
                      const sourceCopyMatch = resource.detail?.match(/^(\d+) source copies stay unchanged$/);
                      const alternateImportMatch = resource.detail?.match(
                        /^Import Agent copy as (.+); existing same-name Library Skill stays unchanged$/
                      );
                      const detail = sourceCopyMatch
                        ? t("{{count}} source copies stay unchanged", { count: sourceCopyMatch[1] })
                        : alternateImportMatch
                          ? t("Import Agent copy as {{id}}; existing same-name Library Skill stays unchanged", {
                              id: alternateImportMatch[1]
                            })
                          : resource.detail;
                      const fullDetail = [resource.sourcePath, resource.detail].filter(Boolean).join(" · ");
                      return (
                        <div className={`capture-resource capture-resource--${resource.action}`} key={`${resource.kind}:${resource.id}`}>
                          <CheckCircle2 size={15} strokeWidth={2.1} aria-hidden="true" />
                          <span title={fullDetail || undefined}><strong>{resource.name}</strong>{detail ? <small>{detail}</small> : null}</span>
                          <em className="capture-resource__status">{t(resourceActionLabels[resource.action])}</em>
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>
          )}

          {flowError ? (
            <div className="capture-flow-error" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <span><strong>{t("Could not complete this step")}</strong><small>{flowError}</small></span>
              <button type="button" disabled={isBusy} onClick={onRefreshReview}>{t("Refresh review")}</button>
            </div>
          ) : null}
        </div>

        <footer className="capture-dialog__footer">
          <div>
            {isReview ? (
              <button className="secondary-action" type="button" disabled={isBusy} onClick={onBack}>
                <ArrowLeft size={15} aria-hidden="true" />
                {t("Back")}
              </button>
            ) : null}
          </div>
          <div>
            <button ref={initialFocusRef} className="secondary-action" type="button" disabled={isBusy} onClick={onCancel}>{t("Cancel")}</button>
            <button
              className={`primary-action capture-dialog__submit${isBusy ? " is-working" : ""}`}
              type="button"
              aria-busy={isBusy}
              disabled={isBusy || !target?.health.executableFound || !name.trim() || Boolean(preview?.errors.length)}
              onClick={isReview ? onCreate : onReview}
            >
              <span className="capture-dialog__submit-icon" aria-hidden="true">
                {isBusy ? <LoaderCircle size={15} /> : null}
              </span>
              <span aria-live="polite">
                {t(activity === "reviewing" ? "Reviewing..." : activity === "creating" ? "Creating..." : isReview ? "Save Profile" : "Review")}
              </span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};
