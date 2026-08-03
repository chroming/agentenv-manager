import {
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  TriangleAlert,
  UserRound
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { createPortal } from "react-dom";
import { ProductIcon } from "../productIcons";
import type {
  ConversationContinuationPreview,
  ConversationDetail,
  ConversationListResult,
  ConversationRefreshResult,
  ConversationSummary,
  TargetInfo
} from "../../shared/types";
import type { FreshnessReason } from "../freshness";
import { useFreshnessCoordinator } from "../hooks/useFreshnessCoordinator";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { AppFeedback, type AppFeedbackMessage } from "./AppFeedback";
import { ConversationMarkdown } from "./ConversationMarkdown";
import { FreshnessStatus } from "./FreshnessStatus";
import { InfoTip } from "./InfoTip";
import { targetIconFor } from "./ProfileSidebar";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  ActionMenu,
  Badge,
  Button,
  ControlGroup,
  focusInitialActionMenuItem,
  IconButton,
  ModalFrame,
  PageHeader
} from "./ui";

let conversationRefreshOperation: Promise<ConversationRefreshResult> | undefined;
let conversationListPrefetch: Promise<ConversationListResult> | undefined;

export const preloadConversationList = () => {
  conversationListPrefetch ??= window.agentEnv.listConversations({
    limit: conversationPageSize
  }).catch((error) => {
    conversationListPrefetch = undefined;
    throw error;
  });
  return conversationListPrefetch;
};

export const invalidateConversationListPrefetch = () => {
  conversationListPrefetch = undefined;
};

export const refreshConversationIndex = () => {
  if (conversationRefreshOperation) return conversationRefreshOperation;
  conversationRefreshOperation = window.agentEnv.refreshConversations()
    .finally(() => {
      conversationRefreshOperation = undefined;
    });
  return conversationRefreshOperation;
};

export const refreshConversationIndexInBackground = async () => {
  const result = await refreshConversationIndex();
  invalidateConversationListPrefetch();
  return result;
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
const conversationListEndThreshold = 56;
type ConversationOperation = "copy" | "open-original" | "continue";

const workspaceName = (path?: string) => {
  const normalized = path?.replace(/[\\/]+$/, "");
  return normalized?.split(/[\\/]/).filter(Boolean).at(-1) ?? path ?? "";
};

const formatConversationSize = (sizeBytes: number) => {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
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
  sourceAgentId,
  disabled,
  disabledReason,
  busy,
  onSelect
}: {
  targets: TargetInfo[];
  sourceAgentId: string;
  disabled: boolean;
  disabledReason?: string;
  busy: boolean;
  onSelect(targetId: string): Promise<boolean>;
}) => {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();
  const [pendingTargetId, setPendingTargetId] = useState<string>();

  const positionMenu = () => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = 292;
    const estimatedHeight = Math.min(320, 43 + targets.length * 44);
    const fitsBelow = bounds.bottom + 6 + estimatedHeight <= window.innerHeight - 12;
    setStyle({
      width,
      left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
      top: fitsBelow
        ? bounds.bottom + 6
        : Math.max(12, bounds.top - estimatedHeight - 6)
    });
  };

  const show = () => {
    positionMenu();
    setOpen(true);
    window.setTimeout(() => focusInitialActionMenuItem(menuRef.current));
  };

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: MouseEvent) => {
      if (pendingTargetId) return;
      if (
        event.target instanceof Node &&
        !buttonRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingTargetId) {
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
  }, [open, pendingTargetId]);

  const selectTarget = async (targetId: string) => {
    setPendingTargetId(targetId);
    const completed = await onSelect(targetId);
    setPendingTargetId(undefined);
    if (completed) {
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <>
      <Button
        ref={buttonRef}
        className="conversation-continue-button"
        variant="primary"
        type="button"
        disabled={disabled || busy || targets.length === 0}
        title={disabledReason}
        aria-label={disabledReason
          ? `${t("Continue")}. ${disabledReason}`
          : t("Continue")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => open ? setOpen(false) : show()}
        icon={pendingTargetId
          ? <LoaderCircle className="is-spinning" size={14} />
          : undefined}
      >
        {t("Continue")}
        <ChevronDown size={14} aria-hidden="true" />
      </Button>
      {open
        ? createPortal(
            <ActionMenu
              ariaLabel={t("Continue in")}
              menuRef={menuRef}
              className="conversation-target-menu"
              aria-busy={Boolean(pendingTargetId)}
              style={style}
            >
              <span className="conversation-target-menu__label" id={labelId}>
                {t("Continue in")}
              </span>
              {targets.map((target) => {
                const isOriginal = target.id === sourceAgentId;
                const icon = targetIconFor(target);
                const delivery = target.conversationCapabilities.continue.delivery ??
                  (target.conversationCapabilities.continue.state === "degraded"
                    ? "clipboard"
                    : "context-file");
                const requiresPaste = !isOriginal && delivery === "clipboard";
                const methodLabel = isOriginal
                  ? "Open original"
                  : requiresPaste
                    ? "Copy and paste"
                    : "Continue automatically";
                return (
                  <button
                    type="button"
                    role="menuitem"
                    key={target.id}
                    disabled={Boolean(pendingTargetId)}
                    aria-label={`${target.name}, ${t(methodLabel)}`}
                    title={`${target.name} — ${t(isOriginal
                      ? "Resume the original conversation in this Agent."
                      : requiresPaste
                        ? "Context will be copied. Paste it into the new conversation."
                        : "The Agent will open with a private context file. A fallback copy is also ready.")}`}
                    onClick={() => void selectTarget(target.id)}
                  >
                    <span className="conversation-target-menu__row">
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
                      </span>
                      <span
                        className={[
                          "conversation-target-menu__mode",
                          requiresPaste ? "is-degraded" : ""
                        ].filter(Boolean).join(" ")}
                      >
                        {pendingTargetId === target.id
                          ? <LoaderCircle className="is-spinning" size={13} />
                          : t(methodLabel)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </ActionMenu>,
            document.body
          )
        : null}
    </>
  );
};

const ConversationActionsMenu = ({
  busy,
  operation,
  canOpenOriginal,
  onCopy,
  onOpenOriginal
}: {
  busy: boolean;
  operation?: ConversationOperation;
  canOpenOriginal: boolean;
  onCopy(): Promise<void>;
  onOpenOriginal(): Promise<void>;
}) => {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();

  const show = () => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (bounds) {
      const width = 210;
      const height = canOpenOriginal ? 86 : 45;
      const fitsBelow = bounds.bottom + 6 + height <= window.innerHeight - 12;
      setStyle({
        width,
        left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
        top: fitsBelow ? bounds.bottom + 6 : Math.max(12, bounds.top - height - 6)
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
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
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

  const run = (action: () => Promise<void>) => {
    setOpen(false);
    buttonRef.current?.focus();
    void action();
  };

  return (
    <>
      <IconButton
        ref={buttonRef}
        className="conversation-detail-more-button"
        label={t("Conversation actions")}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => open ? setOpen(false) : show()}
      >
        {operation === "copy" || operation === "open-original"
          ? <LoaderCircle className="is-spinning" size={14} />
          : <MoreHorizontal size={15} />}
      </IconButton>
      {open ? createPortal(
        <ActionMenu
          ariaLabel={t("Conversation actions")}
          menuRef={menuRef}
          className="conversation-detail-overflow-menu"
          style={style}
        >
          <button type="button" role="menuitem" onClick={() => run(onCopy)}>
            <Copy size={15} aria-hidden="true" />
            <span>{t("Copy conversation")}</span>
          </button>
          {canOpenOriginal ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onOpenOriginal)}
            >
              <ExternalLink size={15} aria-hidden="true" />
              <span>{t("Open original")}</span>
            </button>
          ) : null}
        </ActionMenu>,
        document.body
      ) : null}
    </>
  );
};

export interface ConversationWorkspaceViewState {
  items: ConversationSummary[];
  total: number;
  query: string;
  agentFilter: string;
  workspaceFilter: string;
  workspacePaths: string[];
  agentCounts: Record<string, number>;
  selectedId?: string;
  detail?: ConversationDetail;
  lastRefreshedAt?: string;
  scrollTop: number;
}

export interface ConversationOpenRequest {
  requestId: number;
  query: string;
  summary: ConversationSummary;
}

export const ConversationWorkspace = ({
  targets,
  initialViewState,
  onViewStateChange,
  openRequest,
  onOpenRequestHandled
}: {
  targets: TargetInfo[];
  initialViewState?: ConversationWorkspaceViewState;
  onViewStateChange?(state: ConversationWorkspaceViewState): void;
  openRequest?: ConversationOpenRequest;
  onOpenRequestHandled?(requestId: number): void;
}) => {
  const { t, formatDate, localeTag } = useI18n();
  const [items, setItems] = useState<ConversationSummary[]>(
    () => initialViewState?.items ?? []
  );
  const [total, setTotal] = useState(() => initialViewState?.total ?? 0);
  const [query, setQuery] = useState(() => initialViewState?.query ?? "");
  const [agentFilter, setAgentFilter] = useState(
    () => initialViewState?.agentFilter ?? ""
  );
  const [workspaceFilter, setWorkspaceFilter] = useState(
    () => initialViewState?.workspaceFilter ?? ""
  );
  const [workspacePaths, setWorkspacePaths] = useState<string[]>(
    () => initialViewState?.workspacePaths ?? []
  );
  const [agentCounts, setAgentCounts] = useState<Record<string, number>>(
    () => initialViewState?.agentCounts ?? {}
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => initialViewState?.selectedId
  );
  const [detail, setDetail] = useState<ConversationDetail | undefined>(
    () => initialViewState?.detail
  );
  const [loading, setLoading] = useState(!initialViewState);
  const [searching, setSearching] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailReloadNonce, setDetailReloadNonce] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [conversationListAtEnd, setConversationListAtEnd] = useState(false);
  const [operation, setOperation] = useState<ConversationOperation>();
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<ConversationContinuationPreview>();
  const {
    states: freshnessStates,
    statesRef: freshnessStatesRef,
    markFresh,
    run: runFreshness
  } = useFreshnessCoordinator();
  const [lastRefreshedAt, setLastRefreshedAt] = useState(
    () => initialViewState?.lastRefreshedAt
  );
  const reviewDialogRef = useRef<HTMLElement>(null);
  const reviewCancelRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const conversationListRef = useRef<HTMLDivElement>(null);
  const conversationTranscriptRef = useRef<HTMLDivElement>(null);
  const selectedSearchFocusRef = useRef<{
    conversationId: string;
    query: string;
  } | undefined>(undefined);
  const queryRef = useRef("");
  const agentFilterRef = useRef("");
  const workspaceFilterRef = useRef("");
  const listRequestRef = useRef(0);
  const refreshRef = useRef<
    (reason?: Extract<FreshnessReason, "page-entry" | "focus" | "manual">, force?: boolean) =>
      Promise<void>
  >(async () => undefined);
  const queryEffectReadyRef = useRef(false);
  const skipNextQueryEffectRef = useRef(false);
  const handledOpenRequestRef = useRef<number | undefined>(undefined);
  const scrollTopRef = useRef(initialViewState?.scrollTop ?? 0);
  const restoredScrollRef = useRef(false);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const viewStateRef = useRef<ConversationWorkspaceViewState>({
    items,
    total,
    query,
    agentFilter,
    workspaceFilter,
    workspacePaths,
    agentCounts,
    selectedId,
    detail,
    lastRefreshedAt,
    scrollTop: scrollTopRef.current
  });
  onViewStateChangeRef.current = onViewStateChange;
  queryRef.current = query;
  agentFilterRef.current = agentFilter;
  workspaceFilterRef.current = workspaceFilter;
  viewStateRef.current = {
    items,
    total,
    query,
    agentFilter,
    workspaceFilter,
    workspacePaths,
    agentCounts,
    selectedId,
    detail,
    lastRefreshedAt,
    scrollTop: scrollTopRef.current
  };
  const busy = Boolean(operation);
  const refreshBusy =
    manualRefreshing || freshnessStates.conversations.status === "refreshing";
  const nextConversationPageCount = Math.min(
    conversationPageSize,
    Math.max(0, total - items.length)
  );
  const updateConversationListEnd = () => {
    const list = conversationListRef.current;
    if (!list) return;
    scrollTopRef.current = list.scrollTop;
    viewStateRef.current.scrollTop = list.scrollTop;
    const distanceFromEnd = list.scrollHeight - list.scrollTop - list.clientHeight;
    setConversationListAtEnd(distanceFromEnd <= conversationListEndThreshold);
  };
  const selectConversation = (conversationId: string) => {
    const activeQuery = queryRef.current.trim();
    selectedSearchFocusRef.current = activeQuery
      ? { conversationId, query: activeQuery }
      : undefined;
    if (selectedId === conversationId) {
      setDetailReloadNonce((current) => current + 1);
    } else {
      setSelectedId(conversationId);
    }
  };

  useLayoutEffect(() => {
    if (!restoredScrollRef.current && conversationListRef.current) {
      restoredScrollRef.current = true;
      const list = conversationListRef.current;
      list.scrollTop = Math.min(
        scrollTopRef.current,
        Math.max(0, list.scrollHeight - list.clientHeight)
      );
    }
    updateConversationListEnd();
  }, [items.length, query, agentFilter, workspaceFilter]);

  useEffect(() => () => {
    onViewStateChangeRef.current?.(viewStateRef.current);
  }, []);

  useEffect(() => {
    const list = conversationListRef.current;
    if (!list) return undefined;
    const handleResize = () => updateConversationListEnd();
    window.addEventListener("resize", handleResize);
    const observer = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(handleResize);
    observer?.observe(list);
    return () => {
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, []);

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
    trackSearch = false,
    limit = conversationPageSize,
    preferredSummary?: ConversationSummary,
    preferPrefetchedList = false
  ) => {
    const requestId = ++listRequestRef.current;
    try {
      const result = preferPrefetchedList &&
        !nextQuery &&
        !nextAgentFilter &&
        !nextWorkspaceFilter &&
        limit === conversationPageSize
        ? await preloadConversationList()
        : await window.agentEnv.listConversations({
            query: nextQuery || undefined,
            agentIds: nextAgentFilter ? [nextAgentFilter] : undefined,
            workspacePaths: nextWorkspaceFilter ? [nextWorkspaceFilter] : undefined,
            limit
          });
      if (requestId !== listRequestRef.current) return undefined;
      const nextItems = preferredSummary &&
        !result.items.some((item) => item.id === preferredSummary.id)
        ? [preferredSummary, ...result.items]
        : result.items;
      setItems(nextItems);
      setTotal(Math.max(result.total, nextItems.length));
      if (result.workspacePaths) setWorkspacePaths(result.workspacePaths);
      if (result.agentCounts) setAgentCounts(result.agentCounts);
      if (result.lastRefreshedAt) {
        const refreshedAt = Date.parse(result.lastRefreshedAt);
        if (Number.isFinite(refreshedAt)) {
          setLastRefreshedAt(result.lastRefreshedAt);
          markFresh("conversations", { at: refreshedAt });
        }
      }
      setSelectedId((current) =>
        preferredSummary
          ? preferredSummary.id
          : current && result.items.some((item) => item.id === current)
          ? current
          : nextItems[0]?.id
      );
      return result;
    } finally {
      if (trackSearch && requestId === listRequestRef.current) setSearching(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || items.length >= total) return;
    const requestId = ++listRequestRef.current;
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
      if (requestId !== listRequestRef.current) return;
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

  const refresh = async (
    reason: Extract<FreshnessReason, "page-entry" | "focus" | "manual"> = "manual",
    force = reason === "manual"
  ) => {
    const announce = reason === "manual";
    if (announce) {
      setManualRefreshing(true);
      setError("");
      setWarning("");
    }
    try {
      const outcome = await runFreshness(
        "conversations",
        reason,
        refreshConversationIndex,
        {
          force,
          partialError: (value) => {
            const result = value as ConversationRefreshResult;
            return result.failures.length > 0
              ? t("{{count}} Agent history refreshes failed", {
                  count: result.failures.length
                })
              : undefined;
          }
        }
      );
      const result = outcome.value;
      if (!result) return;
      invalidateConversationListPrefetch();
      await loadList();
      setError("");
      setDetailReloadNonce((current) => current + 1);
      if (result.failures.length > 0) {
        if (announce) {
          setWarning(result.failures.map((failure) => {
            const name = targets.find((target) => target.id === failure.agentId)?.name ??
              failure.agentId;
            return `${name}: ${failure.message}`;
          }).join("\n"));
        }
      } else if (announce) {
        setMessage(t("Conversations refreshed"));
      }
    } catch (unknownError) {
      if (announce) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    } finally {
      if (announce) setManualRefreshing(false);
    }
  };
  refreshRef.current = refresh;

  useEffect(() => {
    let active = true;
    void (async () => {
      let result;
      try {
        result = await loadList(
          queryRef.current,
          agentFilterRef.current,
          workspaceFilterRef.current,
          false,
          Math.min(500, Math.max(conversationPageSize, initialViewState?.items.length ?? 0)),
          undefined,
          !initialViewState
        );
      } catch (unknownError) {
        if (active) {
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        }
      } finally {
        if (active) setLoading(false);
      }
      if (active && result) {
        void refresh(
          "page-entry",
          Boolean(result.refreshRequired || result.total === 0)
        );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !openRequest ||
      handledOpenRequestRef.current === openRequest.requestId
    ) {
      return;
    }
    handledOpenRequestRef.current = openRequest.requestId;
    const nextQuery = openRequest.query.trim();
    skipNextQueryEffectRef.current =
      queryRef.current !== nextQuery ||
      Boolean(agentFilterRef.current) ||
      Boolean(workspaceFilterRef.current);
    queryRef.current = nextQuery;
    agentFilterRef.current = "";
    workspaceFilterRef.current = "";
    setQuery(nextQuery);
    setAgentFilter("");
    setWorkspaceFilter("");
    setError("");
    setWarning("");
    setDetail((current) =>
      current?.id === openRequest.summary.id ? current : undefined
    );
    selectedSearchFocusRef.current = nextQuery
      ? { conversationId: openRequest.summary.id, query: nextQuery }
      : undefined;
    if (selectedId === openRequest.summary.id) {
      setDetailReloadNonce((current) => current + 1);
    }
    setSelectedId(openRequest.summary.id);
    setItems([openRequest.summary]);
    setTotal(1);
    scrollTopRef.current = 0;
    if (conversationListRef.current) conversationListRef.current.scrollTop = 0;
    setSearching(true);
    void loadList(
      nextQuery,
      "",
      "",
      true,
      conversationPageSize,
      openRequest.summary
    ).catch((unknownError) => {
      setSearching(false);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    });
    onOpenRequestHandled?.(openRequest.requestId);
  }, [openRequest?.requestId]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshRef.current("focus");
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  useEffect(() => {
    if (!queryEffectReadyRef.current) {
      queryEffectReadyRef.current = true;
      return undefined;
    }
    if (skipNextQueryEffectRef.current) {
      skipNextQueryEffectRef.current = false;
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
    const searchFocus = selectedSearchFocusRef.current?.conversationId === selectedId
      ? selectedSearchFocusRef.current
      : undefined;
    void window.agentEnv.readConversation(selectedId, {
      limit: conversationMessagePageSize,
      tail: true,
      ...(searchFocus ? { query: searchFocus.query } : {})
    })
      .then((next) => active && setDetail(next))
      .catch((unknownError) => {
        if (active) {
          setDetail(undefined);
          const nextError = unknownError instanceof Error
            ? unknownError.message
            : String(unknownError);
          const indexIsRefreshing =
            freshnessStatesRef.current.conversations.status === "refreshing";
          if (
            !indexIsRefreshing ||
            !nextError.includes("no longer available in the local index")
          ) {
            setError(nextError);
          }
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
      const isMac = window.agentEnv.platform === "darwin";
      const command = isMac ? event.metaKey : event.ctrlKey;
      if (!command || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "f" && key !== "r") return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      if (key === "f") {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (!refreshBusy) {
        void refresh();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [refreshBusy]);

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
  const continuationDestinations = useMemo(() => {
    const portableTargets = detail?.detailState === "full" ? continueTargets : [];
    const originalTarget = detailTarget?.conversationCapabilities.openOriginal.state === "available"
      ? detailTarget
      : undefined;
    return originalTarget ? [originalTarget, ...portableTargets] : portableTargets;
  }, [continueTargets, detail?.detailState, detailTarget]);
  const detailIcon = detail
    ? targetIconFor(detailTarget ?? {
        id: detail.agentId,
        name: detail.agentName
      })
    : undefined;
  const reviewTarget = review
    ? targets.find((target) => target.id === review.targetId)
    : undefined;
  const reviewTargetIcon = reviewTarget ? targetIconFor(reviewTarget) : undefined;
  const reviewModeLabel = review?.mode === "clipboard"
    ? t("Copy and paste")
    : review
      ? t("Context file")
      : "";
  const reviewActionLabel = review?.mode === "clipboard"
    ? t("Copy and open {{name}}", { name: review.targetName })
    : review
      ? t("Open {{name}}", { name: review.targetName })
      : "";
  const messageGroups = useMemo(
    () => groupMessages(detail?.messages ?? []),
    [detail?.messages]
  );
  useLayoutEffect(() => {
    const matchedMessageId = detail?.matchedMessageId;
    if (!query.trim() || !matchedMessageId) return;
    const matchedMessage = Array.from(
      conversationTranscriptRef.current?.querySelectorAll<HTMLElement>(
        "[data-conversation-message-id]"
      ) ?? []
    ).find((element) => element.dataset.conversationMessageId === matchedMessageId);
    if (!matchedMessage) return;
    const frame = window.requestAnimationFrame(() => {
      matchedMessage.scrollIntoView({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail?.id, detail?.matchedMessageId, query]);
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

  const chooseTarget = async (targetId: string): Promise<boolean> => {
    if (!detail) return false;
    if (targetId === detail.agentId) return openOriginal();
    setOperation("continue");
    setError("");
    try {
      const preview = await window.agentEnv.previewConversationContinuation({
        conversationId: detail.id,
        targetId
      });
      if (preview.requiresReview) setReview(preview);
      else {
        const result = await window.agentEnv.continueConversation(preview.previewId);
        setMessage(result.message);
      }
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    } finally {
      setOperation(undefined);
    }
  };

  const openOriginal = async (): Promise<boolean> => {
    if (!detail) return false;
    setOperation("open-original");
    setError("");
    try {
      const result = await window.agentEnv.openOriginalConversation(detail.id);
      setMessage(result.message);
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
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
            <ControlGroup className="conversation-page-actions">
              <FreshnessStatus
                state={freshnessStates.conversations}
                verb="Indexed"
              />
              <Button
                icon={
                  <RefreshCw
                    className={refreshBusy ? "is-spinning" : undefined}
                    size={15}
                  />
                }
                disabled={refreshBusy}
                onClick={() => void refresh()}
              >
                {t("Refresh")}
              </Button>
            </ControlGroup>
          }
        />

        <div className="conversation-layout-shell">
          <div
            className="conversation-layout ui-surface-frame"
            inert={manualRefreshing}
            aria-hidden={manualRefreshing || undefined}
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
                  placeholder={t("Search indexed history…")}
                  aria-label={t("Search conversations")}
                  title={t("Searches all indexed conversations and message text.")}
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
              <span>
                {items.length < total
                  ? t("{{loaded}} of {{total}} conversations", {
                      loaded: items.length,
                      total
                    })
                  : t("{{count}} conversations", { count: total })}
              </span>
            </div>
            <div
              className="conversation-list"
              ref={conversationListRef}
              role="listbox"
              aria-busy={loading || searching}
              onScroll={updateConversationListEnd}
            >
              {loading ? (
                <div className="conversation-empty">
                  <LoaderCircle className="is-spinning" size={19} aria-hidden="true" />
                  <span>{t("Loading conversations")}</span>
                </div>
              ) : items.length === 0 ? (
                <div className="conversation-empty">
                  <ProductIcon name="conversations" size={20} />
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
                const normalizedQuery = query.replace(/\s+/g, " ").trim().toLowerCase();
                const normalizedPreview = searchPreview
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
                const showSearchPreview = Boolean(
                  normalizedQuery &&
                  normalizedPreview.includes(normalizedQuery) &&
                  normalizedPreview !==
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
                      onClick={() => selectConversation(item.id)}
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
                        const nextId = items[nextIndex]?.id;
                        if (nextId) selectConversation(nextId);
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
                              <OverflowTooltip
                                className="conversation-list-item__workspace"
                                displayText={workspaceName(item.workspacePath)}
                                text={item.workspacePath}
                              />
                            </>
                          ) : null}
                          <span aria-hidden="true">·</span>
                          <time dateTime={item.updatedAt}>{formatListTime(item.updatedAt)}</time>
                          {item.sizeBytes !== undefined ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="conversation-list-item__size">
                                {formatConversationSize(item.sizeBytes)}
                              </span>
                            </>
                          ) : null}
                        </small>
                      </span>
                    </button>
                  </Fragment>
                );
              })}
              {items.length < total && (conversationListAtEnd || loadingMore) ? (
                <div className="conversation-list-footer">
                  <Button
                    size="compact"
                    disabled={loadingMore}
                    icon={loadingMore
                      ? <LoaderCircle className="is-spinning" size={14} />
                      : undefined}
                    onClick={() => void loadMore()}
                  >
                    {t(
                      loadingMore ? "Loading {{count}} more" : "Load {{count}} more",
                      { count: nextConversationPageCount }
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          </aside>

          <article className="conversation-detail" aria-busy={detailLoading}>
            {detailLoading && !detail ? (
              <div className="conversation-empty conversation-empty--detail">
                <LoaderCircle className="is-spinning" size={20} aria-hidden="true" />
                <span>{t("Loading conversation")}</span>
              </div>
            ) : !detail ? (
              <div className="conversation-empty conversation-empty--detail">
                <ProductIcon name="conversations" size={22} />
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
                        <span className="conversation-detail-metadata__agent">
                          {detail.agentName}
                        </span>
                        {detail.workspacePath ? (
                          <span
                            className="conversation-detail-metadata__workspace"
                            title={detail.workspacePath}
                          >
                            <FolderOpen size={12} aria-hidden="true" />
                            {workspaceName(detail.workspacePath)}
                          </span>
                        ) : null}
                        <span className="conversation-detail-metadata__time">
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
                    <span className="conversation-detail-secondary-actions">
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
                    </span>
                    <ConversationActionsMenu
                      busy={busy}
                      operation={operation}
                      canOpenOriginal={sourceCanOpenOriginal}
                      onCopy={copyConversation}
                      onOpenOriginal={async () => {
                        await openOriginal();
                      }}
                    />
                    <TargetMenu
                      targets={continuationDestinations}
                      sourceAgentId={detail.agentId}
                      disabled={continuationDestinations.length === 0}
                      disabledReason={
                        continuationDestinations.length === 0
                          ? detail.detailState !== "full"
                            ? t("Full transcript is unavailable")
                            : t("No Agent can continue this conversation")
                          : undefined
                      }
                      busy={busy}
                      onSelect={chooseTarget}
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
                  <div className="conversation-transcript" ref={conversationTranscriptRef}>
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
                              <div
                                className={`conversation-message${
                                  query.trim() && detail.matchedMessageId === entry.id
                                    ? " is-search-match"
                                    : ""
                                }`}
                                data-conversation-message-id={entry.id}
                                data-testid={`conversation-message-${entry.id}`}
                                key={entry.id}
                              >
                                <ConversationMarkdown
                                  text={entry.text}
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
                              </div>
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
          {manualRefreshing ? (
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
                    {t("Review how this conversation will be transferred.")}
                  </p>
                </div>
              </header>
            <div className="conversation-review-body ui-dialog-body">
              <div className="conversation-review-destination">
                <span
                  className={`conversation-agent-icon conversation-agent-icon--${reviewTargetIcon?.flavor ?? "generic"}`}
                  aria-hidden="true"
                >
                  {reviewTargetIcon?.assetUrl
                    ? <img src={reviewTargetIcon.assetUrl} alt="" />
                    : review.targetName.slice(0, 1)}
                </span>
                <span className="conversation-review-destination__copy">
                  <strong>{review.targetName}</strong>
                  <small>{reviewModeLabel}</small>
                </span>
                <span className="conversation-review-count">
                  {t("{{portable}} of {{total}} messages", {
                    portable: review.portableMessageCount,
                    total: review.totalMessageCount
                  })}
                </span>
              </div>
              {review.workspacePath ? (
                <div className="conversation-review-workspace">
                  <FolderOpen size={16} aria-hidden="true" />
                  <span>
                    <small>{t("Working directory")}</small>
                    <OverflowTooltip
                      className="conversation-review-workspace__path"
                      text={review.workspacePath}
                    />
                  </span>
                  <Badge tone={review.workspacePreservation === "preserved" ? "success" : "warning"}>
                    {review.workspacePreservation === "preserved"
                      ? t("Preserved")
                      : t("Best effort")}
                  </Badge>
                </div>
              ) : null}
              {review.warnings.length > 0 ? (
                <div className="conversation-review-warning">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <div>
                    <strong>{t("Needs attention")}</strong>
                    <ul>
                      {review.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
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
                {busy
                  ? t("Opening…")
                  : reviewActionLabel}
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
