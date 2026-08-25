import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { AvailableProfileSkillGroup } from "../../shared/profileSkillGroups";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";
import { ResourcePickerOption } from "./ResourcePickerOption";
import { SearchField } from "./ui";

interface LibrarySkillGroupPickerProps {
  groups: AvailableProfileSkillGroup[];
  onChange(keys: string[]): void;
  selectedKeys: string[];
}

const groupKey = (group: AvailableProfileSkillGroup) => `${group.kind}:${group.groupId}`;

export const LibrarySkillGroupPicker = ({
  groups,
  onChange,
  selectedKeys
}: LibrarySkillGroupPickerProps) => {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const visibleGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return groups;
    return groups.filter((group) => [group.name, group.kind, ...group.memberIds]
      .some((value) => value.toLocaleLowerCase().includes(normalized)));
  }, [groups, query]);

  return (
    <div className="library-skill-group-picker">
      <SearchField
        fieldClassName="resource-picker-search"
        icon={<Search size={15} strokeWidth={2.2} />}
        label={t("Search Skill Groups")}
        placeholder={t("Search Groups...")}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="resource-picker-list" role="group" aria-label={t("Available Skill Groups")}>
        {visibleGroups.length === 0 ? (
          <div className="inline-state">{t("No Skill Groups available")}</div>
        ) : null}
        {visibleGroups.map((group) => {
          const key = groupKey(group);
          const selected = selectedKeys.includes(key);
          return (
            <ResourcePickerOption
              checked={selected}
              description={(
                <OverflowTooltip
                  className="resource-picker-option__description-text"
                  text={group.description || (group.kind === "source" ? t("Source Group") : t("Manual Group"))}
                />
              )}
              icon={(
                <ResourceIconArtwork
                  fallbackIconKey={group.kind === "source" ? "github" : "folder"}
                  iconKey={group.iconKey}
                  sourceUrl={group.sourceUrl}
                  size={17}
                />
              )}
              key={key}
              metadata={t("{{count}} Skills", { count: group.memberIds.length })}
              title={(
                <OverflowTooltip
                  className="resource-picker-option__title"
                  text={group.name}
                />
              )}
              onChange={() => onChange(selected
                ? selectedKeys.filter((item) => item !== key)
                : [...selectedKeys, key])}
            />
          );
        })}
      </div>
    </div>
  );
};
