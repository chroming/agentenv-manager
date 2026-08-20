import { Plus, Tags, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject
} from "react";
import type { SkillLibraryEntry, SkillTagsInput } from "../../shared/types";
import {
  canonicalizeSkillTags,
  MAX_SKILL_TAGS,
  normalizeSkillTag,
  parseSkillTags,
  skillTagKey
} from "../../shared/skillTags";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  ModalFrame,
  TagChip,
  TextField
} from "./ui";

interface SkillTagListProps {
  className?: string;
  maxVisible?: number;
  onSelect?(tag: string): void;
  tags?: readonly string[];
}

export const SkillTagList = ({
  className = "",
  maxVisible = 2,
  onSelect,
  tags = []
}: SkillTagListProps) => {
  const { t } = useI18n();
  const visibleTags = tags.slice(0, maxVisible);
  const hiddenCount = Math.max(0, tags.length - visibleTags.length);

  if (visibleTags.length === 0) return null;

  return (
    <span className={`skill-tag-list ${className}`.trim()}>
      {visibleTags.map((tag) => onSelect ? (
        <TagChip
          aria-label={t("Filter by tag {{tag}}", { tag })}
          className="skill-tag-chip is-interactive"
          key={skillTagKey(tag)}
          title={tag}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(tag);
          }}
        >
          {tag}
        </TagChip>
      ) : (
        <span className="skill-tag-chip" key={skillTagKey(tag)} title={tag}>{tag}</span>
      ))}
      {hiddenCount > 0 ? (
        <span
          className="skill-tag-chip skill-tag-chip--count"
          title={tags.slice(visibleTags.length).join(", ")}
        >
          +{hiddenCount}
        </span>
      ) : null}
    </span>
  );
};

interface SkillTagEditorDialogProps {
  availableTags: readonly string[];
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onDismiss(): void;
  onSave(input: SkillTagsInput): Promise<boolean>;
  skill?: SkillLibraryEntry;
}

export const SkillTagEditorDialog = ({
  availableTags,
  fallbackFocusRef,
  onDismiss,
  onSave,
  skill
}: SkillTagEditorDialogProps) => {
  const { t } = useI18n();
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftTags(parseSkillTags(skill?.tags, { strict: false }));
    setInput("");
    setError("");
  }, [skill]);

  useModalDialog({
    open: Boolean(skill),
    dialogRef,
    initialFocusRef: inputRef,
    fallbackFocusRef,
    onDismiss,
    dismissDisabled: saving
  });

  const originalTags = parseSkillTags(skill?.tags, { strict: false });
  const dirty =
    originalTags.length !== draftTags.length ||
    originalTags.some((tag, index) => skillTagKey(tag) !== skillTagKey(draftTags[index] ?? ""));
  const normalizedInput = normalizeSkillTag(input);
  const selectedKeys = useMemo(
    () => new Set(draftTags.map(skillTagKey)),
    [draftTags]
  );
  const atLimit = draftTags.length >= MAX_SKILL_TAGS;
  const suggestions = atLimit ? [] : availableTags.filter((tag) =>
      !selectedKeys.has(skillTagKey(tag)) &&
      (!normalizedInput || skillTagKey(tag).includes(skillTagKey(normalizedInput)))
    ).slice(0, 8);
  const canCreate = Boolean(
    !atLimit && normalizedInput &&
    !selectedKeys.has(skillTagKey(normalizedInput)) &&
    !availableTags.some((tag) => skillTagKey(tag) === skillTagKey(normalizedInput))
  );

  if (!skill) return null;

  const addTag = (tag: string) => {
    try {
      setDraftTags(canonicalizeSkillTags([...draftTags, tag], availableTags));
      setInput("");
      setError("");
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !normalizedInput) return;
    event.preventDefault();
    const existing = availableTags.find(
      (tag) => skillTagKey(tag) === skillTagKey(normalizedInput)
    );
    addTag(existing ?? normalizedInput);
  };
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      if (await onSave({ id: skill.id, tags: draftTags })) {
        onDismiss();
      } else {
        setError(t("Tags could not be saved. Try again."));
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame
      ariaLabel={t("Edit tags for {{id}}", { id: skill.id })}
      className="skill-tag-editor-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={saving}
      dismissPolicy="intentional"
      onDismiss={onDismiss}
    >
      <DialogHeader
        title={t("Edit tags")}
        description={skill.name}
      />
      <DialogBody className="skill-tag-editor-dialog__body">
        <section className="skill-tag-editor-selection" aria-label={t("Selected tags")}>
          <div className="skill-tag-editor-section-title">
            <Tags size={15} strokeWidth={2.2} aria-hidden="true" />
            <span>{t("Selected tags")}</span>
            <small>{draftTags.length}/{MAX_SKILL_TAGS}</small>
          </div>
          {draftTags.length > 0 ? (
            <div className="skill-tag-editor-chips">
              {draftTags.map((tag) => (
                <TagChip
                  aria-label={t("Remove tag {{tag}}", { tag })}
                  className="skill-tag-editor-chip"
                  key={skillTagKey(tag)}
                  title={tag}
                  onClick={() => setDraftTags((current) =>
                    current.filter((item) => skillTagKey(item) !== skillTagKey(tag)))}
                >
                  <span>{tag}</span>
                  <X size={12} strokeWidth={2.2} aria-hidden="true" />
                </TagChip>
              ))}
            </div>
          ) : (
            <p className="skill-tag-editor-empty">{t("No tags yet")}</p>
          )}
        </section>
        <TextField
          ref={inputRef}
          autoComplete="off"
          disabled={atLimit}
          error={error || undefined}
          label={t("Add a tag")}
          maxLength={32}
          placeholder={t("Type a tag and press Enter")}
          value={input}
          onChange={(event) => {
            setInput(event.currentTarget.value);
            setError("");
          }}
          onKeyDown={handleInputKeyDown}
        />
        {suggestions.length > 0 || canCreate ? (
          <section className="skill-tag-suggestions" aria-label={t("Tag suggestions")}>
            <span className="skill-tag-suggestions__label">{t("Suggestions")}</span>
            <div className="skill-tag-suggestions__list">
              {suggestions.map((tag) => (
                <TagChip
                  className="skill-tag-suggestion"
                  key={skillTagKey(tag)}
                  title={tag}
                  onClick={() => addTag(tag)}
                >
                  {tag}
                </TagChip>
              ))}
              {canCreate ? (
                <TagChip
                  className="skill-tag-suggestion is-create"
                  onClick={() => addTag(normalizedInput!)}
                >
                  <Plus size={12} strokeWidth={2.2} aria-hidden="true" />
                  {t("Create {{tag}}", { tag: normalizedInput! })}
                </TagChip>
              ) : null}
            </div>
          </section>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" disabled={saving} onClick={onDismiss}>
          {t("Cancel")}
        </Button>
        <Button
          variant="primary"
          busy={saving}
          busyLabel={t("Saving...")}
          disabled={!dirty}
          onClick={() => void save()}
        >
          {t("Save")}
        </Button>
      </DialogFooter>
    </ModalFrame>
  );
};
