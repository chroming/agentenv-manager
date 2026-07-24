import {
  Check,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  TriangleAlert
} from "lucide-react";
import {
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
import { targetIconFor } from "./ProfileSidebar";
import { OverflowTooltip } from "./OverflowTooltip";
import { Button, PageHeader } from "./ui";

let backgroundRefresh: Promise<ConversationRefreshResult> | undefined;
let backgroundRefreshCompletedAt = 0;

const refreshConversationIndex = (force: boolean) => {
  if (backgroundRefresh) return backgroundRefresh;
  if (!force && Date.now() - backgroundRefreshCompletedAt < 60_000) {
    return Promise.resolve(undefined);
  }
  backgroundRefresh = window.agentEnv.refreshConversations()
    .then((result) => {
      backgroundRefreshCompletedAt = Date.now();
      return result;
    })
    .finally(() => {
      backgroundRefresh = undefined;
    });
  return backgroundRefresh;
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

const TargetMenu = ({
  targets,
  disabled,
  onSelect
}: {
  targets: TargetInfo[];
  disabled: boolean;
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
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={buttonRef}
        className="conversation-continue-button"
        variant="primary"
        type="button"
        disabled={disabled || targets.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => open ? setOpen(false) : show()}
      >
        {t("Continue")}
        <ChevronDown size={14} aria-hidden="true" />
      </Button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="conversation-target-menu action-menu"
              role="menu"
              style={style}
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
  const { t, formatDate } = useI18n();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ConversationDetail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<ConversationContinuationPreview>();
  const reviewDialogRef = useRef<HTMLElement>(null);
  const reviewCancelRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef("");
  queryRef.current = query;

  useModalDialog({
    open: Boolean(review),
    dialogRef: reviewDialogRef,
    initialFocusRef: reviewCancelRef,
    onDismiss: () => setReview(undefined),
    dismissDisabled: busy,
    focusKey: review?.previewId
  });

  const loadList = async (nextQuery = queryRef.current) => {
    const result = await window.agentEnv.listConversations({
      query: nextQuery || undefined,
      limit: conversationPageSize
    });
    setItems(result.items);
    setTotal(result.total);
    setSelectedId((current) =>
      current && result.items.some((item) => item.id === current)
        ? current
        : result.items[0]?.id
    );
  };

  const loadMore = async () => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    setError("");
    try {
      const result = await window.agentEnv.listConversations({
        query: queryRef.current || undefined,
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
      const result = await refreshConversationIndex(!initial);
      await loadList();
      if (result && result.failures.length > 0) {
        setWarning([
          t("Some Agent histories could not be refreshed"),
          ...result.failures.map((failure) => {
            const name = targets.find((target) => target.id === failure.agentId)?.name ??
              failure.agentId;
            return `${name}: ${failure.message}`;
          })
        ].join("\n"));
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
    void window.agentEnv.listConversations({ limit: conversationPageSize })
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setTotal(result.total);
        setSelectedId(result.items[0]?.id);
      })
      .catch((unknownError) => {
        if (active) {
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        }
      })
      .finally(() => active && setLoading(false));
    void refresh(true);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadList(query).catch((unknownError) =>
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError))
      );
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    let active = true;
    setDetailLoading(true);
    void window.agentEnv.readConversation(selectedId)
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
  }, [selectedId]);

  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [message]);

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
  const sourceCanOpenOriginal = Boolean(
    detail &&
    targets.find((target) => target.id === detail.agentId)
      ?.conversationCapabilities.openOriginal.state === "available"
  );

  const executeContinuation = async (previewId: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await window.agentEnv.continueConversation(previewId);
      setReview(undefined);
      setMessage(result.message);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const chooseTarget = async (targetId: string) => {
    if (!detail) return;
    setBusy(true);
    setError("");
    let reviewAfterWork: ConversationContinuationPreview | undefined;
    try {
      const preview = await window.agentEnv.previewConversationContinuation({
        conversationId: detail.id,
        targetId
      });
      if (preview.requiresReview) reviewAfterWork = preview;
      else await executeContinuation(preview.previewId);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
    if (reviewAfterWork) setReview(reviewAfterWork);
  };

  const openOriginal = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.agentEnv.openOriginalConversation(detail.id);
      setMessage(result.message);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="conversation-page">
      <PageHeader
        className="conversation-page-header"
        title={t("Conversations")}
        description={t("Find local Agent history and continue it in another Agent.")}
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

      {error ? (
        <div className="conversation-feedback conversation-feedback--error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>{t("Dismiss")}</button>
        </div>
      ) : warning ? (
        <div className="conversation-feedback conversation-feedback--warning" role="status">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>{warning}</span>
          <button type="button" onClick={() => setWarning("")}>{t("Dismiss")}</button>
        </div>
      ) : message ? (
        <div className="conversation-feedback" role="status">
          <Check size={15} aria-hidden="true" />
          <span>{message}</span>
        </div>
      ) : null}

      <div className="conversation-layout">
        <aside className="conversation-list-pane" aria-label={t("Conversation list")}>
          <label className="conversation-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              placeholder={t("Search conversations…")}
              aria-label={t("Search conversations")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="conversation-list-meta">
            <span>{t("{{count}} conversations", { count: total })}</span>
            {refreshing ? <LoaderCircle className="is-spinning" size={14} aria-hidden="true" /> : null}
          </div>
          <div className="conversation-list" role="listbox" aria-busy={loading}>
            {loading ? (
              <div className="conversation-empty">
                <LoaderCircle className="is-spinning" size={19} aria-hidden="true" />
                <span>{t("Loading conversations")}</span>
              </div>
            ) : items.length === 0 ? (
              <div className="conversation-empty">
                <MessageSquareText size={20} aria-hidden="true" />
                <strong>{query ? t("No matching conversations") : t("No conversations indexed")}</strong>
                <span>{query ? t("Try another search.") : t("Refresh to scan enabled Agents.")}</span>
              </div>
            ) : items.map((item) => {
              const target = targets.find((candidate) => candidate.id === item.agentId);
              const icon = target ? targetIconFor(target) : undefined;
              return (
                <button
                  className={`conversation-list-item${selectedId === item.id ? " is-selected" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={selectedId === item.id}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className={`conversation-agent-icon conversation-agent-icon--${icon?.flavor ?? "generic"}`} aria-hidden="true">
                    {icon?.assetUrl
                      ? <img src={icon.assetUrl} alt="" />
                      : item.agentName.slice(0, 1)}
                  </span>
                  <span className="conversation-list-item__copy">
                    <OverflowTooltip
                      className="conversation-list-item__title"
                      text={item.title}
                    />
                    <OverflowTooltip
                      className="conversation-list-item__snippet"
                      text={item.snippet || t("No preview available")}
                    />
                    <small>
                      {item.agentName} · {formatDate(item.updatedAt)}
                    </small>
                  </span>
                </button>
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
                  <span>{detail.agentName}</span>
                  {detail.detailState === "summary-only"
                    ? <small>{t("Summary only")}</small>
                    : null}
                  <h3>{detail.title}</h3>
                  <p>
                    <Clock3 size={13} aria-hidden="true" />
                    {formatDate(detail.updatedAt)}
                    {detail.workspacePath ? ` · ${detail.workspacePath}` : ""}
                  </p>
                </div>
                <div className="conversation-detail-actions">
                  <Button
                    size="compact"
                    icon={<Copy size={14} />}
                    aria-label={t("Copy")}
                    disabled={busy}
                    onClick={() => void window.agentEnv.copyText(continuationText(detail)).then(
                      () => setMessage(t("Conversation copied"))
                    )}
                  >
                    <span>{t("Copy")}</span>
                  </Button>
                  {sourceCanOpenOriginal ? (
                    <Button
                      size="compact"
                      icon={<ExternalLink size={14} />}
                      aria-label={t("Open original")}
                      disabled={busy}
                      onClick={() => void openOriginal()}
                    >
                      <span>{t("Open original")}</span>
                    </Button>
                  ) : null}
                  <TargetMenu
                    targets={continueTargets}
                    disabled={busy || detail.detailState !== "full"}
                    onSelect={(targetId) => void chooseTarget(targetId)}
                  />
                </div>
              </header>
              {detail.detailState === "summary-only" ? (
                <div className="conversation-summary-only">
                  <TriangleAlert size={17} aria-hidden="true" />
                  <div>
                    <strong>{t("Full transcript is unavailable")}</strong>
                    <p>{t("This Agent currently exposes conversation metadata but not portable message text.")}</p>
                  </div>
                </div>
              ) : (
                <div className="conversation-transcript">
                  {detail.messages.map((entry) => (
                    <section className="conversation-message" key={entry.id}>
                      <div className={`conversation-message__role conversation-message__role--${entry.role}`}>
                        {entry.role === "user" ? t("You") : detail.agentName}
                      </div>
                      <div className="conversation-message__text">{entry.text}</div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </article>
      </div>

      {review ? (
        <div
          className="preview-modal-backdrop"
          onClick={busy ? undefined : () => setReview(undefined)}
        >
          <section
            ref={reviewDialogRef}
            className="profile-form-dialog profile-form-dialog--compact conversation-review-dialog ui-dialog-shell"
            role="dialog"
            aria-modal="true"
            aria-label={t("Review continuation")}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
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
          </section>
        </div>
      ) : null}
    </section>
  );
};
