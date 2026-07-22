import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { ModalFrame } from "./ui";

export interface QuickOpenItem {
  id: string;
  group: string;
  label: string;
  description?: string;
  keywords?: string[];
  icon: ReactNode;
  onSelect(): void | Promise<void>;
}

interface QuickOpenProps {
  items: QuickOpenItem[];
  open: boolean;
  onDismiss(): void;
}

const searchableText = (item: QuickOpenItem) =>
  [item.label, item.description, item.group, ...(item.keywords ?? [])]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase();

const resultScore = (item: QuickOpenItem, query: string) => {
  const label = item.label.normalize("NFKC").toLocaleLowerCase();
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.includes(query)) return 2;
  return 3;
};

export const findQuickOpenResults = (
  items: QuickOpenItem[],
  query: string
): QuickOpenItem[] => {
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
  if (!normalizedQuery) return items.slice(0, 24);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return items
    .filter((item) => {
      const text = searchableText(item);
      return tokens.every((token) => text.includes(token));
    })
    .sort((left, right) => resultScore(left, normalizedQuery) - resultScore(right, normalizedQuery))
    .slice(0, 40);
};

export const QuickOpen = ({ items, open, onDismiss }: QuickOpenProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => findQuickOpenResults(items, query), [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: inputRef,
    onDismiss
  });

  if (!open) return null;

  const choose = (item: QuickOpenItem | undefined) => {
    if (!item) return;
    onDismiss();
    void item.onSelect();
  };

  return (
    <ModalFrame
      ariaLabel={t("Quick open")}
      className="quick-open-dialog"
      dialogRef={dialogRef}
      onDismiss={onDismiss}
    >
      <div className="quick-open-search">
        <Search size={17} strokeWidth={2.2} aria-hidden="true" />
        <input
          ref={inputRef}
          aria-label={t("Search Profiles, Skills, Agents, and actions")}
          placeholder={t("Search Profiles, Skills, Agents, and actions...")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const currentResults = findQuickOpenResults(items, event.currentTarget.value);
              choose(currentResults[Math.min(activeIndex, currentResults.length - 1)]);
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div className="quick-open-results" role="listbox" aria-label={t("Quick open results")}>
        {results.length > 0 ? (
          results.map((item, index) => {
            const previousGroup = results[index - 1]?.group;
            return (
              <div className="quick-open-result-block" key={item.id}>
                {item.group !== previousGroup ? (
                  <div className="quick-open-group" aria-hidden="true">{item.group}</div>
                ) : null}
                <button
                  className={`quick-open-result${index === activeIndex ? " is-active" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => choose(item)}
                  onMouseMove={() => setActiveIndex(index)}
                >
                  <span className="quick-open-result__icon" aria-hidden="true">{item.icon}</span>
                  <span className="quick-open-result__copy">
                    <strong>{item.label}</strong>
                    {item.description ? <small>{item.description}</small> : null}
                  </span>
                  {index === activeIndex ? (
                    <CornerDownLeft size={14} strokeWidth={2.2} aria-hidden="true" />
                  ) : null}
                </button>
              </div>
            );
          })
        ) : (
          <div className="quick-open-empty">{t("No matching items")}</div>
        )}
      </div>
      <footer className="quick-open-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> {t("Navigate")}</span>
        <span><kbd>↵</kbd> {t("Open")}</span>
      </footer>
    </ModalFrame>
  );
};
