import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";
import {
  LoaderCircle,
  Monitor,
  Search,
} from "lucide-react";
import type {
  ProfileSummary,
  ResourceIconKey,
  TargetDescriptor,
  TargetHealthStatus,
  TargetInfo
} from "../../shared/types";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";
import { handleActionMenuKeyDown } from "./ui";
import { ProductIcon, type ProductIconName } from "../productIcons";

const appIconUrl = new URL("../assets/app-icon.png", import.meta.url).href;
const antigravityIconUrl = new URL("../assets/target-icons/antigravity.png", import.meta.url).href;
const claudeIconUrl = new URL("../assets/target-icons/claude.svg", import.meta.url).href;
const openAiIconUrl = new URL("../assets/target-icons/openai.svg", import.meta.url).href;
const openCodeIconUrl = new URL("../assets/target-icons/opencode.svg", import.meta.url).href;
const piIconUrl = new URL("../assets/target-icons/pi.svg", import.meta.url).href;
const traeIconUrl = new URL("../assets/target-icons/trae.png", import.meta.url).href;

export const supportedAgentIconOptions: ReadonlyArray<{
  key: ResourceIconKey;
  label: string;
  assetUrl: string;
}> = [
  { key: "opencode", label: "OpenCode", assetUrl: openCodeIconUrl },
  { key: "codex", label: "Codex CLI", assetUrl: openAiIconUrl },
  { key: "claude", label: "Claude Code", assetUrl: claudeIconUrl },
  { key: "antigravity", label: "Antigravity CLI", assetUrl: antigravityIconUrl },
  { key: "trae", label: "Trae CLI", assetUrl: traeIconUrl },
  { key: "pi", label: "Pi", assetUrl: piIconUrl }
];

const agentIconUrlByKey = new Map(
  supportedAgentIconOptions.map((option) => [option.key, option.assetUrl])
);

export const agentIconUrlFor = (iconKey: ResourceIconKey) =>
  agentIconUrlByKey.get(iconKey);

export type AppWorkspace =
  | "library"
  | "instructions"
  | "projects"
  | "profiles"
  | "conversations"
  | "targets"
  | "settings";

export const appShellClassName = (
  activeWorkspace: AppWorkspace,
  collapsed: boolean,
  fullScreen = false
) =>
  `app-shell${activeWorkspace === "targets" ? "" : ` app-shell--${activeWorkspace}`}${
    collapsed ? " app-shell--sidebar-collapsed" : ""
  }${fullScreen ? " app-shell--full-screen" : ""}`;

interface ProfileSidebarProps {
  targets: TargetInfo[];
  profiles: ProfileSummary[];
  activeWorkspace: AppWorkspace;
  isLoading: boolean;
  collapsed: boolean;
  onWorkspaceSelect(workspace: AppWorkspace): void;
  onAgentSelect(targetId: string): void;
  onOpenAgents(): void;
  onQuickOpen(): void;
}

type TargetIconFlavor =
  | "opencode"
  | "codex"
  | "claude"
  | "antigravity"
  | "trae"
  | "pi"
  | "generic";

const targetInitials = (target: Pick<TargetDescriptor, "id" | "name">) => {
  const source = target.name || target.id;
  const words = source.split(/[\s-_]+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

  return initials || "A";
};

export const targetIconFor = (
  target: Pick<TargetDescriptor, "id" | "name"> &
    Partial<Pick<TargetDescriptor, "iconKey">>
): { flavor: TargetIconFlavor; assetUrl?: string } => {
  const iconKey = target.iconKey ?? ({
    opencode: "opencode",
    codex: "codex",
    "claude-code": "claude",
    antigravity: "antigravity",
    "antigravity-app": "antigravity",
    "trae-cli": "trae",
    pi: "pi"
  } as Record<string, string>)[target.id];
  if (iconKey === "opencode") {
    return { flavor: "opencode", assetUrl: openCodeIconUrl };
  }
  if (iconKey === "claude") {
    return { flavor: "claude", assetUrl: claudeIconUrl };
  }
  if (iconKey === "codex") {
    return { flavor: "codex", assetUrl: openAiIconUrl };
  }
  if (iconKey === "antigravity") {
    return { flavor: "antigravity", assetUrl: antigravityIconUrl };
  }
  if (iconKey === "trae") {
    return { flavor: "trae", assetUrl: traeIconUrl };
  }
  if (iconKey === "pi") {
    return { flavor: "pi", assetUrl: piIconUrl };
  }

  return { flavor: "generic" };
};

const targetStatusMessage = (status: TargetHealthStatus) =>
  ({
    ready: "Ready",
    "needs-setup": "Needs setup",
    missing: "Missing",
    guarded: "Guarded",
    unknown: "Check failed"
  } satisfies Record<TargetHealthStatus, string>)[status];

const AgentOverflowPopover = ({
  targets,
  onAgentSelect,
  onOpenAgents,
  statusSummary,
  summaryState,
  variant = "overflow"
}: {
  targets: TargetInfo[];
  onAgentSelect(targetId: string): void;
  onOpenAgents?(): void;
  statusSummary?: string;
  summaryState?: "attention" | "empty" | "loading" | "ready";
  variant?: "overflow" | "summary";
}) => {
  const { t } = useI18n();
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();

  const cancelClose = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };

  const close = () => {
    cancelClose();
    setOpen(false);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(close, 120);
  };

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const isSummary = variant === "summary";
      const measured = popoverRef.current?.getBoundingClientRect();
      const popoverWidth = measured?.width ?? (isSummary ? 220 : 190);
      const estimatedHeight =
        (isSummary ? 92 : 16) + Math.max(targets.length, 1) * 42;
      const popoverHeight = Math.min(
        measured?.height ?? estimatedHeight,
        window.innerHeight - 20
      );
      setPosition({
        left: isSummary
          ? Math.max(10, Math.min(rect.right + 8, window.innerWidth - popoverWidth - 10))
          : Math.max(10, Math.min(rect.left, window.innerWidth - popoverWidth - 10)),
        top: isSummary
          ? Math.max(10, Math.min(rect.bottom - popoverHeight, window.innerHeight - popoverHeight - 10))
          : rect.top - popoverHeight - 8 >= 10
            ? rect.top - popoverHeight - 8
            : Math.min(window.innerHeight - popoverHeight - 10, rect.bottom + 8)
      });
    }
  };

  const show = () => {
    cancelClose();
    updatePosition();
    setOpen(true);
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    show();
  };

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        close();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, targets.length, variant]);

  const isSummary = variant === "summary";
  const label = isSummary
    ? t("Local Agents")
    : t("{{count}} more Agents", { count: targets.length });
  const triggerLabel = isSummary
    ? t("Show Local Agents")
    : t(
        targets.length === 1
          ? "Show hidden Agent list, {{count}} item"
          : "Show hidden Agent list, {{count}} items",
        { count: targets.length }
      );

  return (
    <>
      <button
        ref={triggerRef}
        className={
          isSummary
            ? `sidebar-agent-summary sidebar-agent-summary--${summaryState ?? "empty"}`
            : "agent-chip agent-chip--more"
        }
        type="button"
        aria-label={triggerLabel}
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        title={label}
        onBlur={isSummary ? undefined : scheduleClose}
        onClick={isSummary ? toggle : show}
        onFocus={isSummary ? undefined : show}
        onMouseEnter={isSummary ? undefined : show}
        onMouseLeave={isSummary ? undefined : scheduleClose}
      >
        {isSummary ? (
          <>
            {summaryState === "loading" ? (
              <LoaderCircle className="is-spinning" size={17} aria-hidden="true" />
            ) : (
              <Monitor size={17} strokeWidth={2.1} aria-hidden="true" />
            )}
            <span className="sidebar-agent-summary__state" aria-hidden="true" />
          </>
        ) : (
          `+${targets.length}`
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="agent-overflow-popover"
              id={popoverId}
              role="menu"
              aria-label={isSummary ? t("Local Agents") : t("Hidden Agents")}
              style={position}
              onKeyDown={handleActionMenuKeyDown}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              {isSummary ? (
                <div className="agent-overflow-popover__header">
                  <strong>{t("Local Agents")}</strong>
                  {statusSummary ? <small>{statusSummary}</small> : null}
                </div>
              ) : null}
              {targets.length === 0 ? (
                <p className="agent-overflow-popover__empty">{t("No enabled Agents")}</p>
              ) : targets.map((target) => {
                const targetIcon = targetIconFor(target);
                const status = t(targetStatusMessage(target.health.status));
                return (
                  <button
                    className="agent-overflow-popover__item"
                    type="button"
                    role="menuitem"
                    key={target.id}
                    onClick={() => {
                      close();
                      onAgentSelect(target.id);
                    }}
                  >
                    <span
                      className={`agent-chip agent-chip--${target.health.status} agent-chip--${targetIcon.flavor}`}
                      aria-hidden="true"
                    >
                      {targetIcon.assetUrl ? (
                        <img className="agent-chip__logo" src={targetIcon.assetUrl} alt="" />
                      ) : (
                        targetInitials(target)
                      )}
                    </span>
                    <span className="agent-overflow-popover__copy">
                      <strong>{target.name}</strong>
                      <small>{status}</small>
                    </span>
                  </button>
                );
              })}
              {isSummary && onOpenAgents ? (
                <button
                  className="agent-overflow-popover__footer"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onOpenAgents();
                  }}
                >
                  <Monitor size={15} strokeWidth={2.1} aria-hidden="true" />
                  <span>{t("Open Agents")}</span>
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
};

export const ProfileSidebar = ({
  targets,
  activeWorkspace,
  isLoading,
  collapsed,
  onWorkspaceSelect,
  onAgentSelect,
  onOpenAgents,
  onQuickOpen
}: ProfileSidebarProps) => {
  const { t } = useI18n();
  const quickOpenShortcut =
    window.agentEnv.platform === "darwin" ? "⌘K" : "Ctrl+K";
  const readyTargets = targets.filter((target) => target.health.status === "ready").length;
  const orderedTargets = targets;
  const statusTargets = orderedTargets.slice(0, 3);
  const hiddenTargets = orderedTargets.slice(statusTargets.length);
  const statusSummary = isLoading
    ? t("Detecting Agents")
    : t("{{count}} Agents", { count: targets.length });
  const summaryState = isLoading
    ? "loading"
    : targets.length === 0
      ? "empty"
      : readyTargets === targets.length
        ? "ready"
        : "attention";

  const primaryWorkspaceItems: Array<{
    id: AppWorkspace;
    label: string;
    detail: string;
    icon: ProductIconName;
  }> = [
    { id: "targets", label: t("Agents"), detail: t("Configure and inspect"), icon: "agents" },
    { id: "profiles", label: t("Profiles"), detail: t("Compose reusable Agent setups"), icon: "profiles" },
    { id: "projects", label: t("Workspaces"), detail: t("Recurring project folders"), icon: "projects" },
    {
      id: "conversations",
      label: t("Conversations"),
      detail: t("Continue across Agents"),
      icon: "conversations"
    },
  ];
  const resourceWorkspaceItems: Array<{
    id: AppWorkspace;
    label: string;
    detail: string;
    icon: ProductIconName;
  }> = [
    { id: "library", label: t("Skills"), detail: t("Skill library"), icon: "skills" },
    {
      id: "instructions",
      label: t("Instructions"),
      detail: t("Reusable instruction blocks"),
      icon: "instructions"
    }
  ];

  const renderWorkspaceItem = (item: (typeof primaryWorkspaceItems)[number]) => (
    <button
      aria-label={item.label}
      aria-current={activeWorkspace === item.id ? "page" : undefined}
      className={`workspace-button${activeWorkspace === item.id ? " is-active" : ""}`}
      data-workspace={item.id}
      type="button"
      title={collapsed ? item.label : undefined}
      key={item.id}
      onClick={() => onWorkspaceSelect(item.id)}
    >
      <span className="workspace-button__icon" aria-hidden="true">
        <ProductIcon name={item.icon} />
      </span>
      <span>{item.label}</span>
      <small>{item.detail}</small>
    </button>
  );

  return (
    <aside
      className={`sidebar global-sidebar${collapsed ? " global-sidebar--collapsed" : ""}`}
      aria-label={t("Global navigation")}
    >
      <div className="sidebar__header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <img className="brand-icon" src={appIconUrl} alt="" />
          </div>
          <div>
            <h1>AgentEnv Manager</h1>
          </div>
        </div>
      </div>
      <nav className="workspace-nav" aria-label={t("Primary navigation")}>
        <div className="workspace-nav__group workspace-nav__group--utility">
          <button
            className="workspace-search-button"
            type="button"
            aria-label={t("Quick open")}
            title={collapsed ? t("Quick open") : undefined}
            onClick={onQuickOpen}
          >
            <Search size={15} strokeWidth={2.2} aria-hidden="true" />
            <span>{t("Quick open")}</span>
            <kbd>{quickOpenShortcut}</kbd>
          </button>
        </div>
        <div className="workspace-nav__group workspace-nav__group--destinations">
          {primaryWorkspaceItems.map(renderWorkspaceItem)}
        </div>
        <div className="workspace-nav__group workspace-nav__group--resources">
          {resourceWorkspaceItems.map(renderWorkspaceItem)}
        </div>
        <div className="workspace-nav__group workspace-nav__group--settings">
          <button
            aria-label={t("Settings")}
            aria-current={activeWorkspace === "settings" ? "page" : undefined}
            className={`workspace-button${activeWorkspace === "settings" ? " is-active" : ""}`}
            data-workspace="settings"
            type="button"
            title={collapsed ? t("Settings") : undefined}
            onClick={() => onWorkspaceSelect("settings")}
          >
            <span className="workspace-button__icon" aria-hidden="true">
              <ProductIcon name="settings" />
            </span>
            <span>{t("Settings")}</span>
            <small>{t("Storage and safety")}</small>
          </button>
        </div>
      </nav>
      <section className="system-status-card" aria-label={t("System status")}>
        {collapsed ? (
          <AgentOverflowPopover
            key="collapsed-agent-summary"
            targets={orderedTargets}
            statusSummary={statusSummary}
            summaryState={summaryState}
            variant="summary"
            onAgentSelect={onAgentSelect}
            onOpenAgents={onOpenAgents}
          />
        ) : (
          <>
            <div className="system-status-card__summary">
              <span className={`status-dot${isLoading ? " is-loading" : " is-ready"}`} />
              <strong>{t("Local Agents")}</strong>
              <OverflowTooltip className="system-status-summary" text={statusSummary} />
            </div>
            <div className="agent-chip-row" aria-label={t("Enabled Agents")}>
              {isLoading ? (
                <span className="agent-chip-row__loading" aria-hidden="true">
                  <LoaderCircle className="is-spinning" size={16} />
                </span>
              ) : null}
              {statusTargets.map((target) => {
                const targetIcon = targetIconFor(target);

                return (
                  <button
                    className={`agent-chip agent-chip--${target.health.status} agent-chip--${targetIcon.flavor}`}
                    title={`${target.name} · ${t(targetStatusMessage(target.health.status))}`}
                    key={target.id}
                    type="button"
                    aria-label={t("Configure {{name}}", { name: target.name })}
                    onClick={() => onAgentSelect(target.id)}
                  >
                    {targetIcon.assetUrl ? (
                      <img className="agent-chip__logo" src={targetIcon.assetUrl} alt="" />
                    ) : (
                      targetInitials(target)
                    )}
                  </button>
                );
              })}
              {hiddenTargets.length > 0 ? (
                <AgentOverflowPopover
                  key="expanded-agent-overflow"
                  targets={hiddenTargets}
                  onAgentSelect={onAgentSelect}
                />
              ) : null}
            </div>
          </>
        )}
      </section>
    </aside>
  );
};
