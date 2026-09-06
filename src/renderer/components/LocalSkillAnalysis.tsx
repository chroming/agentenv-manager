import { useEffect, useState } from "react";
import type { SkillImportPreview } from "../../shared/types";
import type { AIAnalysisDocument } from "../../shared/aiAssistance";
import { useAIPreferences } from "../hooks/useAIPreferences";
import { useI18n } from "../i18n";
import { Button, InteractiveStatus, Notice } from "./ui";
import { AIAnalysisReview } from "./AIAnalysisReview";

export const LocalSkillAnalysis = ({ sourcePath, comparisonPaths = [] }: { sourcePath: string; comparisonPaths?: string[] }) => {
  const { t } = useI18n();
  const prefs = useAIPreferences();
  const [previews, setPreviews] = useState<SkillImportPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const allowed = prefs.enabled("duplicates");
  const identity = JSON.stringify([...new Set([sourcePath, ...comparisonPaths])]);
  useEffect(() => {
    let valid = true;
    setPreviews([]); setError(""); setBusy(allowed);
    if (allowed) void (async () => {
      const results: SkillImportPreview[] = [];
      const errors: string[] = [];
      for (const path of JSON.parse(identity) as string[]) {
        if (!valid) return;
        try { results.push(await window.agentEnv.previewSkillImport({ kind: "local", input: { sourcePath: path } })); }
        catch (error) { errors.push(String(error)); }
      }
      if (valid) { setPreviews(results); setError(errors.join("\n")); setBusy(false); }
    })();
    return () => { valid = false; };
  }, [identity, allowed, retry]);
  if (!allowed) return null;

  // Compare distinct versions even before Library import, using the safe import preview for each read.
  const versions = new Map<string, SkillImportPreview["incoming"]>();
  for (const preview of previews) {
    for (const version of [preview.incoming, ...preview.conflicts.map((conflict) => conflict.existing)]) {
      versions.set(version.contentHash ?? version.skillMarkdown, version);
    }
  }
  const documents: AIAnalysisDocument[] = [...versions.values()].flatMap((version, index) => [
    { id: `version:${index}`, label: `${version.name} · ${version.version ?? version.contentHash?.slice(0, 7) ?? index + 1}`, content: version.skillMarkdown },
    { id: `scope:${index}`, label: `Version ${index + 1}`, content: JSON.stringify({ hash: version.contentHash, version: version.version, modified: version.modifiedAt, scope: "SKILL.md and version metadata. Other files are not compared unless file diff documents are supplied." }) }
  ]);
  for (const [index, preview] of previews.entries()) {
    for (const [conflictIndex, conflict] of preview.conflicts.entries()) {
      documents.push(...conflict.changes.map((change, fileIndex) => ({ id: `file:${index}:${conflictIndex}:${fileIndex}`, label: change.path, content: change.diff })));
    }
  }
  return <>
    {busy ? <InteractiveStatus busy statusKind="working" label={t("Reading...")} /> : null}
    {error ? <Notice tone="warning" role="alert" actions={<Button onClick={() => setRetry((value) => value + 1)}>{t("Retry")}</Button>}>{error}</Notice> : null}
    {!busy && !error && versions.size > 1 ? <AIAnalysisReview subject={{ kind: "duplicates", objectId: identity, documents }} /> : null}
  </>;
};
