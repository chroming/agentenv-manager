import { useEffect, useRef, useState } from "react";
import type { ConversationDeletePreview } from "../../shared/conversationDeletion";
import { useI18n } from "../i18n";
import { formatBytes } from "../formatBytes";
import { useModalDialog } from "../hooks/useModalDialog";
import { Button, DialogBody, DialogFooter, DialogHeader, ModalFrame, Notice } from "./ui";
import { TriangleAlert } from "lucide-react";
import { DiagnosticMessage } from "./ui/DiagnosticCopyButton";
import { FileTypeIcon } from "./FileTypeIcon";

export const ConversationDeletionDialog = ({ id, onClose, onDeleted }: {
  id: string; onClose(): void; onDeleted(backupId: string): void;
}) => {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ConversationDeletePreview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useModalDialog({ open: true, dialogRef: ref, initialFocusRef: cancelRef, onDismiss: onClose, dismissDisabled: busy });
  useEffect(() => {
    let active = true;
    void window.agentEnv.previewDeleteConversation(id).then((result) => { if (active) setPreview(result); })
      .catch((e) => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  const remove = async () => {
    if (!preview) return;
    setBusy(true); setError("");
    try { const result = await window.agentEnv.deleteConversation(preview.previewId); onDeleted(result.backupId); }
    catch (e) { setError(String(e)); setPreview(undefined); }
    finally { setBusy(false); }
  };
  return <ModalFrame ariaLabel={t("Delete conversation?")} dialogRef={ref} onDismiss={onClose} dismissDisabled={busy}>
    <DialogHeader title={t("Delete conversation?")} description={preview?.title} />
    <DialogBody>
      {loading ? <p role="status">{t("Preparing deletion preview…")}</p> : null}
      {error ? <DiagnosticMessage message={error} /> : null}
      {preview ? <>
        <p>{t("Original Agent history files will be removed. You can restore this conversation from Recently deleted.")}</p>
        <p className="muted">{preview.retentionDays === null ? t("Kept until permanently deleted.") : t("Recoverable for {{days}} days after deletion.", { days: preview.retentionDays })} {formatBytes(preview.sizeBytes)}</p>
        {preview.warnings.map((warning) => <Notice tone="warning" icon={<TriangleAlert size={16} />} key={warning}>{t(warning)}</Notice>)}
        <details><summary>{preview.files.length === 1 ? t("1 file") : t("{{count}} files", { count: preview.files.length })}</summary>
          <div className="backup-preview-list">{preview.files.map((path) => <div className="backup-preview-file" key={path}><FileTypeIcon kind="file" path={path} /><code>{path}</code></div>)}</div>
        </details>
      </> : null}
    </DialogBody>
    <DialogFooter><Button ref={cancelRef} disabled={busy} onClick={onClose}>{t("Cancel")}</Button><Button variant="danger" busy={busy} disabled={!preview || busy} onClick={() => void remove()}>{t("Delete conversation")}</Button></DialogFooter>
  </ModalFrame>;
};
