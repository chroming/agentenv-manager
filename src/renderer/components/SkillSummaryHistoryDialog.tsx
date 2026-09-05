import { useEffect, useRef, useState } from "react";
import type { SkillSummary } from "../../shared/skillSummaries";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { Button, DialogBody, DialogFooter, DialogHeader, IconButton, ModalFrame, Notice } from "./ui";
import { Maximize2, Minimize2 } from "lucide-react";
import { SkillSummaryContent } from "./SkillSummaryContent";
import { DiffWorkspaceDialog } from "./DiffWorkspaceDialog";

export const SkillSummaryHistoryDialog = ({ id, onClose }: { id: string; onClose(): void }) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const [records, setRecords] = useState<SkillSummary[]>();
  const [error, setError] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [evidence, setEvidence] = useState<{ record: SkillSummary; path: string }>();
  useModalDialog({ open: true, dialogRef, initialFocusRef, onDismiss: onClose });
  useEffect(() => {
    let active = true;
    void window.agentEnv.listSkillSummaries(id).then((next) => { if (active) setRecords(next); })
      .catch((error) => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [id]);
  return <><ModalFrame suspended={Boolean(evidence)} ariaLabel={t("Update summaries")} className={`profile-dialog ui-dialog-shell${maximized ? " is-maximized" : ""}`}
    dialogRef={dialogRef} onDismiss={onClose}>
    <DialogHeader title={t("Update summaries")} description={id} actions={<IconButton label={t(maximized ? "Restore" : "Maximize preview")} onClick={() => setMaximized(!maximized)}>
      {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </IconButton>} />
    <DialogBody>
      {error ? <Notice tone="warning" role="alert">{error}</Notice> : !records ? <p role="status">{t("Loading...")}</p> : !records.length ? <p>{t("No saved summaries. Generate one from an update preview.")}</p> : records.map((record) => <details key={record.key} open={records.length === 1}>
        <summary>{new Date(record.generatedAt).toLocaleString()} · {record.beforeHash.slice(0, 7)} → {record.afterHash.slice(0, 7)}</summary>
        <SkillSummaryContent summary={record} onViewFile={(path) => setEvidence({ record, path })} />
      </details>)}
    </DialogBody>
    <DialogFooter><Button ref={initialFocusRef} onClick={onClose}>{t("Close")}</Button></DialogFooter>
  </ModalFrame>
  {evidence ? <DiffWorkspaceDialog open changes={evidence.record.files.map((file) => ({ ...file, before: "", after: "", action: "write" as const }))}
    initialPath={evidence.path} title={t("Update summaries")} onClose={() => setEvidence(undefined)} /> : null}</>;
};
