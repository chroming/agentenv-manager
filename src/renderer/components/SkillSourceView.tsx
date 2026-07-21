import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react";
import type {
  SkillSourceGroupCandidate,
  SkillSourceGroupView
} from "../../shared/types";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import { ResourceIconArtwork } from "./ResourceIconPicker";

interface SkillSourceViewProps {
  active: boolean;
  groups: SkillSourceGroupView[];
  loading: boolean;
  onCheckGroup(canonicalLink: string): Promise<void>;
  onCheckAll(): Promise<void>;
  onAdd(group: SkillSourceGroupView, candidate: SkillSourceGroupCandidate): Promise<boolean>;
  onUpdate(libraryId: string): void;
  onDelete(libraryId: string): void;
  onOpenSource(url: string): void;
  onCopySource(source: string): void;
}

const stateLabel = (state: SkillSourceGroupCandidate["state"]) => {
  if (state === "current") return "Current";
  if (state === "update") return "Update available";
  if (state === "new") return "New";
  if (state === "removed") return "Removed upstream";
  if (state === "invalid") return "Invalid upstream";
  if (state === "conflict") return "Relationship conflict";
  if (state === "missing") return "Library copy missing";
  return "Not checked";
};

const sourceIsOpenable = (source: string) => /^https?:\/\//i.test(source);

export const SkillSourceView = ({
  active,
  groups,
  loading,
  onCheckGroup,
  onCheckAll,
  onAdd,
  onUpdate,
  onDelete,
  onOpenSource,
  onCopySource
}: SkillSourceViewProps) => {
  const { formatDate, t } = useI18n();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [operation, setOperation] = useState<string>();
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleGroups = useMemo(() => {
    if (!normalizedSearch) return groups;
    return groups.filter((group) =>
      group.canonicalLink.toLocaleLowerCase().includes(normalizedSearch) ||
      group.candidates.some((candidate) =>
        candidate.name.toLocaleLowerCase().includes(normalizedSearch) ||
        candidate.libraryName?.toLocaleLowerCase().includes(normalizedSearch)
      )
    );
  }, [groups, normalizedSearch]);

  const runCheck = async (canonicalLink: string) => {
    setChecking((current) => new Set(current).add(canonicalLink));
    try {
      await onCheckGroup(canonicalLink);
    } finally {
      setChecking((current) => {
        const next = new Set(current);
        next.delete(canonicalLink);
        return next;
      });
    }
  };

  const runCheckAll = async () => {
    setCheckingAll(true);
    try {
      await onCheckAll();
    } finally {
      setCheckingAll(false);
    }
  };

  const runAdd = async (group: SkillSourceGroupView, candidate: SkillSourceGroupCandidate) => {
    const key = `${group.canonicalLink}\0${candidate.sourceSubpath}`;
    setOperation(key);
    try {
      await onAdd(group, candidate);
    } finally {
      setOperation(undefined);
    }
  };

  return (
    <section
      className={`skill-source-view${active ? "" : " is-inactive"}`}
      aria-label={t("Skills by source")}
      aria-hidden={!active}
    >
      <div className="skill-source-toolbar">
        <label className="library-search">
          <span>{t("Search")}</span>
          <Search size={16} strokeWidth={2.1} aria-hidden="true" />
          <input
            aria-label={t("Search sources and skills")}
            placeholder={t("Search source or skill...")}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <button
          className="secondary-action"
          type="button"
          disabled={checkingAll || checking.size > 0 || Boolean(operation) || groups.length === 0}
          onClick={() => void runCheckAll()}
        >
          {checkingAll ? (
            <LoaderCircle className="is-spinning" size={15} strokeWidth={2.2} />
          ) : (
            <RefreshCw size={15} strokeWidth={2.2} />
          )}
          <span>{t("Check all")}</span>
        </button>
      </div>

      <div className="skill-source-list">
        {loading && groups.length === 0 ? (
          <div className="inline-state inline-state--loading skill-source-empty" role="status">
            <span className="inline-state__icon" aria-hidden="true" />
            <span>{t("Loading sources")}</span>
          </div>
        ) : null}
        {!loading && groups.length === 0 ? (
          <div className="skill-source-empty">
            <strong>{t("No repository sources yet")}</strong>
            <span>{t("Import skills from a repository to group and check them here.")}</span>
          </div>
        ) : null}
        {groups.length > 0 && visibleGroups.length === 0 ? (
          <div className="skill-source-empty">
            <strong>{t("No sources match this search")}</strong>
          </div>
        ) : null}
        {visibleGroups.map((group) => {
          const isExpanded = expanded.has(group.canonicalLink);
          const isChecking = checking.has(group.canonicalLink);
          const hasAttention = group.counts.updates + group.counts.new + group.counts.removed > 0;
          return (
            <article
              className={`skill-source-group${isExpanded ? " is-expanded" : ""}${hasAttention ? " has-attention" : ""}`}
              key={group.canonicalLink}
            >
              <div className="skill-source-group-row">
                <button
                  className="skill-source-disclosure"
                  type="button"
                  aria-label={t(isExpanded ? "Collapse source" : "Expand source")}
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(group.canonicalLink)) next.delete(group.canonicalLink);
                    else next.add(group.canonicalLink);
                    return next;
                  })}
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <span className="skill-source-artwork" aria-hidden="true">
                  <ResourceIconArtwork
                    fallbackIconKey="github"
                    size={18}
                    sourceUrl={group.canonicalLink}
                  />
                </span>
                <div className="skill-source-identity">
                  <button
                    className="skill-source-link"
                    type="button"
                    onClick={() => sourceIsOpenable(group.canonicalLink)
                      ? onOpenSource(group.canonicalLink)
                      : onCopySource(group.canonicalLink)}
                  >
                    <OverflowTooltip
                      className="skill-source-link-text"
                      focusable={false}
                      text={group.canonicalLink}
                    />
                    {sourceIsOpenable(group.canonicalLink) ? (
                      <ExternalLink size={12} strokeWidth={2.2} />
                    ) : (
                      <Copy size={12} strokeWidth={2.2} />
                    )}
                  </button>
                  <span className="skill-source-checked">
                    {group.error
                      ? t("Last check failed")
                      : group.checkedAt
                        ? t("Checked {{date}}", { date: formatDate(group.checkedAt) })
                        : t("Not checked")}
                  </span>
                </div>
                <div className="skill-source-counts" aria-label={t("Source summary")}>
                  <span className="is-total"><strong>{group.counts.total}</strong>{t("Total")}</span>
                  <span className="is-update"><strong>{group.counts.updates}</strong>{t("Updates")}</span>
                  <span className="is-new"><strong>{group.counts.new}</strong>{t("New")}</span>
                  <span className="is-removed"><strong>{group.counts.removed}</strong>{t("Removed")}</span>
                </div>
                {group.error ? (
                  <OverflowTooltip
                    className="skill-source-error"
                    text={group.error}
                    displayText={t("Check failed")}
                  />
                ) : null}
                <button
                  className="secondary-action skill-source-check"
                  type="button"
                  disabled={isChecking || checkingAll || Boolean(operation)}
                  onClick={() => void runCheck(group.canonicalLink)}
                >
                  {isChecking ? (
                    <LoaderCircle className="is-spinning" size={14} strokeWidth={2.2} />
                  ) : (
                    <RefreshCw size={14} strokeWidth={2.2} />
                  )}
                  <span>{t(group.error ? "Retry" : "Check")}</span>
                </button>
              </div>

              {isExpanded ? (
                <div className="skill-source-candidates">
                  <div className="skill-source-candidate-head" aria-hidden="true">
                    <span>{t("Skill")}</span>
                    <span>{t("Upstream")}</span>
                    <span>{t("Library")}</span>
                    <span>{t("Status")}</span>
                    <span>{t("Action")}</span>
                  </div>
                  {group.candidates.map((candidate) => {
                    const key = `${group.canonicalLink}\0${candidate.sourceSubpath}`;
                    const isWorking = operation === key;
                    return (
                      <div
                        className={`skill-source-candidate is-${candidate.state}${candidate.globallyEnabled === false ? " is-disabled" : ""}`}
                        key={`${candidate.sourceSubpath}\0${candidate.libraryId ?? "remote"}`}
                      >
                        <div className="skill-source-candidate-name">
                          <strong>{candidate.name}</strong>
                          <OverflowTooltip
                            className="skill-source-candidate-path"
                            text={candidate.directory || group.directory || "."}
                          />
                        </div>
                        <div className="skill-source-candidate-meta">
                          <strong>{candidate.version ?? candidate.contentRevision?.slice(0, 7) ?? "—"}</strong>
                          <span>{candidate.upstreamUpdatedAt ? formatDate(candidate.upstreamUpdatedAt) : "—"}</span>
                        </div>
                        <div className="skill-source-candidate-meta">
                          <strong>{candidate.libraryName ?? t("Not in Library")}</strong>
                          <span>{candidate.libraryVersion ?? candidate.libraryId ?? "—"}</span>
                        </div>
                        <div className={`skill-source-state is-${candidate.state}`}>
                          {candidate.state === "current" ? (
                            <CheckCircle2 size={14} strokeWidth={2.2} />
                          ) : candidate.state === "invalid" || candidate.state === "conflict" ? (
                            <CircleAlert size={14} strokeWidth={2.2} />
                          ) : null}
                          <OverflowTooltip
                            className="skill-source-state-label"
                            displayText={t(stateLabel(candidate.state))}
                            text={candidate.detail ?? t(stateLabel(candidate.state))}
                          />
                        </div>
                        <div className="skill-source-candidate-action">
                          {candidate.state === "new" ? (
                            <button
                              className="text-action"
                              type="button"
                              disabled={Boolean(operation) || checkingAll || checking.size > 0}
                              onClick={() => void runAdd(group, candidate)}
                            >
                              {isWorking ? <LoaderCircle className="is-spinning" size={13} /> : null}
                              <span>{t("Add")}</span>
                            </button>
                          ) : candidate.state === "update" && candidate.libraryId ? (
                            <button
                              className="text-action"
                              type="button"
                              disabled={Boolean(operation) || checkingAll || checking.size > 0}
                              onClick={() => onUpdate(candidate.libraryId!)}
                            >
                              <span>{t("Review update")}</span>
                            </button>
                          ) : candidate.state === "removed" && candidate.libraryId ? (
                            <button
                              className="text-action text-action--danger"
                              type="button"
                              disabled={Boolean(operation) || checkingAll || checking.size > 0}
                              onClick={() => onDelete(candidate.libraryId!)}
                            >
                              <Trash2 size={13} strokeWidth={2.2} />
                              <span>{t("Delete")}</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
};
