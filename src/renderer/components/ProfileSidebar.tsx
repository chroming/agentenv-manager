import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  BookOpen,
  Boxes,
  Monitor,
  Network,
  Settings,
  type LucideIcon
} from "lucide-react";
import type {
  ProfileSummary,
  TargetDescriptor,
  TargetHealthStatus,
  TargetInfo
} from "../../shared/types";
import { useI18n } from "../i18n";
import { OverflowTooltip } from "./OverflowTooltip";

const appIconUrl = new URL("../assets/app-icon.png", import.meta.url).href;
const antigravityIconUrl = new URL("../assets/target-icons/antigravity.png", import.meta.url).href;
const claudeIconUrl = new URL("../assets/target-icons/claude.svg", import.meta.url).href;
const openAiIconUrl = new URL("../assets/target-icons/openai.svg", import.meta.url).href;
const openCodeIconUrl = new URL("../assets/target-icons/opencode.svg", import.meta.url).href;
const traeIconUrl = new URL("../assets/target-icons/trae.png", import.meta.url).href;

export type AppWorkspace = "library" | "profiles" | "targets" | "settings";

interface ProfileSidebarProps {
  targets: TargetInfo[];
  profiles: ProfileSummary[];
  activeWorkspace: AppWorkspace;
  isLoading: boolean;
  onWorkspaceSelect(workspace: AppWorkspace): void;
}

type TargetIconFlavor =
  | "opencode"
  | "codex"
  | "claude"
  | "antigravity"
  | "trae"
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
  target: Pick<TargetDescriptor, "id" | "name" | "iconKey">
): { flavor: TargetIconFlavor; assetUrl?: string } => {
  if (target.iconKey === "opencode") {
    return { flavor: "opencode", assetUrl: openCodeIconUrl };
  }
  if (target.iconKey === "claude") {
    return { flavor: "claude", assetUrl: claudeIconUrl };
  }
  if (target.iconKey === "codex") {
    return { flavor: "codex", assetUrl: openAiIconUrl };
  }
  if (target.iconKey === "antigravity") {
    return { flavor: "antigravity", assetUrl: antigravityIconUrl };
  }
  if (target.iconKey === "trae") {
    return { flavor: "trae", assetUrl: traeIconUrl };
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

const AgentOverflowPopover = ({ targets }: { targets: TargetInfo[] }) => {
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
        aria-describedby={open ? popoverId : undefined}
        aria-expanded={open}
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
              role="tooltip"
              style={position}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              {targets.map((target) => {
                const targetIcon = targetIconFor(target);
                const status = t(targetStatusMessage(target.health.status));
                return (
                  <div className="agent-overflow-popover__item" key={target.id}>
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
                  </div>
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
  onWorkspaceSelect
}: ProfileSidebarProps) => {
  const { t } = useI18n();
  const readyTargets = targets.filter((target) => target.health.status === "ready").length;
  const orderedTargets = [...targets]
    .sort((left, right) => targetDisplayRank(left) - targetDisplayRank(right));
  const statusTargets = orderedTargets.slice(0, 3);
  const hiddenTargets = orderedTargets.slice(statusTargets.length);
  const statusSummary = t("{{ready}}/{{total}} Agents · {{profiles}}", {
    ready: readyTargets,
    total: targets.length,
    profiles: isLoading
      ? t("Loading")
      : t(profiles.length === 1 ? "{{count}} profile" : "{{count}} profiles", {
          count: profiles.length
        })
  });

  const workspaceItems: Array<{
    id: AppWorkspace;
    label: string;
    detail: string;
    icon: LucideIcon;
  }> = [
    { id: "profiles", label: t("Profiles"), detail: t("Compose environments"), icon: Boxes },
    ...(targets.length > 0
      ? [{ id: "targets" as const, label: t("Agents"), detail: t("Local agent tools"), icon: Monitor }]
      : [])
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
        <div className="nav-section-label">{t("Library")}</div>
        <button
          aria-label={t("Skills")}
          className={`workspace-button${activeWorkspace === "library" ? " is-active" : ""}`}
          type="button"
          onClick={() => onWorkspaceSelect("library")}
        >
          <span className="workspace-button__icon" aria-hidden="true">
            <BookOpen size={16} strokeWidth={2.2} />
          </span>
          <span>{t("Skills")}</span>
          <small>{t("Skill library")}</small>
        </button>
        <div className="nav-section-label">{t("Workspace")}</div>
        {workspaceItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              className={`workspace-button${activeWorkspace === item.id ? " is-active" : ""}`}
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
        <div className="nav-section-label">{t("Settings")}</div>
        <button
          aria-label={t("Settings")}
          className={`workspace-button${activeWorkspace === "settings" ? " is-active" : ""}`}
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
      {targets.length > 0 ? <section className="system-status-card" aria-label={t("System status")}>
        <div>
          <span className="status-dot is-ready" />
          <strong>{t("Local Agents")}</strong>
        </div>
        <OverflowTooltip className="system-status-summary" text={statusSummary} />
        <div className="agent-chip-row" aria-label={t("Enabled Agents")}>
          {statusTargets.map((target) => {
            const targetIcon = targetIconFor(target);

            return (
              <span
                className={`agent-chip agent-chip--${target.health.status} agent-chip--${targetIcon.flavor}`}
                title={`${target.name} · ${t(targetStatusMessage(target.health.status))}`}
                key={target.id}
              >
                {targetIcon.assetUrl ? (
                  <img className="agent-chip__logo" src={targetIcon.assetUrl} alt="" />
                ) : (
                  targetInitials(target)
                )}
              </span>
            );
          })}
          {hiddenTargets.length > 0 ? <AgentOverflowPopover targets={hiddenTargets} /> : null}
        </div>
      </section> : null}
    </aside>
  );
};
