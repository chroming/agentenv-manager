import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { SkillLibraryEntry } from "../../shared/types";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";
import { ChoiceInput, SearchField } from "./ui";

interface LibrarySkillPickerProps {
  emptyLabel?: string;
  excludedIds?: ReadonlySet<string>;
  onChange(ids: string[]): void;
  selectedIds: string[];
  selectionMode: "single" | "multiple";
  skills: SkillLibraryEntry[];
}

export const LibrarySkillPicker = ({
  emptyLabel,
  excludedIds,
  onChange,
  selectedIds,
  selectionMode,
  skills
}: LibrarySkillPickerProps) => {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const radioGroupName = useId();
  const visibleSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return skills.filter((skill) => {
      if (excludedIds?.has(skill.id)) return false;
      if (!normalizedQuery) return true;
      return [skill.name, skill.id, skill.description, skill.path, skill.source ?? ""]
        .some((field) => field.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [excludedIds, query, skills]);

  const toggle = (id: string) => {
    if (selectionMode === "single") {
      onChange([id]);
      return;
    }
    onChange(selectedIds.includes(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id]);
  };

  return (
    <div className="library-skill-picker">
      <SearchField
        fieldClassName="resource-picker-search"
        icon={<Search size={15} strokeWidth={2.2} />}
        label={t("Search library skills")}
        placeholder={t("Search skills...")}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div
        className="resource-picker-list"
        role={selectionMode === "single" ? "radiogroup" : "group"}
        aria-label={t("Library Skills")}
      >
        {visibleSkills.length === 0 ? (
          <div className="inline-state">{emptyLabel ?? t("No library skills available")}</div>
        ) : null}
        {visibleSkills.map((skill) => {
          const selected = selectedIds.includes(skill.id);
          return (
            <label
              className={`resource-picker-option${selected ? " is-selected" : ""}`}
              key={skill.id}
            >
              <ChoiceInput
                aria-label={skill.name}
                checked={selected}
                name={selectionMode === "single" ? radioGroupName : undefined}
                type={selectionMode === "single" ? "radio" : "checkbox"}
                onChange={() => toggle(skill.id)}
              />
              <span className="resource-picker-option__content">
                <span className="resource-picker-option__icon" aria-hidden="true">
                  <ResourceIconArtwork
                    fallbackIconKey={skill.sourceType === "github" || skill.sourceType === "git"
                      ? "github"
                      : "folder"}
                    iconKey={skill.iconKey}
                    sourceUrl={skill.sourceType === "github" || skill.sourceType === "git"
                      ? skill.source
                      : undefined}
                    size={17}
                  />
                </span>
                <span className="resource-picker-option__main">
                  <strong>{skill.name}</strong>
                  <OverflowTooltip
                    className="resource-picker-option__description"
                    text={skill.description || skill.id}
                  />
                  <OverflowTooltip
                    className="resource-picker-option__metadata"
                    text={`${skill.version ? `v${skill.version}` : skill.contentHash.slice(0, 7)} · ${skill.path}`}
                  />
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};
