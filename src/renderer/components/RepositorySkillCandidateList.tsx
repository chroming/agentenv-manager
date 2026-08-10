import {
  CheckCircle2,
  Circle,
  CircleSlash2,
  Download,
  GitBranch,
  Info,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
  XCircle
} from "lucide-react";
import type {
  GitHubSkillImportResult,
  GitHubSkillScanResult
} from "../../shared/types";
import { useI18n } from "../i18n";
import type { GitHubSkillImportProgress } from "../skillLibraryContracts";
import { OverflowTooltip as PreviewText } from "./OverflowTooltip";
import { Button } from "./ui";

interface RepositorySkillCandidateListProps {
  scanResult: GitHubSkillScanResult;
  scanSummary: string;
  selectedSources: string[];
  candidateIds: Record<string, string>;
  importProgress: Record<string, GitHubSkillImportProgress>;
  importResult?: GitHubSkillImportResult;
  retrySourceUrl?: string;
  operation?: "scanning" | "importing";
  onChangeSource(): void;
  onSelectAll(selected: boolean): void;
  onSelectCandidate(sourceUrl: string, selected: boolean): void;
  onSetCandidateId(sourceUrl: string, id: string): void;
  onRetry(candidate: GitHubSkillScanResult["candidates"][number]): void;
}

export const RepositorySkillCandidateList = ({
  scanResult,
  scanSummary,
  selectedSources,
  candidateIds,
  importProgress,
  importResult,
  retrySourceUrl,
  operation,
  onChangeSource,
  onSelectAll,
  onSelectCandidate,
  onSetCandidateId,
  onRetry
}: RepositorySkillCandidateListProps) => {
  const { t } = useI18n();
  const readySources = scanResult.candidates
    .filter((candidate) => candidate.status === "ready")
    .map((candidate) => candidate.sourceUrl);
  const selectedReadyCount = readySources.filter((sourceUrl) =>
    selectedSources.includes(sourceUrl)
  ).length;
  const allReadySelected =
    readySources.length > 0 && selectedReadyCount === readySources.length;
  const someReadySelected = selectedReadyCount > 0 && !allReadySelected;
  const progressItems = Object.values(importProgress);
  const importedCount = progressItems.filter(
    (progress) => progress.status === "imported"
  ).length;
  const failedCount = progressItems.filter(
    (progress) => progress.status === "failed"
  ).length;
  const skippedCount = progressItems.filter(
    (progress) => progress.status === "skipped"
  ).length;

  return (
    <div className="github-scan-results">
      <div className="github-scan-results__header">
        <div className="github-scan-summary">
          <div>
            <strong>{t("{{count}} found", { count: scanResult.candidates.length })}</strong>
            <PreviewText
              ariaLabel={t("Repository scan source")}
              className="repository-scan-summary-path"
              text={scanSummary || `${scanResult.owner}/${scanResult.repo} · ${scanResult.ref}`}
              tooltipClassName="library-source-tooltip"
            />
          </div>
          <Button
            disabled={Boolean(operation) || Boolean(importResult)}
            onClick={onChangeSource}
          >
            {t("Change source")}
          </Button>
        </div>
        {scanResult.truncated ? (
          <div className="inline-state inline-state--warning" role="status">
            <TriangleAlert size={15} aria-hidden="true" />
            {t("Results are incomplete. Narrow the repository directory and scan again.")}
          </div>
        ) : null}
        {scanResult.indexManifest ? (
          <div className="inline-state" role="status">
            <Info size={15} aria-hidden="true" />
            {t("{{path}} indexes Skill paths elsewhere in this repository. Review the paths before importing.", {
              path: scanResult.indexManifest.path
            })}
          </div>
        ) : null}
        <div className="github-selection-bar">
          <label className="github-select-all">
            <input
              type="checkbox"
              aria-label={t("Select all discovered skills")}
              checked={allReadySelected}
              disabled={
                readySources.length === 0 ||
                Boolean(operation) ||
                Boolean(importResult)
              }
              ref={(checkbox) => {
                if (checkbox) checkbox.indeterminate = someReadySelected;
              }}
              onChange={(event) => onSelectAll(event.currentTarget.checked)}
            />
            <span>{t("Select all")}</span>
          </label>
          <span
            className={`github-selection-count${
              importResult
                ? failedCount > 0 || skippedCount > 0
                  ? " is-partial"
                  : " is-complete"
                : ""
            }`}
            role="status"
          >
            {importResult ? (
              <>
                {failedCount > 0 || skippedCount > 0 ? (
                  <TriangleAlert size={14} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={14} strokeWidth={2.2} aria-hidden="true" />
                )}
                {t(
                  failedCount > 0 && skippedCount > 0
                    ? "{{imported}} imported · {{failed}} failed · {{skipped}} skipped"
                    : failedCount > 0
                      ? "{{imported}} imported · {{failed}} failed"
                      : skippedCount > 0
                        ? "{{imported}} imported · {{skipped}} skipped"
                        : "All {{count}} skills imported",
                  {
                    count: importedCount,
                    imported: importedCount,
                    failed: failedCount,
                    skipped: skippedCount
                  }
                )}
              </>
            ) : t("{{count}} selected", { count: selectedSources.length })}
          </span>
          <span className="github-selection-id-heading">{t("Library ID")}</span>
        </div>
      </div>
      <div className="github-candidate-list">
        {scanResult.candidates.length === 0 ? (
          <div className="inline-state">{t("No skills found")}</div>
        ) : null}
        {scanResult.candidates.map((candidate) => {
          const selectable = candidate.status === "ready";
          const checked = selectedSources.includes(candidate.sourceUrl);
          const progress = importProgress[candidate.sourceUrl];
          const failure = importResult?.failed.find(
            (item) => item.sourceUrl === candidate.sourceUrl
          );
          const failureMessage = progress?.error ?? failure?.error;
          const progressStatus = progress?.status ?? (failureMessage ? "failed" : undefined);
          const retrying = retrySourceUrl === candidate.sourceUrl;
          return (
            <div
              className={`github-candidate-row${selectable ? "" : " is-disabled"}`}
              key={candidate.sourceUrl}
            >
              {progressStatus ? (
                <span
                  className={`github-import-state github-import-state--${progressStatus}`}
                  role="status"
                  aria-label={t("{{name}}: {{status}}", {
                    name: candidate.name,
                    status: t(progressStatus)
                  })}
                >
                  {progressStatus === "waiting" ? (
                    <Circle size={16} strokeWidth={2} aria-hidden="true" />
                  ) : progressStatus === "reviewing" || progressStatus === "importing" ? (
                    <LoaderCircle className="is-spinning" size={16} aria-hidden="true" />
                  ) : progressStatus === "imported" ? (
                    <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden="true" />
                  ) : progressStatus === "skipped" ? (
                    <CircleSlash2 size={16} strokeWidth={2.1} aria-hidden="true" />
                  ) : (
                    <PreviewText
                      ariaLabel={t("Import failure for {{name}}", { name: candidate.name })}
                      className="github-import-state__failure"
                      displayContent={<XCircle size={16} strokeWidth={2.2} aria-hidden="true" />}
                      text={failureMessage ?? t("Import failed")}
                      tooltipClassName="library-source-tooltip import-error-tooltip"
                    />
                  )}
                </span>
              ) : (
                <input
                  type="checkbox"
                  aria-label={t("Select {{name}}", { name: candidate.name })}
                  disabled={!selectable || Boolean(operation) || Boolean(importResult)}
                  checked={checked}
                  onChange={(event) =>
                    onSelectCandidate(candidate.sourceUrl, event.currentTarget.checked)
                  }
                />
              )}
              <span className="github-candidate-icon" aria-hidden="true">
                <GitBranch size={16} strokeWidth={2.2} />
              </span>
              <span className="github-candidate-main">
                <strong>{candidate.name}</strong>
                <PreviewText
                  ariaLabel={t("Full repository path {{id}}", { id: candidate.id })}
                  className="github-candidate-path"
                  text={candidate.remotePath || "/"}
                  tooltipClassName="library-source-tooltip"
                />
                {candidate.description ? <small>{candidate.description}</small> : null}
                {progressStatus === "failed" ? (
                  <small className="github-import-state-label field-error">{t("Import failed")}</small>
                ) : progress ? (
                  <small className="github-import-state-label">{t(progress.status)}</small>
                ) : null}
              </span>
              {selectable && (progressStatus === "failed" || progressStatus === "skipped" || retrying) ? (
                <Button
                  busy={retrying}
                  busyLabel={t(progressStatus === "skipped" ? "Importing..." : "Preparing...")}
                  className="github-candidate-retry"
                  size="compact"
                  variant="secondary"
                  aria-label={t(
                    progressStatus === "skipped" ? "Import {{name}}" : "Retry {{name}}",
                    { name: candidate.name }
                  )}
                  disabled={Boolean(operation)}
                  icon={progressStatus === "skipped"
                      ? <Download size={15} strokeWidth={2.2} />
                      : <RotateCcw size={15} strokeWidth={2.2} />}
                  onClick={() => onRetry(candidate)}
                >
                  {t(progressStatus === "skipped" ? "Import" : "Retry")}
                </Button>
              ) : selectable ? (
                <input
                  className="github-candidate-id"
                  aria-label={t("Library ID for {{name}}", { name: candidate.name })}
                  disabled={Boolean(operation) || Boolean(importResult)}
                  value={candidateIds[candidate.sourceUrl] ?? candidate.id}
                  onChange={(event) =>
                    onSetCandidateId(candidate.sourceUrl, event.currentTarget.value)
                  }
                />
              ) : (
                <PreviewText
                  ariaLabel={t("Status details for {{id}}", { id: candidate.id })}
                  className={`resource-chip resource-chip--managed${
                    candidate.status === "invalid" ? " resource-chip--warning" : ""
                  }`}
                  displayText={t(
                    candidate.status === "duplicate"
                      ? "Duplicate"
                      : candidate.status === "invalid"
                        ? "Invalid"
                        : "Imported"
                  )}
                  focusable={candidate.status === "invalid"}
                  text={candidate.error ?? t("Already in Library")}
                  tooltipClassName="library-source-tooltip"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
