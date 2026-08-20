import { FileText, Search } from "lucide-react";
import { useMemo } from "react";
import type { InstructionBlock } from "../../shared/types";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import { ChoiceInput, SearchField } from "./ui";

interface LibraryInstructionPickerProps {
  blocks: InstructionBlock[];
  excludedIds?: ReadonlySet<string>;
  query: string;
  selectedIds: string[];
  onQueryChange(query: string): void;
  onChange(ids: string[]): void;
}

export const LibraryInstructionPicker = ({
  blocks,
  excludedIds,
  query,
  selectedIds,
  onQueryChange,
  onChange
}: LibraryInstructionPickerProps) => {
  const { t } = useI18n();
  const visibleBlocks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return blocks.filter((block) => {
      if (excludedIds?.has(block.id)) return false;
      return !normalized || [block.name, block.description, block.content]
        .some((value) => value.toLocaleLowerCase().includes(normalized));
    });
  }, [blocks, excludedIds, query]);

  const toggle = (id: string) => onChange(
    selectedIds.includes(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id]
  );

  return (
    <div className="library-instruction-picker">
      <SearchField
        fieldClassName="resource-picker-search"
        icon={<Search size={15} strokeWidth={2.2} />}
        label={t("Search Instructions")}
        placeholder={t("Search Instruction Blocks...")}
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <div className="resource-picker-list" role="group" aria-label={t("Instruction Library") }>
        {visibleBlocks.length === 0 ? (
          <div className="inline-state">{t("No Instruction Blocks available")}</div>
        ) : null}
        {visibleBlocks.map((block) => {
          const selected = selectedIds.includes(block.id);
          return (
            <label className={`resource-picker-option${selected ? " is-selected" : ""}`} key={block.id}>
              <ChoiceInput
                aria-label={block.name}
                checked={selected}
                type="checkbox"
                onChange={() => toggle(block.id)}
              />
              <span className="resource-picker-option__content">
                <span className="resource-picker-option__icon" aria-hidden="true">
                  <FileText size={17} strokeWidth={2} />
                </span>
                <span className="resource-picker-option__main">
                  <strong>{block.name}</strong>
                  <OverflowTooltip
                    className="resource-picker-option__description"
                    text={block.description || block.content.split("\n").find(Boolean) || block.id}
                  />
                  <span className="resource-picker-option__metadata">
                    {t("Used by {{count}} Profiles", { count: block.usedByProfiles?.length ?? 0 })}
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};
