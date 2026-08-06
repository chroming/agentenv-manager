import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  FileDown,
  GitCompareArrows,
  LoaderCircle,
  Monitor,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import type {
  TargetCaptureDecision,
  TargetCapturePreview,
  TargetCaptureResource,
  TargetCaptureSkillCandidate,
  TargetInfo
} from "../../shared/types";
import { targetIconFor } from "./ProfileSidebar";
import { useI18n } from "../i18n";
import { isTargetInstalled } from "../../shared/targetHealth";
import { Button } from "./ui";
import { DiffWorkspaceDialog } from "./DiffWorkspaceDialog";

type CaptureActivity = "idle" | "reviewing" | "creating";

interface TargetCaptureDialogProps {
  target?: TargetInfo;
  targets: TargetInfo[];
  name: string;
  origin: "profiles" | "targets";
  scope: "all" | "skills";
  preview?: TargetCapturePreview;
  activity: CaptureActivity;
  nameError?: string;
  flowError?: string;
  decisions: TargetCaptureDecision[];
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onNameChange(value: string): void;
  onTargetChange(targetId: string): void;
  onBack(): void;
  onCancel(): void;
  onReview(): void;
  onCreate(): void;
  onRefreshReview(): void;
  onDecisionChange(decision: TargetCaptureDecision): void;
}

const resourceKindOrder: TargetCaptureResource["kind"][] = [
  "instructions",
  "skill",
  "mcp"
];

const resourceKindLabels: Record<TargetCaptureResource["kind"], string> = {
  instructions: "Instructions",
  skill: "Skills",
  mcp: "MCPs"
};

const resourceActionLabels: Record<TargetCaptureResource["action"], string> = {
  include: "Add to Profile",
  reuse: "Use Library copy",
  import: "Import to Library",
  exclude: "Leave untouched"
};

export const TargetCaptureDialog = ({
  target,
  targets,
  name,
  origin,
  scope,
  preview,
  activity,
  nameError,
  flowError,
  decisions,
  dialogRef,
  initialFocusRef,
  onNameChange,
  onTargetChange,
  onBack,
  onCancel,
  onReview,
  onCreate,
  onRefreshReview,
  onDecisionChange
}: TargetCaptureDialogProps) => {
  const { t, formatDate } = useI18n();
  const [copiedIssueId, setCopiedIssueId] = useState<string>();
  const [exportingIssueId, setExportingIssueId] = useState<string>();
  const [diffCandidate, setDiffCandidate] = useState<TargetCaptureSkillCandidate>();
  const diffReturnFocusRef = useRef<HTMLButtonElement>(null);
  const isReview = Boolean(preview);
  const isBusy = activity !== "idle";
  const isSkillsOnly = scope === "skills";
  const submitLabel = isReview
    ? isSkillsOnly ? "Save setup" : "Save Profile"
    : "Review";
  const submitAccessibleLabel = activity === "reviewing"
    ? "Reviewing..."
    : activity === "creating"
      ? "Creating..."
      : submitLabel;
  const targetIcon = target ? targetIconFor(target) : undefined;
  const includedResources = preview?.resources.filter((resource) => resource.action !== "exclude") ?? [];
  const importedResources = preview?.resources.filter((resource) => resource.action === "import") ?? [];
  const groupedResources = resourceKindOrder
    .map((kind) => ({
      kind,
      resources: preview?.resources.filter((resource) => resource.kind === kind) ?? []
    }))
    .filter((group) => group.resources.length > 0);
  const captureIssues = preview?.issues ?? [];
  const selectedCandidates = captureIssues.flatMap((issue) => {
    const decision = decisions.find((item) => item.issueId === issue.id);
    if (decision?.action !== "use-copy") return [];
    const candidate = issue.candidates.find((item) => item.id === decision.candidateId);
    return candidate ? [candidate] : [];
  });
  const includedResourceCount = includedResources.length + selectedCandidates.length;
  const importedResourceCount = importedResources.length + selectedCandidates.filter(
    (candidate) => candidate.libraryMatch !== "identical"
  ).length;
  const unresolvedIssueCount = captureIssues.filter(
    (issue) => !decisions.some((decision) => decision.issueId === issue.id)
  ).length;
  const blockingCopyLabel = copiedIssueId === "__blocking__" ? "Copied" : "Copy details";
  const blockingExportLabel = exportingIssueId === "__blocking__"
    ? "Exporting..."
    : "Export report";
  const decisionFor = (issueId: string) =>
    decisions.find((decision) => decision.issueId === issueId);
  const copyIssueDetails = async (issue: (typeof captureIssues)[number]) => {
    const details = [
      "AgentEnv Manager Capture review",
      `Reference: ${issue.diagnosticReference ?? "Unavailable"}`,
      `Agent: ${preview?.targetName ?? target?.name ?? "Agent"}`,
      `Skill: ${issue.skillName}`,
      `Reason: ${issue.message}`,
      "",
      ...issue.candidates.flatMap((candidate, index) => [
        `Candidate ${index + 1}`,
        `Path: ${candidate.path}`,
        `Canonical path: ${candidate.canonicalPath}`,
        `Location: ${candidate.shared ? "Shared compatibility location" : candidate.locationRole ?? "Agent location"}`,
        `Version: ${candidate.version ?? "Not declared"}`,
        `Hash: ${candidate.contentHash}`,
        `Modified: ${candidate.modifiedAt ?? "Unknown"}`,
        `Library match: ${candidate.libraryId ?? "None"}`,
        ...(candidate.collectionPath ? [`Collection: ${candidate.collectionPath}`] : []),
        ""
      ])
    ].join("\n");
    await window.agentEnv.copyText(details);
    setCopiedIssueId(issue.id);
  };
  const exportReference = async (id: string, reference?: string) => {
    if (!reference) return;
    setExportingIssueId(id);
    try {
      await window.agentEnv.exportDiagnostics(reference);
    } finally {
      setExportingIssueId(undefined);
    }
  };

  return (
    <div
      className={`preview-modal-backdrop${diffCandidate ? " is-suspended" : ""}`}
      data-dismiss-policy="intentional"
    >
      <section
        ref={dialogRef}
        className="capture-dialog"
        role="dialog"
        aria-modal={diffCandidate ? undefined : "true"}
        aria-hidden={Boolean(diffCandidate) || undefined}
        inert={Boolean(diffCandidate) || undefined}
        aria-label={isReview
          ? t(isSkillsOnly ? "Review {{name}} Skill setup" : "Review {{name}} capture", {
              name: target?.name ?? t("Agent")
            })
          : t(isSkillsOnly ? "Manage {{name}} Skills" : "Create Profile from {{name}}", {
              name: target?.name ?? t("Agent")
            })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="capture-dialog__header ui-dialog-header">
          <div>
            <span className="capture-dialog__eyebrow">{t(isReview ? "Step 2 of 2" : "Step 1 of 2")}</span>
            <h2>
              {isReview
                ? t(isSkillsOnly ? "Review managed Skill setup" : "Review captured Profile")
                : t(isSkillsOnly ? "Manage {{name}} Skills" : "Create Profile from {{name}}", {
                    name: target?.name ?? t("Agent")
                  })}
            </h2>
            <p>
              {isReview
                ? t(
                    isSkillsOnly
                      ? "Confirm which Skills AgentEnv will preserve and manage for {{name}}."
                      : "Confirm what AgentEnv will save from {{name}}.",
                    { name: target?.name ?? t("this Agent") }
                  )
                : t(
                    isSkillsOnly
                      ? "Preserve the current Skills in a reusable setup. Instructions and MCPs stay Agent-controlled."
                      : "Save the current Agent setup as a reusable Profile without changing the Agent."
                  )}
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
                        disabled={!isTargetInstalled(candidate.health)}
                      >
                        {candidate.name}{isTargetInstalled(candidate.health) ? "" : t(" (missing)")}
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
                    <em>{t(target && isTargetInstalled(target.health) ? "Installation detected" : "Installation not detected")}</em>
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
                  <small>
                    {t(
                      isSkillsOnly
                        ? "AgentEnv reads current Skills and saves canonical copies. The Agent stays unchanged until Apply."
                        : "AgentEnv reads the current files and saves copies to Library and the Profile. Source files stay unchanged."
                    )}
                  </small>
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
                <span><strong>{includedResourceCount}</strong><small>{t("Profile resources")}</small></span>
                <span><strong>{importedResourceCount}</strong><small>{t(importedResourceCount === 1 ? "Library import" : "Library imports")}</small></span>
                <span><strong>0</strong><small>{t("Source changes")}</small></span>
              </div>

              {preview && preview.errors.length > 0 ? (
                <div className="capture-errors" role="alert">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <span>
                    <strong>{t("Capture is blocked")}</strong>
                    {preview.errors.map((error) => <small key={error}>{error}</small>)}
                  </span>
                  <div className="capture-errors__actions">
                    <Button
                      size="compact"
                      variant="ghost"
                      icon={<Copy size={14} aria-hidden="true" />}
                      onClick={() => {
                        void window.agentEnv.copyText([
                          "AgentEnv Manager Capture blocked",
                          `Reference: ${preview.blockingDiagnosticReference ?? "Unavailable"}`,
                          `Agent: ${preview.targetName}`,
                          ...preview.errors.map((error) => `- ${error}`)
                        ].join("\n"));
                        setCopiedIssueId("__blocking__");
                      }}
                    >
                      {t(blockingCopyLabel)}
                    </Button>
                    {preview.blockingDiagnosticReference ? (
                      <Button
                        size="compact"
                        variant="ghost"
                        busy={exportingIssueId === "__blocking__"}
                        icon={exportingIssueId === "__blocking__"
                          ? <LoaderCircle size={14} aria-hidden="true" />
                          : <FileDown size={14} aria-hidden="true" />}
                        onClick={() => void exportReference(
                          "__blocking__",
                          preview.blockingDiagnosticReference
                        )}
                      >
                        {t(blockingExportLabel)}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {captureIssues.length > 0 ? (
                <section className="capture-decisions" aria-label={t("Capture decisions")}>
                  <header>
                    <div>
                      <strong>{t("Choose which copies to save")}</strong>
                      <small>
                        {t("The Agent can load different content under the same Skill name. Choose the Profile intent here; source files stay unchanged.")}
                      </small>
                    </div>
                    <span>{unresolvedIssueCount > 0
                      ? t("{{count}} to review", { count: unresolvedIssueCount })
                      : t("Ready")}</span>
                  </header>
                  {captureIssues.map((issue) => {
                    const decision = decisionFor(issue.id);
                    return (
                      <article className="capture-decision" key={issue.id}>
                        <div className="capture-decision__heading">
                          <div>
                            <strong>{issue.skillName}</strong>
                            <small>{t("{{count}} active copies have different content", {
                              count: issue.candidates.length
                            })}</small>
                          </div>
                          <div className="capture-decision__tools">
                            <Button
                              size="compact"
                              variant="ghost"
                              icon={<Copy size={14} aria-hidden="true" />}
                              onClick={() => void copyIssueDetails(issue)}
                            >
                              {t(copiedIssueId === issue.id ? "Copied" : "Copy details")}
                            </Button>
                            {issue.diagnosticReference ? (
                              <Button
                                size="compact"
                                variant="ghost"
                                busy={exportingIssueId === issue.id}
                                icon={exportingIssueId === issue.id
                                  ? <LoaderCircle size={14} aria-hidden="true" />
                                  : <FileDown size={14} aria-hidden="true" />}
                                onClick={() => void exportReference(issue.id, issue.diagnosticReference)}
                              >
                                {t(exportingIssueId === issue.id ? "Exporting..." : "Export report")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="capture-candidates" role="radiogroup" aria-label={t("Copy to save for {{name}}", { name: issue.skillName })}>
                          {issue.candidates.map((candidate) => {
                            const selected = decision?.action === "use-copy" &&
                              decision.candidateId === candidate.id;
                            const location = candidate.shared
                              ? t("Shared compatibility location")
                              : candidate.locationRole === "preferred-runtime"
                                ? t("Agent-specific location")
                                : t("Additional Agent location");
                            const libraryMessage = candidate.libraryMatch === "same-name"
                              ? "Will save as Library Skill {{id}}; the existing same-name copy stays unchanged"
                              : candidate.libraryMatch === "identical"
                                ? "Matches Library Skill {{id}}"
                                : "Will save as Library Skill {{id}}";
                            return (
                              <label className={selected ? "is-selected" : ""} key={candidate.id}>
                                <input
                                  type="radio"
                                  name={`capture-${issue.id}`}
                                  checked={selected}
                                  disabled={isBusy}
                                  onChange={() => onDecisionChange({
                                    issueId: issue.id,
                                    action: "use-copy",
                                    candidateId: candidate.id
                                  })}
                                />
                                <span className="capture-candidate__copy">
                                  <strong>{location}</strong>
                                  <code title={candidate.path}>{candidate.path}</code>
                                  <small>
                                    {candidate.version
                                      ? t("Version {{version}}", { version: candidate.version })
                                      : t("Version not declared")}
                                    {` · ${candidate.contentHash.slice(0, 8)}`}
                                    {candidate.modifiedAt
                                      ? ` · ${t("Modified {{date}}", { date: formatDate(candidate.modifiedAt) })}`
                                      : ""}
                                  </small>
                                  {candidate.libraryId ? (
                                    <em>{t(libraryMessage, { id: candidate.libraryId })}</em>
                                  ) : null}
                                </span>
                                {candidate.comparisonChanges?.length ? (
                                  <Button
                                    size="compact"
                                    variant="ghost"
                                    icon={<GitCompareArrows size={14} aria-hidden="true" />}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      diffReturnFocusRef.current = event.currentTarget;
                                      setDiffCandidate(candidate);
                                    }}
                                  >
                                    {t("Compare")}
                                  </Button>
                                ) : null}
                              </label>
                            );
                          })}
                          <label className={decision?.action === "keep-outside" ? "is-selected" : ""}>
                            <input
                              type="radio"
                              name={`capture-${issue.id}`}
                              checked={decision?.action === "keep-outside"}
                              disabled={isBusy}
                              onChange={() => onDecisionChange({
                                issueId: issue.id,
                                action: "keep-outside"
                              })}
                            />
                            <span className="capture-candidate__copy">
                              <strong>{t("Leave runtime copies unchanged")}</strong>
                              <small>{t("Do not add this Skill to the Profile. Future Apply preserves these paths on this device.")}</small>
                            </span>
                          </label>
                        </div>
                      </article>
                    );
                  })}
                </section>
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
                  <small>
                    {t(
                      isSkillsOnly
                        ? "After saving, review and apply the Skill setup when you are ready."
                        : "After saving, review the Profile and use Apply when you are ready to take over this Agent."
                    )}
                  </small>
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
              <Button size="compact" variant="ghost" disabled={isBusy} onClick={onRefreshReview}>
                {t("Refresh review")}
              </Button>
            </div>
          ) : null}
        </div>

        <footer className="capture-dialog__footer ui-dialog-footer">
          <div>
            {isReview ? (
              <Button
                disabled={isBusy}
                icon={<ArrowLeft size={15} aria-hidden="true" />}
                onClick={onBack}
              >
                {t("Back")}
              </Button>
            ) : null}
            {isReview && unresolvedIssueCount > 0 ? (
              <span className="capture-dialog__requirement">
                {t("Resolve {{count}} items to continue", { count: unresolvedIssueCount })}
              </span>
            ) : null}
          </div>
          <div>
            <Button ref={initialFocusRef} disabled={isBusy} onClick={onCancel}>
              {t("Cancel")}
            </Button>
            <Button
              aria-label={t(submitAccessibleLabel)}
              className="capture-dialog__submit"
              busy={isBusy}
              disabled={isBusy || !target || !isTargetInstalled(target.health) || !name.trim() || Boolean(preview?.errors.length) || unresolvedIssueCount > 0}
              variant="primary"
              onClick={isReview ? onCreate : onReview}
            >
              {t(submitLabel)}
            </Button>
          </div>
        </footer>
      </section>
      <DiffWorkspaceDialog
        open={Boolean(diffCandidate)}
        title={diffCandidate ? t("Compare copies of {{name}}", {
          name: preview?.issues.find((issue) =>
            issue.candidates.some((candidate) => candidate.id === diffCandidate.id)
          )?.skillName ?? t("Skill")
        }) : t("Skill comparison")}
        changes={diffCandidate?.comparisonChanges ?? []}
        returnFocusRef={diffReturnFocusRef}
        onClose={() => setDiffCandidate(undefined)}
      />
    </div>
  );
};
