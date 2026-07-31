import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft, LoaderCircle, Search } from "lucide-react";
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
  searchAdditionalItems?(query: string): Promise<QuickOpenItem[]>;
}

const QUICK_OPEN_LISTBOX_ID = "quick-open-results";
const QUICK_OPEN_ASYNC_DELAY_MS = 220;
const QUICK_OPEN_ASYNC_MINIMUM_QUERY_LENGTH = 2;
const quickOpenOptionId = (index: number) => `quick-open-option-${index}`;

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

export const QuickOpen = ({
  items,
  open,
  onDismiss,
  searchAdditionalItems
}: QuickOpenProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const asyncRequestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [additionalResults, setAdditionalResults] = useState<QuickOpenItem[]>([]);
  const [additionalStatus, setAdditionalStatus] = useState<
    "idle" | "searching" | "error"
  >("idle");
  const localResults = useMemo(() => findQuickOpenResults(items, query), [items, query]);
  const results = useMemo(() => {
    const seen = new Set(localResults.map((item) => item.id));
    return [
      ...localResults,
      ...additionalResults.filter((item) => !seen.has(item.id))
    ];
  }, [additionalResults, localResults]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setAdditionalResults([]);
    setAdditionalStatus("idle");
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
    const requestId = ++asyncRequestRef.current;
    setAdditionalResults([]);
    setAdditionalStatus("idle");
    const normalizedQuery = query.normalize("NFKC").trim();
    if (
      !open ||
      !searchAdditionalItems ||
      Array.from(normalizedQuery).length < QUICK_OPEN_ASYNC_MINIMUM_QUERY_LENGTH
    ) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      setAdditionalStatus("searching");
      void searchAdditionalItems(normalizedQuery)
        .then((next) => {
          if (requestId !== asyncRequestRef.current) return;
          setAdditionalResults(next);
          setAdditionalStatus("idle");
        })
        .catch(() => {
          if (requestId !== asyncRequestRef.current) return;
          setAdditionalResults([]);
          setAdditionalStatus("error");
        });
    }, QUICK_OPEN_ASYNC_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [open, query, searchAdditionalItems]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    if (!open || results.length === 0) return;
    document.getElementById(quickOpenOptionId(activeIndex))?.scrollIntoView?.({
      block: "nearest"
    });
  }, [activeIndex, open, results.length]);

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
          aria-label={t("Search Profiles, Skills, Agents, Conversations, and actions")}
          aria-activedescendant={results.length > 0 ? quickOpenOptionId(activeIndex) : undefined}
          aria-autocomplete="list"
          aria-controls={QUICK_OPEN_LISTBOX_ID}
          aria-expanded="true"
          placeholder={t("Search Profiles, Skills, Agents, Conversations, and actions...")}
          role="combobox"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(Math.max(0, results.length - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(results[Math.min(activeIndex, results.length - 1)]);
            }
          }}
        />
        <span
          className="quick-open-search__status"
          role="status"
          aria-label={
            additionalStatus === "searching"
              ? t("Searching conversations")
              : undefined
          }
        >
          {additionalStatus === "searching" ? (
            <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
          ) : null}
        </span>
        <kbd>esc</kbd>
      </div>
      <div
        className="quick-open-results"
        id={QUICK_OPEN_LISTBOX_ID}
        role="listbox"
        aria-label={t("Quick open results")}
        aria-busy={additionalStatus === "searching"}
      >
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
                  id={quickOpenOptionId(index)}
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
        ) : additionalStatus === "searching" ? (
          <div className="quick-open-empty">{t("Searching conversations…")}</div>
        ) : additionalStatus === "error" ? (
          <div className="quick-open-empty">{t("Conversation search unavailable")}</div>
        ) : (
          <div className="quick-open-empty">{t("No matching items")}</div>
        )}
        {results.length > 0 && additionalStatus === "error" ? (
          <div className="quick-open-async-note">
            {t("Conversation search unavailable")}
          </div>
        ) : null}
      </div>
      <footer className="quick-open-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> {t("Navigate")}</span>
        <span><kbd>↵</kbd> {t("Open")}</span>
      </footer>
    </ModalFrame>
  );
};
