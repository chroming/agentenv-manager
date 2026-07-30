import type { RefObject } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Folder,
  GitBranch,
  LoaderCircle,
  Settings2,
  TriangleAlert,
  X
} from "lucide-react";
import type {
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  LocalSkillSourceSelection,
  ProjectSkillScanResult,
  SkillInventoryEntry,
  SkillSourceCollectionRef,
  SkillUpstream
} from "../../shared/types";
import { useI18n, type TranslationValues } from "../i18n";
import type { GitHubSkillImportProgress } from "../skillLibraryContracts";
import { InfoTip } from "./InfoTip";
import { ProjectSkillDiscoveryPanel } from "./ProjectSkillDiscoveryPanel";
import { RepositorySkillCandidateList } from "./RepositorySkillCandidateList";
import { Button, IconButton, ModalFrame } from "./ui";

interface LocalImportImpact {
  message: string;
  values?: TranslationValues;
}

interface SkillImportDialogProps {
  dialogRef: RefObject<HTMLElement | null>;
  suspended: boolean;
  source: "local" | "github";
  localSkillPath: string;
  localSkillSource?: LocalSkillSourceSelection;
  selectedLocalInventory?: SkillInventoryEntry;
  localImportImpact?: LocalImportImpact;
  localImportBlocked: boolean;
  localImportOperation: boolean;
  githubUrl: string;
  repositoryRef: string;
  repositoryDirectory: string;
  repositoryConnection: "auto" | "system-git";
  githubScanResult?: GitHubSkillScanResult;
  repositoryScanSummary: string;
  githubSelectedSources: string[];
  githubCandidateIds: Record<string, string>;
  githubImportProgress: Record<string, GitHubSkillImportProgress>;
  githubImportResult?: GitHubSkillImportResult;
  githubRetrySourceUrl?: string;
  githubOperation?: "scanning" | "importing";
  githubOperationError: string;
  githubApiRetryAvailable: boolean;
  repositoryOperationCancelable: boolean;
  importStopRequested: boolean;
  onClose(): void;
  onSourceChange(source: "local" | "github"): void;
  onChooseLocalSource(): void;
  onScanLocalSource?(rootPath: string): Promise<ProjectSkillScanResult>;
  onImportLocalSource?(
    sourcePath: string,
    sourceCollection?: SkillSourceCollectionRef,
    upstream?: SkillUpstream
  ): Promise<boolean>;
  onGithubUrlChange(value: string): void;
  onRepositoryRefChange(value: string): void;
  onRepositoryDirectoryChange(value: string): void;
  onRepositoryConnectionChange(value: "auto" | "system-git"): void;
  onChangeRepositorySource(): void;
  onSelectAllCandidates(selected: boolean): void;
  onSelectCandidate(sourceUrl: string, selected: boolean): void;
  onSetCandidateId(sourceUrl: string, id: string): void;
  onRetryCandidate(candidate: GitHubSkillScanResult["candidates"][number]): void;
  onRetryWithSystemGit(): void;
  onImportLocal(): void;
  onScanRepository(): void;
  onImportSelected(): void;
}

export const SkillImportDialog = ({
  dialogRef,
  suspended,
  source,
  localSkillPath,
  localSkillSource,
  selectedLocalInventory,
  localImportImpact,
  localImportBlocked,
  localImportOperation,
  githubUrl,
  repositoryRef,
  repositoryDirectory,
  repositoryConnection,
  githubScanResult,
  repositoryScanSummary,
  githubSelectedSources,
  githubCandidateIds,
  githubImportProgress,
  githubImportResult,
  githubRetrySourceUrl,
  githubOperation,
  githubOperationError,
  githubApiRetryAvailable,
  repositoryOperationCancelable,
  importStopRequested,
  onClose,
  onSourceChange,
  onChooseLocalSource,
  onScanLocalSource,
  onImportLocalSource,
  onGithubUrlChange,
  onRepositoryRefChange,
  onRepositoryDirectoryChange,
  onRepositoryConnectionChange,
  onChangeRepositorySource,
  onSelectAllCandidates,
  onSelectCandidate,
  onSetCandidateId,
  onRetryCandidate,
  onRetryWithSystemGit,
  onImportLocal,
  onScanRepository,
  onImportSelected
}: SkillImportDialogProps) => {
  const { t } = useI18n();
  const dismissDisabled = Boolean(githubOperation) && !repositoryOperationCancelable;

  return (
    <ModalFrame
      ariaLabel={t("Import skills")}
      backdropClassName="library-import-backdrop"
      className="library-import-dialog"
      dialogRef={dialogRef}
      dismissPolicy="intentional"
      dismissDisabled={dismissDisabled}
      onDismiss={onClose}
      suspended={suspended}
    >
      <header className="profile-dialog-header library-import-header ui-dialog-header">
        <div className="section-title ui-dialog-title">{t("Import skills")}</div>
        <IconButton
          label={t("Close import")}
          disabled={localImportOperation || dismissDisabled}
          onClick={onClose}
          size="default"
          variant="ghost"
        >
          <X size={16} strokeWidth={2.2} />
        </IconButton>
      </header>

      <div className="library-import-source-tabs" role="tablist" aria-label={t("Import source")}>
        <button
          className={source === "local" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={source === "local"}
          disabled={Boolean(githubOperation) || localImportOperation}
          onClick={() => onSourceChange("local")}
        >
          <Folder size={15} strokeWidth={2.2} aria-hidden="true" />
          {t("Local")}
        </button>
        <button
          className={source === "github" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={source === "github"}
          disabled={Boolean(githubOperation) || localImportOperation}
          onClick={() => onSourceChange("github")}
        >
          <GitBranch size={15} strokeWidth={2.2} aria-hidden="true" />
          {t("Repository")}
        </button>
      </div>

      {source === "local" ? (
        <div className="library-import-content">
          <section className="library-import-panel">
            <div className="library-import-grid">
              <label>
                <span>{t("Folder or ZIP")}</span>
                <input
                  aria-label={t("Local Skill source path")}
                  placeholder={t("No source selected")}
                  readOnly
                  value={localSkillPath}
                />
              </label>
              <Button
                aria-label={t("Choose local Skill source")}
                disabled={localImportOperation || Boolean(githubOperation)}
                icon={<Folder size={15} strokeWidth={2.2} />}
                onClick={onChooseLocalSource}
              >
                {t("Choose source")}
              </Button>
            </div>
            {localImportImpact ? (
              <div
                className={`local-import-impact${
                  localImportBlocked ? " local-import-impact--warning" : ""
                }`}
                role={localImportBlocked ? "alert" : "status"}
              >
                {localImportBlocked ? (
                  <TriangleAlert size={15} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={15} strokeWidth={2.2} aria-hidden="true" />
                )}
                <span>{t(localImportImpact.message, localImportImpact.values)}</span>
              </div>
            ) : null}
            {localSkillSource && !selectedLocalInventory && onScanLocalSource && onImportLocalSource ? (
              <ProjectSkillDiscoveryPanel
                rootPath={localSkillSource.rootPath}
                sourceKind={localSkillSource.kind}
                sourcePath={localSkillSource.path}
                onScan={onScanLocalSource}
                onImport={onImportLocalSource}
              />
            ) : null}
          </section>
        </div>
      ) : !githubScanResult ? (
        <div className="library-import-content">
          <section className="library-import-panel">
            <div className="github-scan-field">
              <span className="library-import-field-label">
                {t("Repository")}
                <InfoTip label={t("Paste a GitHub URL or a Git HTTPS/SSH clone address. Repository scans never modify your checkout.")} />
              </span>
              <input
                aria-label={t("Repository address")}
                placeholder="https://github.com/owner/repo or git@host:team/repo.git"
                disabled={localImportOperation}
                value={githubUrl}
                onChange={(event) => onGithubUrlChange(event.currentTarget.value)}
              />
            </div>
            <details className="repository-advanced">
              <summary>
                <Settings2 size={14} strokeWidth={2.1} aria-hidden="true" />
                {t("Advanced")}
                <ChevronDown
                  className="repository-advanced-chevron"
                  size={14}
                  strokeWidth={2.1}
                  aria-hidden="true"
                />
              </summary>
              <div className="repository-advanced-grid">
                <label>
                  <span>{t("Ref")}</span>
                  <input
                    aria-label={t("Repository ref")}
                    placeholder={t("Default branch")}
                    disabled={Boolean(githubOperation)}
                    value={repositoryRef}
                    onChange={(event) => onRepositoryRefChange(event.currentTarget.value)}
                  />
                </label>
                <label>
                  <span>{t("Directory")}</span>
                  <input
                    aria-label={t("Repository directory")}
                    placeholder="skills/review"
                    disabled={Boolean(githubOperation)}
                    value={repositoryDirectory}
                    onChange={(event) => onRepositoryDirectoryChange(event.currentTarget.value)}
                  />
                </label>
                <label>
                  <span>{t("Connection")}</span>
                  <select
                    aria-label={t("Repository connection")}
                    disabled={Boolean(githubOperation)}
                    value={repositoryConnection}
                    onChange={(event) =>
                      onRepositoryConnectionChange(
                        event.currentTarget.value as "auto" | "system-git"
                      )
                    }
                  >
                    <option value="auto">{t("Automatic")}</option>
                    <option value="system-git">{t("System Git")}</option>
                  </select>
                </label>
              </div>
            </details>
          </section>
        </div>
      ) : (
        <RepositorySkillCandidateList
          scanResult={githubScanResult}
          scanSummary={repositoryScanSummary}
          selectedSources={githubSelectedSources}
          candidateIds={githubCandidateIds}
          importProgress={githubImportProgress}
          importResult={githubImportResult}
          retrySourceUrl={githubRetrySourceUrl}
          operation={githubOperation}
          onChangeSource={onChangeRepositorySource}
          onSelectAll={onSelectAllCandidates}
          onSelectCandidate={onSelectCandidate}
          onSetCandidateId={onSetCandidateId}
          onRetry={onRetryCandidate}
        />
      )}

      {githubOperationError ? (
        <div className="inline-state inline-state--error import-inline-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>{githubOperationError}</span>
          {githubApiRetryAvailable ? (
            <button
              className="inline-state-action"
              type="button"
              disabled={Boolean(githubOperation)}
              onClick={onRetryWithSystemGit}
            >
              {t("Try with System Git")}
            </button>
          ) : null}
        </div>
      ) : null}
      <footer className="preview-actions import-dialog-actions ui-dialog-footer">
        <Button
          variant={githubImportResult ? "primary" : "secondary"}
          disabled={
            localImportOperation ||
            dismissDisabled ||
            importStopRequested
          }
          onClick={onClose}
          icon={importStopRequested
            ? <LoaderCircle className="is-spinning" size={15} />
            : undefined}
        >
          {t(
            githubOperation === "importing"
              ? importStopRequested ? "Stopping..." : "Stop import"
              : "Close"
          )}
        </Button>
        {source === "local" && selectedLocalInventory ? (
          <Button
            variant="primary"
            aria-busy={localImportOperation}
            disabled={
              !localSkillPath.trim() ||
              localImportOperation ||
              Boolean(githubOperation) ||
              localImportBlocked
            }
            onClick={onImportLocal}
            icon={localImportOperation
              ? <LoaderCircle className="is-spinning" size={15} />
              : undefined}
          >
            {localImportOperation ? t("Importing...") : t("Import copy")}
          </Button>
        ) : source === "local" ? null : !githubScanResult ? (
          <Button
            variant="primary"
            aria-busy={githubOperation === "scanning"}
            disabled={!githubUrl.trim() || Boolean(githubOperation) || localImportOperation}
            icon={githubOperation === "scanning"
              ? <LoaderCircle className="is-spinning" size={15} />
              : undefined}
            onClick={onScanRepository}
          >
            {t(githubOperation === "scanning" ? "Scanning..." : "Scan")}
          </Button>
        ) : githubImportResult ? null : (
          <Button
            variant="primary"
            aria-busy={githubOperation === "importing"}
            disabled={githubSelectedSources.length === 0 || Boolean(githubOperation)}
            icon={githubOperation === "importing"
              ? <LoaderCircle className="is-spinning" size={15} />
              : undefined}
            onClick={onImportSelected}
          >
            {githubOperation === "importing"
              ? t("Importing...")
              : t("Import {{count}}", { count: githubSelectedSources.length })}
          </Button>
        )}
      </footer>
    </ModalFrame>
  );
};
