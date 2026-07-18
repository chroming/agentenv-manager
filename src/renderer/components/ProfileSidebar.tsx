import {
  BookOpen,
  Boxes,
  Monitor,
  Network,
  Settings,
  type LucideIcon
} from "lucide-react";
import type { ProfileSummary, TargetHealthStatus, TargetInfo } from "../../shared/types";
import { useI18n } from "../i18n";

const appIconUrl = new URL("../assets/app-icon.png", import.meta.url).href;
const claudeIconUrl = new URL("../assets/target-icons/claude.svg", import.meta.url).href;
const openAiIconUrl = new URL("../assets/target-icons/openai.svg", import.meta.url).href;
const openCodeIconUrl = new URL("../assets/target-icons/opencode.svg", import.meta.url).href;

export type AppWorkspace = "library" | "profiles" | "targets" | "settings";
export type LibraryTab = "skills" | "mcp";

interface ProfileSidebarProps {
  targets: TargetInfo[];
  profiles: ProfileSummary[];
  activeWorkspace: AppWorkspace;
  activeLibraryTab: LibraryTab;
  isLoading: boolean;
  onWorkspaceSelect(workspace: AppWorkspace): void;
  onLibraryTabSelect(tab: LibraryTab): void;
}

type TargetIconFlavor = "opencode" | "codex" | "claude" | "generic";

const targetInitials = (target: TargetInfo) => {
  const source = target.name || target.id;
  const words = source.split(/[\s-_]+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

  return initials || "A";
};

export const targetIconFor = (target: TargetInfo): { flavor: TargetIconFlavor; assetUrl?: string } => {
  if (target.iconKey === "opencode") {
    return { flavor: "opencode", assetUrl: openCodeIconUrl };
  }
  if (target.iconKey === "claude") {
    return { flavor: "claude", assetUrl: claudeIconUrl };
  }
  if (target.iconKey === "codex") {
    return { flavor: "codex", assetUrl: openAiIconUrl };
  }

  return { flavor: "generic" };
};

const targetDisplayRank = (target: TargetInfo) => {
  return target.displayOrder ?? Number.MAX_SAFE_INTEGER;
};

export const ProfileSidebar = ({
  targets,
  profiles,
  activeWorkspace,
  activeLibraryTab,
  isLoading,
  onWorkspaceSelect,
  onLibraryTabSelect
}: ProfileSidebarProps) => {
  const { t } = useI18n();
  const readyTargets = targets.filter((target) => target.health.status === "ready").length;
  const statusTargets = [...targets]
    .sort((left, right) => targetDisplayRank(left) - targetDisplayRank(right))
    .slice(0, 3);

  const libraryItems: Array<{
    id: LibraryTab;
    label: string;
    detail: string;
    icon: LucideIcon;
  }> = [
    { id: "skills", label: t("Skills"), detail: t("Skill library"), icon: BookOpen },
    { id: "mcp", label: t("MCP Servers"), detail: t("Shared servers"), icon: Network }
  ];
  const workspaceItems: Array<{
    id: AppWorkspace;
    label: string;
    detail: string;
    icon: LucideIcon;
  }> = [
    { id: "profiles", label: t("Profiles"), detail: t("Compose environments"), icon: Boxes },
    { id: "targets", label: t("Targets"), detail: t("Local agent runtimes"), icon: Monitor }
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
        {libraryItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              className={`workspace-button${
                activeWorkspace === "library" && activeLibraryTab === item.id ? " is-active" : ""
              }`}
              type="button"
              key={item.id}
              onClick={() => onLibraryTabSelect(item.id)}
            >
              <span className="workspace-button__icon" aria-hidden="true">
                <Icon size={16} strokeWidth={2.2} />
              </span>
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </button>
          );
        })}
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
      <section className="system-status-card" aria-label={t("System status")}>
        <div>
          <span className="status-dot is-ready" />
          <strong>{t("Local agents")}</strong>
        </div>
        <small>
          {t("{{ready}}/{{total}} targets · {{profiles}}", {
            ready: readyTargets,
            total: targets.length,
            profiles: isLoading
              ? t("Loading")
              : t(profiles.length === 1 ? "{{count}} profile" : "{{count}} profiles", {
                  count: profiles.length
                })
          })}
        </small>
        <div className="agent-chip-row" aria-label={t("Connected targets")}>
          {statusTargets.map((target) => {
            const targetIcon = targetIconFor(target);

            return (
              <span
                className={`agent-chip agent-chip--${target.health.status} agent-chip--${targetIcon.flavor}`}
                title={`${target.name} · ${t(
                  ({
                    ready: "Ready",
                    "needs-setup": "Needs setup",
                    missing: "Missing",
                    guarded: "Guarded"
                  } satisfies Record<TargetHealthStatus, string>)[target.health.status]
                )}`}
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
        </div>
      </section>
    </aside>
  );
};
