import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  TriangleAlert
} from "lucide-react";
import type { ProjectSkillScanResult, SkillSourceCollectionRef } from "../../shared/types";
import { useI18n } from "../i18n";
import { Button } from "./ui";
import { OverflowTooltip } from "./OverflowTooltip";

interface ProjectSkillDiscoveryPanelProps {
  rootPath: string;
  onScan(rootPath: string): Promise<ProjectSkillScanResult>;
  onImport(path: string, sourceCollection: SkillSourceCollectionRef): Promise<boolean>;
}

export const ProjectSkillDiscoveryPanel = ({
  rootPath,
  onScan,
  onImport
}: ProjectSkillDiscoveryPanelProps) => {
  const { formatDate, t } = useI18n();
  const [result, setResult] = useState<ProjectSkillScanResult>();
  const [operation, setOperation] = useState<"scanning">();
  const [importingPath, setImportingPath] = useState<string>();
  const [importFailure, setImportFailure] = useState<{ path: string; message: string }>();
  const [error, setError] = useState("");
  const onScanRef = useRef(onScan);
  const scanRequestRef = useRef(0);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const scan = useCallback(async () => {
    const requestId = ++scanRequestRef.current;
    setOperation("scanning");
    setError("");
    setImportFailure(undefined);
    try {
      const nextResult = await onScanRef.current(rootPath);
      if (requestId === scanRequestRef.current) setResult(nextResult);
    } catch (unknownError) {
      if (requestId === scanRequestRef.current) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    } finally {
      if (requestId === scanRequestRef.current) setOperation(undefined);
    }
  }, [rootPath]);

  const importCandidate = async (path: string, relativePath: string) => {
    if (!result?.sourceScope) return;
    setImportingPath(path);
    setImportFailure(undefined);
    try {
      const imported = await onImport(path, {
        ...result.sourceScope,
        sourceSubpath: relativePath === "." ? "" : relativePath
      });
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

  useEffect(() => {
    setResult(undefined);
    setError("");
    void scan();
    return () => {
      scanRequestRef.current += 1;
    };
  }, [scan]);

  return (
    <div className="project-skill-discovery">
      <div className="project-skill-discovery__toolbar">
        <div>
          <strong>{t("Skills in this folder")}</strong>
          <small>{t("This folder becomes a source. AgentEnv never changes its contents.")}</small>
        </div>
        <div>
          <Button
            disabled={Boolean(operation) || Boolean(importingPath)}
            icon={operation === "scanning"
              ? <LoaderCircle className="is-spinning" size={15} />
              : <RefreshCw size={15} strokeWidth={2.2} />}
            onClick={() => void scan()}
          >
            {t(operation === "scanning" ? "Scanning..." : "Scan")}
          </Button>
        </div>
      </div>

      <OverflowTooltip className="project-root-path" text={rootPath} />

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
              {t("Results are limited. Choose a narrower source folder.")}
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
              <div className="project-skill-empty">{t("No Skills found in this folder.")}</div>
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
                      onClick={() => void importCandidate(candidate.path, candidate.relativePath)}
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
