import { useRef, useState } from "react";
import { CheckCircle2, Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import type { SkillLibraryEntry, SkillTagsInput } from "../../shared/types";
import { canonicalizeSkillTags, parseSkillTags, skillTagKey } from "../../shared/skillTags";
import { useSkillTagSuggestions, type TagReviewRow } from "../hooks/useSkillTagSuggestions";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { SkillTagList } from "./SkillTags";
import { Button, ChoiceInput, DialogBody, DialogFooter, DialogHeader, IconButton, InteractiveStatus, ModalFrame, Notice, ResourcePanelToolbar, TagChip, TextField } from "./ui";

const TagSuggestions = ({ row, skill, vocabulary, disabled, onChange }: {
  row: TagReviewRow; skill: SkillLibraryEntry; vocabulary: string[]; disabled: boolean; onChange(tags: string[]): void;
}) => {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const update = (tags: string[]) => {
    try { const next = canonicalizeSkillTags(tags, vocabulary); parseSkillTags([...(skill.tags ?? []), ...next]); onChange(next); setError(""); }
    catch (error) { setError(String(error)); }
  };
  return <div className="skill-tag-editor-selection">
    <div className="skill-tag-editor-chips" aria-label={t("Suggested tags")}>
      {row.draft.map((tag) => {
        const reason = row.record?.tags.find((item) => skillTagKey(item.tag) === skillTagKey(tag))?.reason;
        const isNew = !vocabulary.some((item) => skillTagKey(item) === skillTagKey(tag));
        return <TagChip className="skill-tag-editor-chip" key={skillTagKey(tag)} disabled={disabled} title={[isNew ? t("New tag") : "", reason].filter(Boolean).join(" · ")}
          aria-label={t("Remove tag {{tag}}", { tag })} onClick={() => update(row.draft.filter((item) => skillTagKey(item) !== skillTagKey(tag)))}>
          <span>{tag}{isNew ? ` · ${t("New")}` : ""}</span><X size={12} />
        </TagChip>;
      })}
      {!row.draft.length ? <span className="settings-muted">{t("No tags selected")}</span> : null}
    </div>
    <TextField label={t("Add a tag")} value={input} disabled={disabled} maxLength={32} error={error || undefined}
      placeholder={t("Type a tag and press Enter")} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => {
        if (event.key === "Enter" && input.trim()) { event.preventDefault(); update([...row.draft, input]); setInput(""); }
      }} />
  </div>;
};

export const SkillTagSuggestionsDialog = ({ skills, vocabulary, onClose, onSave }: {
  skills: SkillLibraryEntry[]; vocabulary: string[]; onClose(): void; onSave(input: SkillTagsInput): Promise<boolean>;
}) => {
  const { t } = useI18n();
  const state = useSkillTagSuggestions(skills, onSave);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [maximized, setMaximized] = useState(false);
  const close = () => { state.stop(); onClose(); };
  useModalDialog({ open: true, dialogRef, initialFocusRef: closeRef, onDismiss: close, dismissDisabled: state.busy === "saving" });
  const waiting = state.busy === "generating";
  const locked = Boolean(state.busy);
  const allSelected = skills.length > 0 && skills.every((skill) => state.selected.has(skill.id));
  const allCached = state.selected.size > 0 && [...state.selected].every((id) => Boolean(state.rows[id]?.record));
  return <ModalFrame ariaLabel={t("AI tags")} className="ui-dialog-shell" maximized={maximized} size={skills.length > 1 ? "wide" : "default"}
    dialogRef={dialogRef} onDismiss={close} dismissDisabled={state.busy === "saving"} dismissPolicy="intentional">
    <DialogHeader title={t("AI tags")} description={t("Suggest task labels. Existing tags are kept; nothing is saved until you confirm.")}
      actions={<IconButton label={t(maximized ? "Restore" : "Maximize preview")} onClick={() => setMaximized(!maximized)}>
        {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </IconButton>} />
    <DialogBody className="skill-ai-tags-body">
      <ResourcePanelToolbar>
        <label className="skill-ai-tags-selection"><ChoiceInput type="checkbox" aria-label={t("Select all")} checked={allSelected} disabled={locked}
          onChange={() => state.setSelected(allSelected ? new Set() : new Set(skills.map((skill) => skill.id)))} />{t("{{count}} selected", { count: state.selected.size })}</label>
        {state.allowed ? <Button icon={<Sparkles size={15} />} busy={state.busy === "loading" || state.busy === "preparing"} disabled={locked || !state.selected.size}
          onClick={() => void state.prepare(undefined, allCached)}>{t(allCached ? "Regenerate selected" : "Suggest tags")}</Button> : null}
      </ResourcePanelToolbar>
      {state.error ? <Notice tone="warning" role="alert">{state.error}</Notice> : null}
      <div className="skill-ai-tags-list">
        {skills.map((skill) => {
          const row = state.rows[skill.id];
          const working = row?.status === "running";
          const saved = row?.status === "saved";
          const statusLabel = working ? state.busy === "saving" ? "Saving..." : "Analyzing" : saved ? "Saved" : row?.error ? "Failed" : row?.status === "skipped" ? "Skipped" : row?.record ? "Ready" : "Not analyzed";
          return <section key={skill.id} className="skill-ai-tags-row" aria-label={skill.name}>
            <div className="skill-ai-tags-row-heading">
              <label className="skill-ai-tags-selection"><ChoiceInput type="checkbox" aria-label={t("Select {{name}}", { name: skill.name })} checked={state.selected.has(skill.id)} disabled={locked}
                onChange={() => state.setSelected((current) => { const next = new Set(current); if (next.has(skill.id)) next.delete(skill.id); else next.add(skill.id); return next; })} />
                <span title={skill.name}>{skill.name}</span></label>
              <InteractiveStatus size="metadata" busy={working} icon={saved ? <CheckCircle2 size={14} /> : undefined}
                statusKind={working ? "working" : saved ? "success" : row?.error ? "error" : "neutral"}
                label={t(statusLabel)} />
              {state.allowed ? <Button size="compact" disabled={locked || saved} onClick={() => void state.prepare([skill.id], Boolean(row?.record))}>
                {t(row?.record ? "Regenerate" : row?.error || row?.status === "skipped" ? "Retry" : "Suggest tags")}
              </Button> : null}
            </div>
            {skill.tags?.length ? <div className="skill-ai-tags-existing"><span>{t("Existing tags")}</span><SkillTagList tags={skill.tags} maxVisible={12} /></div> : null}
            {row?.error ? <Notice tone="warning" role="alert">{row.error}</Notice> : null}
            {row?.record ? <>
              {row.record.partial ? <p className="settings-muted">{t("Partial analysis")}</p> : null}
              {!row.record.tags.length ? <p className="settings-muted">{t("No distinctive tags were found. You can add your own.")}</p> : null}
              <TagSuggestions row={row} skill={skill} vocabulary={vocabulary} disabled={locked || saved} onChange={(draft) => state.patch(skill.id, { draft })} />
            </> : null}
          </section>;
        })}
      </div>
    </DialogBody>
    <DialogFooter>
      {waiting ? <Button onClick={state.stop}>{t("Stop")}</Button> : null}
      <Button ref={closeRef} variant={state.savedCount && !state.saveable.length ? "primary" : "secondary"} disabled={state.busy === "saving"} onClick={close}>{t("Close")}</Button>
      {state.saveable.length ? <Button variant="primary" busy={state.busy === "saving"} disabled={locked && state.busy !== "saving"}
        onClick={() => void state.save()}>{t("Save tags ({{count}})", { count: state.saveable.length })}</Button> : null}
    </DialogFooter>
  </ModalFrame>;
};
