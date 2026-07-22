import { useState } from "react";
import {
  CheckCircle2,
  FolderPlus,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  X
} from "lucide-react";
import type { ProjectSkillScanResult } from "../../shared/types";
import { useI18n } from "../i18n";
import { Button, IconButton } from "./ui";
import { OverflowTooltip } from "./OverflowTooltip";

interface ProjectSkillDiscoveryPanelProps {
  roots: string[];
  onAddRoot(): Promise<string | undefined>;
  onRemoveRoot(path: string): Promise<void>;
  onScan(): Promise<ProjectSkillScanResult>;
  onImport(path: string): Promise<boolean>;
}

export const ProjectSkillDiscoveryPanel = ({
  roots,
  onAddRoot,
  onRemoveRoot,
  onScan,
  onImport
}: ProjectSkillDiscoveryPanelProps) => {
  const { formatDate, t } = useI18n();
  const [result, setResult] = useState<ProjectSkillScanResult>();
  const [operation, setOperation] = useState<"adding" | "scanning">();
  const [removingRoot, setRemovingRoot] = useState<string>();
  const [importingPath, setImportingPath] = useState<string>();
  const [importFailure, setImportFailure] = useState<{ path: string; message: string }>();
  const [error, setError] = useState("");

  const scan = async () => {
    setOperation("scanning");
    setError("");
    setImportFailure(undefined);
    try {
      setResult(await onScan());
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const addRoot = async () => {
    setOperation("adding");
    setError("");
    try {
      const added = await onAddRoot();
      if (added) setResult(undefined);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const importCandidate = async (path: string) => {
    setImportingPath(path);
    setImportFailure(undefined);
    try {
      const imported = await onImport(path);
      if (imported) await scan();
    } catch (unknownError) {
      setImportFailure({
        path,
        message: unknownError instanceof Error ? unknownError.message : String(unknownError)
      });
    } finally {
      setImportingPath(undefined);
    }
  };

  return (
    <div className="project-skill-discovery">
      <div className="project-skill-discovery__toolbar">
        <div>
          <strong>{t("Project folders")}</strong>
          <small>{t("Read-only discovery. Importing copies a selected Skill into Library after preview.")}</small>
        </div>
        <div>
          <Button
            disabled={Boolean(operation) || Boolean(importingPath)}
            icon={<FolderPlus size={15} strokeWidth={2.2} />}
            onClick={() => void addRoot()}
          >
            {t("Add folder")}
          </Button>
          <Button
            disabled={roots.length === 0 || Boolean(operation) || Boolean(importingPath)}
            icon={operation === "scanning"
              ? <LoaderCircle className="is-spinning" size={15} />
              : <RefreshCw size={15} strokeWidth={2.2} />}
            onClick={() => void scan()}
          >
            {t(operation === "scanning" ? "Scanning..." : "Scan")}
          </Button>
        </div>
      </div>

      {roots.length > 0 ? (
        <div className="project-root-list" aria-label={t("Project folders") }>
          {roots.map((root) => (
            <div className="project-root-row" key={root}>
              <OverflowTooltip className="project-root-path" text={root} />
              <IconButton
                label={t("Remove project folder {{path}}", { path: root })}
                disabled={Boolean(operation) || Boolean(importingPath) || Boolean(removingRoot)}
                size="compact"
                variant="ghost"
                onClick={() => {
                  setRemovingRoot(root);
                  setError("");
                  void onRemoveRoot(root)
                    .then(() => setResult(undefined))
                    .catch((unknownError) =>
                      setError(unknownError instanceof Error ? unknownError.message : String(unknownError))
                    )
                    .finally(() => setRemovingRoot(undefined));
                }}
              >
                {removingRoot === root
                  ? <LoaderCircle className="is-spinning" size={14} />
                  : <X size={14} strokeWidth={2.2} />}
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        <div className="project-skill-empty">{t("Add a project folder to discover Skills without changing the project.")}</div>
      )}

      {error ? (
        <div className="inline-state inline-state--error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          <OverflowTooltip className="project-skill-error" text={error} />
        </div>
      ) : null}

      {result ? (
        <div className="project-skill-results">
          <div className="project-skill-results__summary">
            <strong>
              {t(
                result.candidates.length === 1 ? "1 Skill found" : "{{count}} Skills found",
                { count: result.candidates.length }
              )}
            </strong>
            <span>{t("{{count}} folders checked", { count: result.scannedDirectories })}</span>
          </div>
          {result.truncated ? (
            <div className="inline-state inline-state--warning" role="status">
              <TriangleAlert size={15} aria-hidden="true" />
              {t("Results are limited. Choose a narrower project folder.")}
            </div>
          ) : null}
          {result.issues.map((issue) => (
            <div className="inline-state inline-state--warning" key={`${issue.rootPath}:${issue.message}`}>
              <TriangleAlert size={15} aria-hidden="true" />
              <OverflowTooltip className="project-skill-issue" displayText={issue.rootPath} text={`${issue.rootPath}\n${issue.message}`} />
            </div>
          ))}
          <div className="project-skill-list">
            {result.candidates.length === 0 ? (
              <div className="project-skill-empty">{t("No Skills found in these project folders.")}</div>
            ) : result.candidates.map((candidate) => {
              const importable = candidate.status === "ready" || candidate.status === "changed";
              const importing = importingPath === candidate.path;
              const failed = importFailure?.path === candidate.path;
              return (
                <div className={`project-skill-row${failed ? " has-error" : ""}`} key={candidate.path}>
                  <span className={`project-skill-row__state is-${failed ? "invalid" : candidate.status}`} aria-hidden="true">
                    {candidate.status === "invalid" || failed
                      ? <TriangleAlert size={15} strokeWidth={2.2} />
                      : <CheckCircle2 size={15} strokeWidth={2.2} />}
                  </span>
                  <span className="project-skill-row__main">
                    <strong>{candidate.name}</strong>
                    <OverflowTooltip className="project-skill-row__path" text={candidate.path} displayText={candidate.relativePath} />
                    {failed ? (
                      <OverflowTooltip
                        className="project-skill-row__error"
                        displayText={t("Import failed")}
                        text={importFailure.message}
                      />
                    ) : candidate.description ? (
                      <OverflowTooltip className="project-skill-row__description" text={candidate.description} />
                    ) : null}
                  </span>
                  <span className="project-skill-row__meta">
                    <span>{candidate.version ? `v${candidate.version}` : t("No version")}</span>
                    <span>{candidate.modifiedAt ? formatDate(candidate.modifiedAt) : "—"}</span>
                  </span>
                  {importable ? (
                    <Button
                      size="compact"
                      aria-busy={importing}
                      disabled={Boolean(operation) || Boolean(importingPath)}
                      icon={importing ? <LoaderCircle className="is-spinning" size={14} /> : undefined}
                      onClick={() => void importCandidate(candidate.path)}
                    >
                      {importing
                        ? t("Importing...")
                        : failed
                          ? t("Retry")
                        : candidate.status === "changed"
                          ? t("Review changes")
                          : t("Import")}
                    </Button>
                  ) : (
                    <OverflowTooltip
                      className={`resource-chip resource-chip--${candidate.status === "invalid" ? "warning" : "managed"}`}
                      displayText={t(candidate.status === "invalid" ? "Invalid" : "In Library")}
                      text={candidate.error ?? candidate.existingLibraryId ?? t("Already in Library")}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};
