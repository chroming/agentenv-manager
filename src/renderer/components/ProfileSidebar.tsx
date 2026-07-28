import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  BookOpen,
  Boxes,
  LoaderCircle,
  MessageSquareText,
  Monitor,
  Network,
  Search,
  Settings,
  type LucideIcon
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
  | "profiles"
  | "conversations"
  | "targets"
  | "settings";

interface ProfileSidebarProps {
  targets: TargetInfo[];
  profiles: ProfileSummary[];
  activeWorkspace: AppWorkspace;
  isLoading: boolean;
  onWorkspaceSelect(workspace: AppWorkspace): void;
  onAgentSelect(targetId: string): void;
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

const targetDisplayRank = (target: TargetInfo) => {
  return target.displayOrder ?? Number.MAX_SAFE_INTEGER;
};

const targetStatusMessage = (status: TargetHealthStatus) =>
  ({
    ready: "Ready",
    "needs-setup": "Needs setup",
    missing: "Missing",
    guarded: "Guarded"
  } satisfies Record<TargetHealthStatus, string>)[status];

const AgentOverflowPopover = ({
  targets,
  onAgentSelect
}: {
  targets: TargetInfo[];
  onAgentSelect(targetId: string): void;
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

  const show = () => {
    cancelClose();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const popoverWidth = 190;
      const popoverHeight = Math.min(16 + targets.length * 42, window.innerHeight - 20);
      setPosition({
        left: Math.max(10, Math.min(rect.left, window.innerWidth - popoverWidth - 10)),
        top:
          rect.top - popoverHeight - 8 >= 10
            ? rect.top - popoverHeight - 8
            : Math.min(window.innerHeight - popoverHeight - 10, rect.bottom + 8)
      });
    }
    setOpen(true);
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

  const label = t("{{count}} more Agents", { count: targets.length });
  const triggerLabel = t(
    targets.length === 1
      ? "Show hidden Agent list, {{count}} item"
      : "Show hidden Agent list, {{count}} items",
    { count: targets.length }
  );

  return (
    <>
      <button
        ref={triggerRef}
        className="agent-chip agent-chip--more"
        type="button"
        aria-label={triggerLabel}
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        title={label}
        onBlur={scheduleClose}
        onClick={show}
        onFocus={show}
        onMouseEnter={show}
        onMouseLeave={scheduleClose}
      >
        +{targets.length}
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="agent-overflow-popover"
              id={popoverId}
              role="menu"
              aria-label={t("Hidden Agents")}
              style={position}
              onKeyDown={handleActionMenuKeyDown}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              {targets.map((target) => {
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
            </div>,
            document.body
          )
        : null}
    </>
  );
};

export const ProfileSidebar = ({
  targets,
  profiles,
  activeWorkspace,
  isLoading,
  onWorkspaceSelect,
  onAgentSelect,
  onQuickOpen
}: ProfileSidebarProps) => {
  const { t } = useI18n();
  const readyTargets = targets.filter((target) => target.health.status === "ready").length;
  const orderedTargets = [...targets]
    .sort((left, right) => targetDisplayRank(left) - targetDisplayRank(right));
  const statusTargets = orderedTargets.slice(0, 3);
  const hiddenTargets = orderedTargets.slice(statusTargets.length);
  const statusSummary = isLoading
    ? t("Detecting Agents")
    : t("{{ready}}/{{total}} Agents · {{profiles}}", {
        ready: readyTargets,
        total: targets.length,
        profiles: t(profiles.length === 1 ? "{{count}} profile" : "{{count}} profiles", {
          count: profiles.length
        })
      });

  const workspaceItems: Array<{
    id: AppWorkspace;
    label: string;
    detail: string;
    icon: LucideIcon;
  }> = [
    { id: "targets", label: t("Agents"), detail: t("Configure and inspect"), icon: Monitor },
    { id: "profiles", label: t("Profiles"), detail: t("Compose environments"), icon: Boxes },
    {
      id: "conversations",
      label: t("Conversations"),
      detail: t("Continue across Agents"),
      icon: MessageSquareText
    }
  ];

  return (
    <aside className="sidebar global-sidebar" aria-label={t("Global navigation")}>
      <div className="sidebar__header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <img className="brand-icon" src={appIconUrl} alt="" />
          </div>
          <div>
            <h1>AgentEnv Manager</h1>
            <p className="muted">v0.1.0</p>
          </div>
        </div>
      </div>
      <nav className="workspace-nav" aria-label={t("Workspace")}>
        <button className="workspace-search-button" type="button" onClick={onQuickOpen}>
          <Search size={15} strokeWidth={2.2} aria-hidden="true" />
          <span>{t("Quick open")}</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="nav-section-label">{t("Workspace")}</div>
        {workspaceItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              aria-current={activeWorkspace === item.id ? "page" : undefined}
              className={`workspace-button${activeWorkspace === item.id ? " is-active" : ""}`}
              data-workspace={item.id}
              type="button"
              key={item.id}
              onClick={() => onWorkspaceSelect(item.id)}
            >
              <span className="workspace-button__icon" aria-hidden="true">
                <Icon size={16} strokeWidth={2.2} />
              </span>
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </button>
          );
        })}
        <div className="nav-section-label">{t("Library")}</div>
        <button
          aria-label={t("Skills")}
          aria-current={activeWorkspace === "library" ? "page" : undefined}
          className={`workspace-button${activeWorkspace === "library" ? " is-active" : ""}`}
          data-workspace="library"
          type="button"
          onClick={() => onWorkspaceSelect("library")}
        >
          <span className="workspace-button__icon" aria-hidden="true">
            <BookOpen size={16} strokeWidth={2.2} />
          </span>
          <span>{t("Skills")}</span>
          <small>{t("Skill library")}</small>
        </button>
        <div className="nav-section-label">{t("Settings")}</div>
        <button
          aria-label={t("Settings")}
          aria-current={activeWorkspace === "settings" ? "page" : undefined}
          className={`workspace-button${activeWorkspace === "settings" ? " is-active" : ""}`}
          data-workspace="settings"
          type="button"
          onClick={() => onWorkspaceSelect("settings")}
        >
          <span className="workspace-button__icon" aria-hidden="true">
            <Settings size={16} strokeWidth={2.2} />
          </span>
          <span>{t("Settings")}</span>
          <small>{t("Storage and safety")}</small>
        </button>
      </nav>
      <section className="system-status-card" aria-label={t("System status")}>
        <div>
          <span className={`status-dot${isLoading ? " is-loading" : " is-ready"}`} />
          <strong>{t("Local Agents")}</strong>
        </div>
        <OverflowTooltip className="system-status-summary" text={statusSummary} />
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
              targets={hiddenTargets}
              onAgentSelect={onAgentSelect}
            />
          ) : null}
        </div>
      </section>
    </aside>
  );
};
