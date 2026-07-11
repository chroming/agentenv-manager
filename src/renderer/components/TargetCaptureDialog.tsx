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
  consolidate: "Consolidate",
  exclude: "Leave untouched"
};

const friendlyResourceDetail = (resource: TargetCaptureResource) => {
  if (resource.detail?.includes("compatibility copy preserved")) {
    return "A shared copy will remain in its current location";
  }
  return resource.detail;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

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
  const isReview = Boolean(preview);
  const isBusy = activity !== "idle";
  const targetIcon = target ? targetIconFor(target) : undefined;
  const includedResources = preview?.resources.filter((resource) => resource.action !== "exclude") ?? [];
  const importedResources = preview?.resources.filter(
    (resource) => resource.action === "import" || resource.action === "consolidate"
  ) ?? [];
  const preservedCopies = preview?.resources.filter((resource) =>
    resource.detail?.includes("compatibility copy preserved")
  ).length ?? 0;
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
        aria-label={isReview ? `Review ${target?.name ?? "Target"} takeover` : `Create profile from ${target?.name ?? "Target"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="capture-dialog__header">
          <div>
            <span className="capture-dialog__eyebrow">{isReview ? "Step 2 of 2" : "Step 1 of 2"}</span>
            <h2>{isReview ? "Review takeover" : `Create profile from ${target?.name ?? "Target"}`}</h2>
            <p>
              {isReview
                ? `Confirm what AgentEnv will capture and manage for ${target?.name ?? "this Target"}.`
                : "Capture the current environment as a reusable Profile before AgentEnv takes it over."}
            </p>
          </div>
        </header>

        <div className="capture-dialog__body">
          {!isReview ? (
            <div className="capture-setup">
              {origin === "profiles" ? (
                <label className="capture-field">
                  <span>Source Target</span>
                  <select
                    aria-label="Profile target"
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
                        {candidate.name}{candidate.health.executableFound ? "" : " (missing)"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="capture-target-row" aria-label="Source Target">
                  <span className={`capture-target-row__icon capture-target-row__icon--${targetIcon?.flavor ?? "blue"}`} aria-hidden="true">
                    {targetIcon?.assetUrl ? <img src={targetIcon.assetUrl} alt="" /> : <Monitor size={18} />}
                  </span>
                  <span>
                    <small>Source Target</small>
                    <strong>{target?.name ?? "Target"}</strong>
                    <em>{target?.health.executableFound ? "Command detected" : "Command missing"}</em>
                  </span>
                </div>
              )}
              <label className="capture-field">
                <span>Profile name</span>
                <input
                  aria-label="Profile name"
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
                  <strong>Safe takeover</strong>
                  <small>AgentEnv reviews the current files first and creates a recovery backup before changing the Target.</small>
                </span>
              </div>
            </div>
          ) : (
            <div className="capture-review" role="region" aria-label="Capture impact">
              <div className="capture-review__target">
                <span className={`capture-target-row__icon capture-target-row__icon--${targetIcon?.flavor ?? "blue"}`} aria-hidden="true">
                  {targetIcon?.assetUrl ? <img src={targetIcon.assetUrl} alt="" /> : <Monitor size={18} />}
                </span>
                <span><small>Target</small><strong>{target?.name ?? preview?.targetName}</strong></span>
                <span><small>New Profile</small><strong>{name}</strong></span>
              </div>

              <div className="capture-review__summary" aria-label="Takeover summary">
                <span><strong>{includedResources.length}</strong><small>Profile resources</small></span>
                <span><strong>{importedResources.length}</strong><small>Library imports</small></span>
                <span><strong>{preservedCopies}</strong><small>Copies preserved</small></span>
                <span><strong>{preview?.cleanupPaths.length ?? 0}</strong><small>Copies removed</small></span>
              </div>

              {preview && preview.errors.length > 0 ? (
                <div className="capture-errors" role="alert">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <span><strong>Takeover is blocked</strong>{preview.errors.map((error) => <small key={error}>{error}</small>)}</span>
                </div>
              ) : null}

              {preview && preview.warnings.length > 0 ? (
                <details className="capture-advisory">
                  <summary>
                    <TriangleAlert size={16} strokeWidth={2.1} aria-hidden="true" />
                    <span><strong>{plural(preview.warnings.length, "item")} will remain outside AgentEnv</strong><small>These files may still be used by another installed Target.</small></span>
                  </summary>
                  <ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </details>
              ) : null}

              <div className="capture-safety-note">
                <ShieldCheck size={18} strokeWidth={2.1} aria-hidden="true" />
                <span>
                  <strong>Recovery included</strong>
                  <small>A backup is created before changes. If takeover fails after Apply, AgentEnv restores the previous environment automatically.</small>
                </span>
              </div>

              <div className="capture-resource-groups">
                {groupedResources.map((group) => (
                  <section className="capture-resource-group" aria-label={resourceKindLabels[group.kind]} key={group.kind}>
                    <header><strong>{resourceKindLabels[group.kind]}</strong><span>{group.resources.length}</span></header>
                    {group.resources.map((resource) => {
                      const detail = friendlyResourceDetail(resource);
                      const fullDetail = [resource.sourcePath, resource.detail].filter(Boolean).join(" · ");
                      return (
                        <div className={`capture-resource capture-resource--${resource.action}`} key={`${resource.kind}:${resource.id}`}>
                          <CheckCircle2 size={15} strokeWidth={2.1} aria-hidden="true" />
                          <span title={fullDetail || undefined}><strong>{resource.name}</strong>{detail ? <small>{detail}</small> : null}</span>
                          <em>{resourceActionLabels[resource.action]}</em>
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
              <span><strong>Could not complete this step</strong><small>{flowError}</small></span>
              <button type="button" disabled={isBusy} onClick={onRefreshReview}>Refresh review</button>
            </div>
          ) : null}
        </div>

        <footer className="capture-dialog__footer">
          <div>
            {isReview ? (
              <button className="secondary-action" type="button" disabled={isBusy} onClick={onBack}>
                <ArrowLeft size={15} aria-hidden="true" />
                Back
              </button>
            ) : null}
          </div>
          <div>
            <button ref={initialFocusRef} className="secondary-action" type="button" disabled={isBusy} onClick={onCancel}>Cancel</button>
            <button
              className="primary-action"
              type="button"
              disabled={isBusy || !target?.health.executableFound || !name.trim() || Boolean(preview?.errors.length)}
              onClick={isReview ? onCreate : onReview}
            >
              {isBusy ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : null}
              {activity === "reviewing" ? "Reviewing..." : activity === "creating" ? "Creating..." : isReview ? "Create and take over" : "Review"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};
