import { RotateCcw } from "lucide-react";
import { skillTagKey } from "../../../shared/skillTags";
import { useI18n } from "../../i18n";
import type { SkillLibraryViewState } from "../../libraryViewState";
import { Button, SelectControl } from "../ui";

interface SkillLibraryFiltersProps {
  availableTags: readonly string[];
  activeCount: number;
  sourceFilter: SkillLibraryViewState["sourceFilter"];
  tagFilter: SkillLibraryViewState["tagFilter"];
  targetFilter: SkillLibraryViewState["targetFilter"];
  usageFilter: SkillLibraryViewState["usageFilter"];
  onChange(patch: Partial<Omit<SkillLibraryViewState, "scrollTop">>): void;
  onReset(): void;
}

export function SkillLibraryFilters({
  availableTags,
  activeCount,
  sourceFilter,
  tagFilter,
  targetFilter,
  usageFilter,
  onChange,
  onReset
}: SkillLibraryFiltersProps) {
  const { t } = useI18n();

  return (
    <div className="library-filter-panel" role="group" aria-label={t("Skill filters")}>
      <label>
        <span>{t("Source")}</span>
        <SelectControl
          controlWidth="fill"
          aria-label={t("Skill source filter")}
          value={sourceFilter}
          onChange={(event) => onChange({
            sourceFilter: event.currentTarget.value as typeof sourceFilter
          })}
        >
          <option value="all">{t("All sources")}</option>
          <option value="online">{t("Online")}</option>
          <option value="local">{t("Local")}</option>
        </SelectControl>
      </label>
      <label>
        <span>{t("Usage")}</span>
        <SelectControl
          controlWidth="fill"
          aria-label={t("Skill usage filter")}
          value={usageFilter}
          onChange={(event) => onChange({
            usageFilter: event.currentTarget.value as typeof usageFilter
          })}
        >
          <option value="all">{t("All usage")}</option>
          <option value="referenced">{t("Referenced")}</option>
          <option value="unreferenced">{t("Unreferenced")}</option>
        </SelectControl>
      </label>
      <label>
        <span>{t("Tags")}</span>
        <SelectControl
          controlWidth="fill"
          aria-label={t("Skill tag filter")}
          value={tagFilter}
          onChange={(event) => onChange({ tagFilter: event.currentTarget.value })}
        >
          <option value="all">{t("All tags")}</option>
          {availableTags.map((tag) => (
            <option key={skillTagKey(tag)} value={tag}>{tag}</option>
          ))}
        </SelectControl>
      </label>
      <label>
        <span>{t("Agents")}</span>
        <SelectControl
          controlWidth="fill"
          aria-label={t("Skill Agent filter")}
          value={targetFilter}
          onChange={(event) => onChange({
            targetFilter: event.currentTarget.value as typeof targetFilter
          })}
        >
          <option value="all">{t("All Agents")}</option>
          <option value="managed">{t("Managed")}</option>
          <option value="library">{t("Imported")}</option>
          <option value="outside">{t("Unmanaged")}</option>
          <option value="left-unmanaged">{t("Left unmanaged")}</option>
          <option value="not-installed">{t("Not installed")}</option>
        </SelectControl>
      </label>
      <Button
        className="library-filter-reset"
        icon={<RotateCcw size={15} strokeWidth={2.2} />}
        disabled={activeCount === 0}
        onClick={onReset}
      >
        {t("Reset")}
      </Button>
    </div>
  );
}
