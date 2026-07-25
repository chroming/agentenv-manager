import {
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  TriangleAlert,
  UserRound
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { createPortal } from "react-dom";
import type {
  ConversationContinuationPreview,
  ConversationDetail,
  ConversationRefreshResult,
  ConversationSummary,
  TargetInfo
} from "../../shared/types";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { AppFeedback, type AppFeedbackMessage } from "./AppFeedback";
import { ConversationMarkdown } from "./ConversationMarkdown";
import { InfoTip } from "./InfoTip";
import { targetIconFor } from "./ProfileSidebar";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  Badge,
  Button,
  ControlGroup,
  focusInitialActionMenuItem,
  handleActionMenuKeyDown,
  IconButton,
  ModalFrame,
  PageHeader
} from "./ui";

let conversationRefreshOperation: Promise<ConversationRefreshResult> | undefined;
let emptyIndexRefreshAttempted = false;

const refreshConversationIndex = () => {
  if (conversationRefreshOperation) return conversationRefreshOperation;
  conversationRefreshOperation = window.agentEnv.refreshConversations()
    .finally(() => {
      conversationRefreshOperation = undefined;
    });
  return conversationRefreshOperation;
};

const continuationText = (detail: ConversationDetail) => [
  `# ${detail.title}`,
  "",
  ...detail.messages.flatMap((message) => [
    `## ${message.role === "user" ? "User" : "Assistant"}`,
    "",
    message.text,
    ""
  ])
].join("\n");

const conversationPageSize = 200;
const conversationMessagePageSize = 60;
type ConversationOperation = "copy" | "open-original" | "continue";

const workspaceName = (path?: string) => {
  const normalized = path?.replace(/[\\/]+$/, "");
  return normalized?.split(/[\\/]/).filter(Boolean).at(-1) ?? path ?? "";
};

const conversationDateGroup = (value: string) => {
  const date = new Date(value);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startToday - startDate) / 86_400_000);
  if (dayDifference <= 0) return "Today";
  if (dayDifference === 1) return "Yesterday";
  if (dayDifference < 7) return "Previous 7 days";
  return "Earlier";
};

const groupMessages = (messages: ConversationDetail["messages"]) =>
  messages.reduce<Array<{
    role: ConversationDetail["messages"][number]["role"];
    entries: ConversationDetail["messages"];
  }>>((groups, message) => {
    const previous = groups.at(-1);
    if (previous?.role === message.role) previous.entries.push(message);
    else groups.push({ role: message.role, entries: [message] });
    return groups;
  }, []);

const TargetMenu = ({
  targets,
  disabled,
  disabledReason,
  working,
  onSelect
}: {
  targets: TargetInfo[];
  disabled: boolean;
  disabledReason?: string;
  working: boolean;
  onSelect(targetId: string): void;
}) => {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();

  const show = () => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (bounds) {
      const width = 220;
      setStyle({
        width,
        left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
        top: bounds.bottom + 6
      });
    }
    setOpen(true);
    window.setTimeout(() => focusInitialActionMenuItem(menuRef.current));
  };

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !buttonRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const dismissForViewportChange = () => setOpen(false);
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismissForViewportChange);
    window.addEventListener("scroll", dismissForViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismissForViewportChange);
      window.removeEventListener("scroll", dismissForViewportChange, true);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={buttonRef}
        className="conversation-continue-button"
        variant="primary"
        type="button"
        disabled={disabled || working || targets.length === 0}
        title={disabledReason}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => open ? setOpen(false) : show()}
        icon={working ? <LoaderCircle className="is-spinning" size={14} /> : undefined}
      >
        {t(working ? "Preparing..." : "Continue")}
        {!working ? <ChevronDown size={14} aria-hidden="true" /> : null}
      </Button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="conversation-target-menu action-menu"
              role="menu"
              style={style}
              onKeyDown={handleActionMenuKeyDown}
            >
              <span className="conversation-target-menu__label">
                {t("Continue in")}
              </span>
              {targets.map((target) => {
                const icon = targetIconFor(target);
                return (
                  <button
                    type="button"
                    role="menuitem"
                    key={target.id}
                    onClick={() => {
                      setOpen(false);
                      onSelect(target.id);
                    }}
                  >
                    <span
                      className={`conversation-agent-icon conversation-agent-icon--${icon.flavor}`}
                      aria-hidden="true"
                    >
                      {icon.assetUrl
                        ? <img src={icon.assetUrl} alt="" />
                        : target.name.slice(0, 1)}
                    </span>
                    <span className="conversation-target-menu__copy">
                      <span>{target.name}</span>
                      {target.conversationCapabilities.continue.state === "degraded"
                        ? <small>{t("Paste required")}</small>
                        : null}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
};

export const ConversationWorkspace = ({ targets }: { targets: TargetInfo[] }) => {
  const { t, formatDate, localeTag } = useI18n();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [workspacePaths, setWorkspacePaths] = useState<string[]>([]);
  const [agentCounts, setAgentCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ConversationDetail>();
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailReloadNonce, setDetailReloadNonce] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [operation, setOperation] = useState<ConversationOperation>();
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<ConversationContinuationPreview>();
  const reviewDialogRef = useRef<HTMLElement>(null);
  const reviewCancelRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef("");
  const agentFilterRef = useRef("");
  const workspaceFilterRef = useRef("");
  const listRequestRef = useRef(0);
  const queryEffectReadyRef = useRef(false);
  queryRef.current = query;
  agentFilterRef.current = agentFilter;
  workspaceFilterRef.current = workspaceFilter;
  const busy = Boolean(operation);

  useModalDialog({
    open: Boolean(review),
    dialogRef: reviewDialogRef,
    initialFocusRef: reviewCancelRef,
    onDismiss: () => setReview(undefined),
    dismissDisabled: busy,
    focusKey: review?.previewId
  });

  const loadList = async (
    nextQuery = queryRef.current,
    nextAgentFilter = agentFilterRef.current,
    nextWorkspaceFilter = workspaceFilterRef.current,
    trackSearch = false
  ) => {
    const requestId = ++listRequestRef.current;
    try {
      const result = await window.agentEnv.listConversations({
        query: nextQuery || undefined,
        agentIds: nextAgentFilter ? [nextAgentFilter] : undefined,
        workspacePaths: nextWorkspaceFilter ? [nextWorkspaceFilter] : undefined,
        limit: conversationPageSize
      });
      if (requestId !== listRequestRef.current) return undefined;
      setItems(result.items);
      setTotal(result.total);
      if (result.workspacePaths) setWorkspacePaths(result.workspacePaths);
      if (result.agentCounts) setAgentCounts(result.agentCounts);
      setSelectedId((current) =>
        current && result.items.some((item) => item.id === current)
          ? current
          : result.items[0]?.id
      );
      return result;
    } finally {
      if (trackSearch && requestId === listRequestRef.current) setSearching(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    setError("");
    try {
      const result = await window.agentEnv.listConversations({
        query: queryRef.current || undefined,
        agentIds: agentFilterRef.current ? [agentFilterRef.current] : undefined,
        workspacePaths: workspaceFilterRef.current
          ? [workspaceFilterRef.current]
          : undefined,
        offset: items.length,
        limit: conversationPageSize
      });
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setTotal(result.total);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setLoadingMore(false);
    }
  };

  const refresh = async (initial = false) => {
    setRefreshing(true);
    setError("");
    setWarning("");
    try {
      const result = await refreshConversationIndex();
      await loadList();
      setDetailReloadNonce((current) => current + 1);
      if (result.failures.length > 0) {
        setWarning(result.failures.map((failure) => {
          const name = targets.find((target) => target.id === failure.agentId)?.name ??
            failure.agentId;
          return `${name}: ${failure.message}`;
        }).join("\n"));
      } else if (!initial) {
        setMessage(t("Conversations refreshed"));
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      let result;
      try {
        result = await loadList("");
      } catch (unknownError) {
        if (active) {
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        }
      } finally {
        if (active) setLoading(false);
      }
      if (active && result?.total === 0 && !emptyIndexRefreshAttempted) {
        emptyIndexRefreshAttempted = true;
        void refresh(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!queryEffectReadyRef.current) {
      queryEffectReadyRef.current = true;
      return undefined;
    }
    listRequestRef.current += 1;
    setSearching(false);
    const timeout = window.setTimeout(() => {
      setSearching(true);
      void loadList(query, agentFilter, workspaceFilter, true)
        .catch((unknownError) => {
          setSearching(false);
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [agentFilter, query, workspaceFilter]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setLoadingEarlier(false);
    void window.agentEnv.readConversation(selectedId, {
      limit: conversationMessagePageSize,
      tail: true
    })
      .then((next) => active && setDetail(next))
      .catch((unknownError) => {
        if (active) {
          setDetail(undefined);
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        }
      })
      .finally(() => active && setDetailLoading(false));
    return () => {
      active = false;
    };
  }, [detailReloadNonce, selectedId]);

  const loadEarlierMessages = async () => {
    if (!detail || loadingEarlier || !detail.loadedMessageOffset) return;
    const nextOffset = Math.max(0, detail.loadedMessageOffset - conversationMessagePageSize);
    const limit = detail.loadedMessageOffset - nextOffset;
    setLoadingEarlier(true);
    setError("");
    try {
      const earlier = await window.agentEnv.readConversation(detail.id, {
        offset: nextOffset,
        limit
      });
      setDetail((current) => {
        if (!current || current.id !== earlier.id) return current;
        const existing = new Set(current.messages.map((entry) => entry.id));
        return {
          ...current,
          loadedMessageOffset: earlier.loadedMessageOffset,
          messages: [
            ...earlier.messages.filter((entry) => !existing.has(entry.id)),
            ...current.messages
          ]
        };
      });
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setLoadingEarlier(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const command = isMac ? event.metaKey : event.ctrlKey;
      if (!command || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "f" && key !== "r") return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      if (key === "f") {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (!refreshing) {
        void refresh();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [refreshing]);

  const continueTargets = useMemo(
    () => targets.filter(
      (target) =>
        (target.conversationCapabilities.continue.state === "available" ||
          target.conversationCapabilities.continue.state === "degraded") &&
        target.id !== detail?.agentId
    ),
    [detail?.agentId, targets]
  );
  const detailTarget = useMemo(
    () => targets.find((target) => target.id === detail?.agentId),
    [detail?.agentId, targets]
  );
  const detailIcon = detail
    ? targetIconFor(detailTarget ?? {
        id: detail.agentId,
        name: detail.agentName
      })
    : undefined;
  const messageGroups = useMemo(
    () => groupMessages(detail?.messages ?? []),
    [detail?.messages]
  );
  const filterTargets = useMemo(
    () => targets.filter((target) =>
      items.some((item) => item.agentId === target.id) ||
      target.conversationCapabilities.history.state !== "unavailable"),
    [items, targets]
  );
  const formatListTime = (value: string) => {
    const date = new Date(value);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return new Intl.DateTimeFormat(localeTag, {
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
    }
    return new Intl.DateTimeFormat(localeTag, {
      month: "short",
      day: "numeric"
    }).format(date);
  };
  const formatDetailTime = (value: string) => {
    const date = new Date(value);
    const group = conversationDateGroup(value);
    const time = new Intl.DateTimeFormat(localeTag, {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
    if (group === "Today" || group === "Yesterday") {
      return `${t(group)} · ${time}`;
    }
    const day = new Intl.DateTimeFormat(localeTag, {
      year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
    return `${day} · ${time}`;
  };
  const sourceCanOpenOriginal = Boolean(
    detail &&
    targets.find((target) => target.id === detail.agentId)
      ?.conversationCapabilities.openOriginal.state === "available"
  );

  const executeContinuation = async (previewId: string) => {
    setOperation("continue");
    setError("");
    try {
      const result = await window.agentEnv.continueConversation(previewId);
      setReview(undefined);
      setMessage(result.message);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const chooseTarget = async (targetId: string) => {
    if (!detail) return;
    setOperation("continue");
    setError("");
    let reviewAfterWork: ConversationContinuationPreview | undefined;
    try {
      const preview = await window.agentEnv.previewConversationContinuation({
        conversationId: detail.id,
        targetId
      });
      if (preview.requiresReview) reviewAfterWork = preview;
      else {
        const result = await window.agentEnv.continueConversation(preview.previewId);
        setMessage(result.message);
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
    if (reviewAfterWork) setReview(reviewAfterWork);
  };

  const openOriginal = async () => {
    if (!detail) return;
    setOperation("open-original");
    setError("");
    try {
      const result = await window.agentEnv.openOriginalConversation(detail.id);
      setMessage(result.message);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const copyConversation = async () => {
    if (!detail) return;
    setOperation("copy");
    setError("");
    try {
      const completeDetail = detail.messages.length < detail.messageCount
        ? await window.agentEnv.readConversation(detail.id)
        : detail;
      await window.agentEnv.copyText(continuationText(completeDetail));
      setMessage(t("Conversation copied"));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setOperation(undefined);
    }
  };

  const feedback: AppFeedbackMessage | undefined = error
    ? { kind: "error", title: t("Could not complete this step"), message: error }
    : warning
      ? {
          kind: "warning",
          title: t("Some Agent histories could not be refreshed"),
          message: warning
        }
      : message
        ? { kind: "success", title: message }
        : undefined;

  return (
    <>
      <section className="conversation-page">
        <PageHeader
          className="conversation-page-header"
          title={t("Conversations")}
          help={
            <InfoTip
              label={t("Find local Agent history and continue it in another Agent.")}
            />
          }
          actions={
            <Button
              icon={
                <RefreshCw
                  className={refreshing ? "is-spinning" : undefined}
                  size={15}
                />
              }
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {t("Refresh")}
            </Button>
          }
        />

        <div className="conversation-layout-shell">
          <div
            className="conversation-layout ui-surface-frame"
            inert={refreshing}
            aria-hidden={refreshing || undefined}
          >
          <aside className="conversation-list-pane" aria-label={t("Conversation list")}>
            <div className="conversation-list-toolbar">
              <label className="conversation-search ui-composite-field">
                {searching
                  ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
                  : <Search size={15} aria-hidden="true" />}
                <input
                  ref={searchInputRef}
                  type="search"
                  value={query}
                  placeholder={t("Search conversations…")}
                  aria-label={t("Search conversations")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="conversation-filters" aria-label={t("Conversation filters")}>
                <label>
                  <span className="ui-visually-hidden">{t("Agent")}</span>
                  <select
                    aria-label={t("Filter by Agent")}
                    value={agentFilter}
                    onChange={(event) => setAgentFilter(event.target.value)}
                  >
                    <option value="">{t("All Agents")}</option>
                    {filterTargets.map((target) => (
                      <option value={target.id} key={target.id}>
                        {target.name} ({agentCounts[target.id] ?? 0})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="ui-visually-hidden">{t("Workspace")}</span>
                  <select
                    aria-label={t("Filter by workspace")}
                    value={workspaceFilter}
                    onChange={(event) => setWorkspaceFilter(event.target.value)}
                  >
                    <option value="">{t("All workspaces")}</option>
                    {workspacePaths.map((path) => (
                      <option value={path} key={path}>{workspaceName(path)}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="conversation-list-meta">
              <span>{t("{{count}} conversations", { count: total })}</span>
            </div>
            <div
              className="conversation-list"
              role="listbox"
              aria-busy={loading || searching}
            >
              {loading ? (
                <div className="conversation-empty">
                  <LoaderCircle className="is-spinning" size={19} aria-hidden="true" />
                  <span>{t("Loading conversations")}</span>
                </div>
              ) : items.length === 0 ? (
                <div className="conversation-empty">
                  <MessageSquareText size={20} aria-hidden="true" />
                  <strong>
                    {agentFilter && !query && !workspaceFilter
                      ? t("No conversations found for {{name}}", {
                          name: targets.find((target) => target.id === agentFilter)?.name ??
                            agentFilter
                        })
                      : query || agentFilter || workspaceFilter
                      ? t("No matching conversations")
                      : t("No conversations indexed")}
                  </strong>
                  <span>
                    {agentFilter && !query && !workspaceFilter
                      ? t("No supported local history was found for this Agent.")
                      : query || agentFilter || workspaceFilter
                      ? t("Try another search.")
                      : t("Refresh to scan enabled Agents.")}
                  </span>
                </div>
              ) : items.map((item, index) => {
                const target = targets.find((candidate) => candidate.id === item.agentId);
                const icon = targetIconFor(target ?? {
                  id: item.agentId,
                  name: item.agentName
                });
                const dateGroup = conversationDateGroup(item.updatedAt);
                const previousDateGroup = index > 0
                  ? conversationDateGroup(items[index - 1].updatedAt)
                  : undefined;
                const searchPreview = item.matchSnippet ||
                  item.snippet ||
                  t("No preview available");
                const showSearchPreview = Boolean(
                  query &&
                  searchPreview.replace(/\s+/g, " ").trim().toLowerCase() !==
                    item.title.replace(/\s+/g, " ").trim().toLowerCase()
                );
                return (
                  <Fragment key={item.id}>
                    {dateGroup !== previousDateGroup ? (
                      <div className="conversation-date-group" role="presentation">
                        {t(dateGroup)}
                      </div>
                    ) : null}
                    <button
                      className={[
                        "conversation-list-item",
                        selectedId === item.id ? "is-selected" : "",
                        showSearchPreview ? "has-search-preview" : ""
                      ].filter(Boolean).join(" ")}
                      type="button"
                      role="option"
                      aria-selected={selectedId === item.id}
                      id={`conversation-option-${index}`}
                      onClick={() => setSelectedId(item.id)}
                      onKeyDown={(event) => {
                        let nextIndex: number | undefined;
                        if (event.key === "ArrowDown") {
                          nextIndex = Math.min(index + 1, items.length - 1);
                        } else if (event.key === "ArrowUp") {
                          nextIndex = Math.max(index - 1, 0);
                        } else if (event.key === "Home") {
                          nextIndex = 0;
                        } else if (event.key === "End") {
                          nextIndex = items.length - 1;
                        }
                        if (nextIndex === undefined || nextIndex === index) return;
                        event.preventDefault();
                        setSelectedId(items[nextIndex]?.id);
                        document.getElementById(`conversation-option-${nextIndex}`)?.focus();
                      }}
                    >
                      <span className="conversation-list-item__copy">
                        <OverflowTooltip
                          className="conversation-list-item__title"
                          text={item.title}
                        />
                        {showSearchPreview ? (
                          <OverflowTooltip
                            className="conversation-list-item__snippet"
                            text={searchPreview}
                          />
                        ) : null}
                        <small>
                          <span className="conversation-list-item__agent">
                            <span
                              className={`conversation-agent-icon conversation-agent-icon--${icon.flavor}`}
                              aria-hidden="true"
                            >
                              {icon.assetUrl
                                ? <img src={icon.assetUrl} alt="" />
                                : item.agentName.slice(0, 1)}
                            </span>
                            {item.agentName}
                          </span>
                          {item.workspacePath ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span title={item.workspacePath}>
                                {workspaceName(item.workspacePath)}
                              </span>
                            </>
                          ) : null}
                          <span aria-hidden="true">·</span>
                          <time dateTime={item.updatedAt}>{formatListTime(item.updatedAt)}</time>
                        </small>
                      </span>
                    </button>
                  </Fragment>
                );
              })}
            </div>
            {items.length < total ? (
              <div className="conversation-list-footer">
                <Button
                  size="compact"
                  disabled={loadingMore}
                  icon={loadingMore
                    ? <LoaderCircle className="is-spinning" size={14} />
                    : undefined}
                  onClick={() => void loadMore()}
                >
                  {t(loadingMore ? "Loading more" : "Load more")}
                </Button>
              </div>
            ) : null}
          </aside>

          <article className="conversation-detail" aria-busy={detailLoading}>
            {detailLoading ? (
              <div className="conversation-empty conversation-empty--detail">
                <LoaderCircle className="is-spinning" size={20} aria-hidden="true" />
                <span>{t("Loading conversation")}</span>
              </div>
            ) : !detail ? (
              <div className="conversation-empty conversation-empty--detail">
                <MessageSquareText size={22} aria-hidden="true" />
                <strong>{t("Select a conversation")}</strong>
              </div>
            ) : (
              <>
                <header className="conversation-detail-header">
                  <div className="conversation-detail-title">
                    <span
                      className={`conversation-agent-icon conversation-agent-icon--${detailIcon?.flavor ?? "generic"}`}
                      aria-hidden="true"
                    >
                      {detailIcon?.assetUrl
                        ? <img src={detailIcon.assetUrl} alt="" />
                        : detail.agentName.slice(0, 1)}
                    </span>
                    <div className="conversation-detail-title__copy">
                      <h3>
                        <OverflowTooltip
                          className="conversation-detail-heading"
                          text={detail.title}
                        />
                      </h3>
                      <div className="conversation-detail-metadata">
                        <span>{detail.agentName}</span>
                        {detail.workspacePath ? (
                          <span title={detail.workspacePath}>
                            <FolderOpen size={12} aria-hidden="true" />
                            {workspaceName(detail.workspacePath)}
                          </span>
                        ) : null}
                        <span>
                          <Clock3 size={12} aria-hidden="true" />
                          <time
                            dateTime={detail.updatedAt}
                            title={formatDate(detail.updatedAt)}
                          >
                            {formatDetailTime(detail.updatedAt)}
                          </time>
                        </span>
                        {detail.archived ? <Badge>{t("Archived")}</Badge> : null}
                        {detail.detailState === "summary-only"
                          ? <Badge tone="warning">{t("Summary only")}</Badge>
                          : null}
                      </div>
                    </div>
                  </div>
                  <ControlGroup className="conversation-detail-actions">
                    <IconButton
                      label={t("Copy conversation")}
                      disabled={busy}
                      onClick={() => void copyConversation()}
                    >
                      {operation === "copy"
                        ? <LoaderCircle className="is-spinning" size={14} />
                        : <Copy size={14} />}
                    </IconButton>
                    {sourceCanOpenOriginal ? (
                      <IconButton
                        label={t("Open original")}
                        disabled={busy}
                        onClick={() => void openOriginal()}
                      >
                        {operation === "open-original"
                          ? <LoaderCircle className="is-spinning" size={14} />
                          : <ExternalLink size={14} />}
                      </IconButton>
                    ) : null}
                    <TargetMenu
                      targets={continueTargets}
                      disabled={detail.detailState !== "full"}
                      disabledReason={
                        detail.detailState !== "full"
                          ? t("Full transcript is unavailable")
                          : continueTargets.length === 0
                            ? t("No other Agent can continue this conversation")
                            : undefined
                      }
                      working={operation === "continue"}
                      onSelect={(targetId) => void chooseTarget(targetId)}
                    />
                  </ControlGroup>
                </header>
                {detail.detailState === "summary-only" ? (
                  <div className="conversation-summary-view">
                    <div className="conversation-summary-only inline-state">
                      <TriangleAlert size={17} aria-hidden="true" />
                      <div>
                        <strong>{t("Full transcript is unavailable")}</strong>
                        <p>{t("This Agent currently exposes conversation metadata but not portable message text.")}</p>
                      </div>
                    </div>
                    {detail.snippet ? (
                      <section className="conversation-summary-preview">
                        <span>{t("Conversation summary")}</span>
                        <ConversationMarkdown
                          text={detail.snippet}
                          onOpenExternal={(href) => {
                            void window.agentEnv.openExternalUrl(href).catch(
                              (unknownError) => setError(
                                unknownError instanceof Error
                                  ? unknownError.message
                                  : String(unknownError)
                              )
                            );
                          }}
                        />
                      </section>
                    ) : null}
                  </div>
                ) : (
                  <div className="conversation-transcript">
                    <div className="conversation-transcript__inner">
                      {detail.loadedMessageOffset ? (
                        <div className="conversation-transcript__history">
                          <Button
                            size="compact"
                            disabled={loadingEarlier}
                            icon={loadingEarlier
                              ? <LoaderCircle className="is-spinning" size={14} />
                              : undefined}
                            onClick={() => void loadEarlierMessages()}
                          >
                            {t(loadingEarlier ? "Loading earlier messages" : "Load earlier messages")}
                          </Button>
                          <span>
                            {t("{{count}} earlier messages", {
                              count: detail.loadedMessageOffset
                            })}
                          </span>
                        </div>
                      ) : null}
                      {messageGroups.map((group) => (
                        <section
                          className={`conversation-turn conversation-turn--${group.role}`}
                          key={group.entries[0].id}
                        >
                          <header className="conversation-turn__header">
                            {group.role === "user" ? (
                              <span className="conversation-turn__avatar conversation-turn__avatar--user">
                                <UserRound size={14} aria-hidden="true" />
                              </span>
                            ) : (
                              <span
                                className={`conversation-turn__avatar conversation-agent-icon--${detailIcon?.flavor ?? "generic"}`}
                                aria-hidden="true"
                              >
                                {detailIcon?.assetUrl
                                  ? <img src={detailIcon.assetUrl} alt="" />
                                  : detail.agentName.slice(0, 1)}
                              </span>
                            )}
                            <strong>
                              {group.role === "user" ? t("You") : detail.agentName}
                            </strong>
                            {group.entries[0].createdAt ? (
                              <time dateTime={group.entries[0].createdAt}>
                                {formatListTime(group.entries[0].createdAt)}
                              </time>
                            ) : null}
                          </header>
                          <div className="conversation-turn__messages">
                            {group.entries.map((entry) => (
                              <ConversationMarkdown
                                text={entry.text}
                                key={entry.id}
                                onOpenExternal={(href) => {
                                  void window.agentEnv.openExternalUrl(href).catch(
                                    (unknownError) => setError(
                                      unknownError instanceof Error
                                        ? unknownError.message
                                        : String(unknownError)
                                    )
                                  );
                                }}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </article>
          </div>
          {refreshing ? (
            <div className="conversation-refresh-overlay" role="status" aria-live="polite">
              <LoaderCircle className="is-spinning" size={22} aria-hidden="true" />
              <strong>{t("Refreshing conversations")}</strong>
              <span>{t("Scanning enabled Agents and updating the local index.")}</span>
            </div>
          ) : null}
        </div>

        {review ? (
          <ModalFrame
            ariaLabel={t("Review continuation")}
            className="profile-form-dialog--compact conversation-review-dialog ui-dialog-shell"
            dialogRef={reviewDialogRef}
            dismissDisabled={busy}
            onDismiss={() => setReview(undefined)}
          >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">
                  {t("Continue in {{name}}", { name: review.targetName })}
                </div>
                <p className="muted ui-dialog-description">
                  {t("Review what needs attention before opening the new conversation.")}
                </p>
              </div>
            </header>
            <div className="conversation-review-body ui-dialog-body">
              {review.warnings.map((warning) => (
                <div className="conversation-review-warning" key={warning}>
                  <TriangleAlert size={15} aria-hidden="true" />
                  <span>{warning}</span>
                </div>
              ))}
              <p>
                {t("{{portable}} of {{total}} visible messages will be transferred.", {
                  portable: review.portableMessageCount,
                  total: review.totalMessageCount
                })}
              </p>
            </div>
            <footer className="preview-actions ui-dialog-footer">
              <Button
                ref={reviewCancelRef}
                disabled={busy}
                onClick={() => setReview(undefined)}
              >
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                icon={busy ? <LoaderCircle className="is-spinning" size={14} /> : undefined}
                disabled={busy}
                onClick={() => void executeContinuation(review.previewId)}
              >
                {t("Continue")}
              </Button>
            </footer>
          </ModalFrame>
        ) : null}
      </section>
      <AppFeedback
        feedback={feedback}
        onDismiss={() => {
          setError("");
          setWarning("");
          setMessage("");
        }}
      />
    </>
  );
};
