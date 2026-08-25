import type { AvailableProfileSkillGroup } from "../../shared/profileSkillGroups";
import type { SkillLibraryEntry } from "../../shared/types";
import { useI18n } from "../i18n";
import { LibrarySkillGroupPicker } from "./LibrarySkillGroupPicker";
import { LibrarySkillPicker } from "./LibrarySkillPicker";
import { SegmentedControl } from "./ui";

export type LibrarySkillSelectionMode = "skills" | "groups";

interface LibrarySkillSelectionProps {
  excludedSkillIds?: ReadonlySet<string>;
  groups: AvailableProfileSkillGroup[];
  mode: LibrarySkillSelectionMode;
  selectedGroupKeys: string[];
  selectedSkillIds: string[];
  skillSelectionMode?: "single" | "multiple";
  skills: SkillLibraryEntry[];
  showModeControl?: boolean;
  onModeChange(mode: LibrarySkillSelectionMode): void;
  onSelectedGroupKeysChange(keys: string[]): void;
  onSelectedSkillIdsChange(ids: string[]): void;
}

export const LibrarySkillSelection = ({
  excludedSkillIds,
  groups,
  mode,
  selectedGroupKeys,
  selectedSkillIds,
  skillSelectionMode = "multiple",
  skills,
  showModeControl = true,
  onModeChange,
  onSelectedGroupKeysChange,
  onSelectedSkillIdsChange
}: LibrarySkillSelectionProps) => {
  const { t } = useI18n();
  return (
    <div className="library-skill-selection">
      {showModeControl ? (
        <SegmentedControl
          label={t("Resource type")}
          className="profile-skill-picker-mode"
          options={[
            { value: "skills", label: t("Skills") },
            { value: "groups", label: t("Groups") }
          ]}
          value={mode}
          onChange={(value) => onModeChange(value as LibrarySkillSelectionMode)}
        />
      ) : null}
      {mode === "skills" || !showModeControl ? (
        <LibrarySkillPicker
          excludedIds={excludedSkillIds}
          onChange={onSelectedSkillIdsChange}
          selectedIds={selectedSkillIds}
          selectionMode={skillSelectionMode}
          skills={skills}
        />
      ) : (
        <LibrarySkillGroupPicker
          groups={groups}
          selectedKeys={selectedGroupKeys}
          onChange={onSelectedGroupKeysChange}
        />
      )}
    </div>
  );
};
