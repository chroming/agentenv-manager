import { type RefObject, useEffect, useRef, useState } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import type { SkillLibraryEntry, SkillRemovalPreview } from "../../shared/types";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { Button, DialogBody, DialogFooter, DialogHeader, ModalFrame, DiagnosticMessage, Notice } from "./ui";
import { OverflowTooltip as PreviewText } from "./OverflowTooltip";

export const SkillRemovalDialog = ({ skill, fallbackFocusRef, onClose, onRemove }: {
  skill: SkillLibraryEntry;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onRemove(id: string, previewId: string): void | Promise<void>;
}) => {
  const { t } = useI18n();
  const [preview, setPreview] = useState<SkillRemovalPreview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLElement>(null), cancel = useRef<HTMLButtonElement>(null);
  useModalDialog({ open: true, dialogRef: dialog, initialFocusRef: cancel, fallbackFocusRef, onDismiss: onClose, dismissDisabled: busy });
  useEffect(() => {
    let active = true;
    setLoading(true); setPreview(undefined); setError("");
    void window.agentEnv.previewRemoveLibrarySkill(skill.id).then((value) => { if (active) setPreview(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [skill.id, attempt]);
  const remove = async () => {
    if (!preview) return;
    setBusy(true); setError("");
    try { await onRemove(skill.id, preview.previewId); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setPreview(undefined); }
    finally { setBusy(false); }
  };
  return <ModalFrame ariaLabel={t("Remove from library")} dialogRef={dialog} onDismiss={onClose} dismissDisabled={busy} className="profile-form-dialog--compact">
    <DialogHeader title={t("Remove from library")} description={t("Remove {{name}}, its Profile and group references, and managed Agent installs. Unmanaged copies are kept. A recovery copy is saved.", { name: skill.name })} />
    <DialogBody className="skill-delete-paths">
      {loading ? <div role="status" className="inline-loading"><LoaderCircle size={14} className="is-spinning" />{t("Preparing preview…")}</div> : null}
      {error ? <DiagnosticMessage message={error} /> : null}
      {preview?.sharedPaths?.length ? <Notice tone="warning" icon={<TriangleAlert size={16} />}>
        {t("Removing shared copies affects every Agent that reads this folder, including Agents not listed here.")}
      </Notice> : null}
      <div><strong>{t("Library")}</strong><PreviewText className="skill-delete-path" text={preview?.libraryPath ?? skill.path} /></div>
      {preview?.profiles.length ? <div><strong>{t("Profiles")}</strong><p className="muted">{preview.profiles.map((profile) => profile.name).join(", ")}</p></div> : null}
      {preview?.groups.length ? <div><strong>{t("Groups")}</strong><p className="muted">{preview.groups.map((group) => group.name).join(", ")}</p></div> : null}
      {preview?.installs.map((install) => <div key={install.path}><strong>{t("Managed Agent installs")}</strong><PreviewText className="skill-delete-path" text={install.path} /></div>)}
    </DialogBody>
    <DialogFooter><Button ref={cancel} disabled={busy} onClick={onClose}>{t("Cancel")}</Button>
      {error ? <Button onClick={() => setAttempt((value) => value + 1)}>{t("Review again")}</Button> : null}
      <Button variant="danger" busy={busy} disabled={!preview || loading || busy} onClick={() => void remove()}>{t(preview?.installs.length ? "Remove skill and installs" : "Remove skill")}</Button>
    </DialogFooter>
  </ModalFrame>;
};
