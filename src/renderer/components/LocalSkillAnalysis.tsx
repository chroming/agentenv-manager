import { useEffect, useState } from "react";
import type { SkillImportPreview } from "../../shared/types";
import { useAIPreferences } from "../hooks/useAIPreferences";
import { useI18n } from "../i18n";
import { Button, InteractiveStatus, Notice } from "./ui";
import { AIAnalysisReview } from "./AIAnalysisReview";

export const LocalSkillAnalysis = ({ sourcePath }: { sourcePath: string }) => {
  const { t } = useI18n();
  const prefs = useAIPreferences();
  const [preview, setPreview] = useState<SkillImportPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const allowed = prefs.enabled("duplicates");
  useEffect(() => {
    let valid = true;
    setPreview(undefined); setError(""); setBusy(allowed);
    if (allowed) void window.agentEnv.previewSkillImport({ kind: "local", input: { sourcePath } })
      .then((value) => { if (valid) setPreview(value); })
      .catch((error) => { if (valid) setError(String(error)); })
      .finally(() => { if (valid) setBusy(false); });
    return () => { valid = false; };
  }, [sourcePath, allowed, retry]);
  if (!prefs.enabled("duplicates") && !preview) return null;
  return <>
    {busy ? <InteractiveStatus busy statusKind="working" label={t("Reading...")} /> : null}
    {error ? <Notice tone="warning" role="alert" actions={<Button onClick={() => setRetry((value) => value + 1)}>{t("Retry")}</Button>}>{error}</Notice> : null}
    {preview && !preview.conflicts.length ? <Notice>{t("No Library version to compare. Add this Skill to Library using the existing controls.")}</Notice> : null}
    {preview?.conflicts.map((conflict) => <AIAnalysisReview key={`${sourcePath}:${conflict.existing.id}`} subject={{ kind: "duplicates", objectId: JSON.stringify([sourcePath, conflict.existing.id]), documents: [
      { id: "library", label: conflict.existing.name, content: conflict.existing.skillMarkdown },
      { id: "incoming", label: preview.incoming.name, content: preview.incoming.skillMarkdown },
      { id: "scope", label: "Version scope", content: JSON.stringify({ library: { hash: conflict.existing.contentHash, version: conflict.existing.version, modified: conflict.existing.modifiedAt }, incoming: { hash: preview.incoming.contentHash, version: preview.incoming.version, modified: preview.incoming.modifiedAt } }) },
      ...conflict.changes.map((change, index) => ({ id: `file:${index}`, label: change.path, content: change.diff }))
    ] }} />)}
  </>;
};
