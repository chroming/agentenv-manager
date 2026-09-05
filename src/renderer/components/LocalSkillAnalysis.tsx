import { useEffect, useState } from "react";
import type { SkillImportPreview } from "../../shared/types";
import { useAIPreferences } from "../hooks/useAIPreferences";
import { useI18n } from "../i18n";
import { Button, Notice } from "./ui";
import { AIAnalysisReview } from "./AIAnalysisReview";

export const LocalSkillAnalysis = ({ sourcePath }: { sourcePath: string }) => {
  const { t } = useI18n();
  const prefs = useAIPreferences();
  const [preview, setPreview] = useState<SkillImportPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setPreview(undefined); setError(""); }, [sourcePath]);
  const read = async () => {
    setBusy(true); setError("");
    try { setPreview(await window.agentEnv.previewSkillImport({ kind: "local", input: { sourcePath } })); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  if (!prefs.enabled("duplicates") && !preview) return null;
  return <>
    {!preview && prefs.enabled("duplicates") ? <Button busy={busy} onClick={() => void read()}>{t("Analyze differences")}</Button> : null}
    {error ? <Notice tone="warning" role="alert">{error}</Notice> : null}
    {preview && !preview.conflicts.length ? <Notice>{t("No Library version to compare. Add this Skill to Library using the existing controls.")}</Notice> : null}
    {preview?.conflicts.map((conflict) => <AIAnalysisReview key={`${sourcePath}:${conflict.existing.id}`} subject={{ kind: "duplicates", documents: [
      { id: "library", label: conflict.existing.name, content: conflict.existing.skillMarkdown },
      { id: "incoming", label: preview.incoming.name, content: preview.incoming.skillMarkdown },
      ...conflict.changes.slice(0, 197).map((change, index) => ({ id: `file:${index}`, label: change.path, content: change.diff })),
      { id: "scope", label: "Version scope", content: JSON.stringify({ library: { hash: conflict.existing.contentHash, version: conflict.existing.version, modified: conflict.existing.modifiedAt }, incoming: { hash: preview.incoming.contentHash, version: preview.incoming.version, modified: preview.incoming.modifiedAt }, omittedDiffs: Math.max(0, conflict.changes.length - 197) }) }
    ] }} />)}
  </>;
};
