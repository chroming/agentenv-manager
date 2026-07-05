import {
  BookOpen,
  Boxes,
  Monitor,
  Network,
  Settings,
  type LucideIcon
} from "lucide-react";
import type { ProfileSummary, TargetHealthStatus, TargetInfo } from "../../shared/types";

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

const targetStatusLabel: Record<TargetHealthStatus, string> = {
  ready: "Ready",
  "needs-setup": "Needs setup",
  missing: "Missing",
  guarded: "Guarded"
};

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
  const key = `${target.id} ${target.name}`.toLowerCase();

  if (key.includes("opencode")) {
    return { flavor: "opencode", assetUrl: openCodeIconUrl };
  }
  if (key.includes("claude")) {
    return { flavor: "claude", assetUrl: claudeIconUrl };
  }
  if (key.includes("codex")) {
    return { flavor: "codex", assetUrl: openAiIconUrl };
  }

  return { flavor: "generic" };
};

const targetDisplayRank = (target: TargetInfo) => {
  const flavor = targetIconFor(target).flavor;
  const rank: Record<TargetIconFlavor, number> = {
    opencode: 0,
    codex: 1,
    claude: 2,
    generic: 3
  };

  return rank[flavor];
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
    { id: "skills", label: "Skills", detail: "Skill library", icon: BookOpen },
    { id: "mcp", label: "MCP Servers", detail: "Shared servers", icon: Network }
  ];
  const workspaceItems: Array<{
    id: AppWorkspace;
    label: string;
    detail: string;
    icon: LucideIcon;
  }> = [
    { id: "profiles", label: "Profiles", detail: "Compose environments", icon: Boxes },
    { id: "targets", label: "Targets", detail: "Local agent runtimes", icon: Monitor }
  ];

  return (
    <aside className="sidebar global-sidebar" aria-label="Global navigation">
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
      <nav className="workspace-nav" aria-label="Workspace">
        <div className="nav-section-label">Library</div>
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
        <div className="nav-section-label">Workspace</div>
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
        <div className="nav-section-label">Settings</div>
        <button
          aria-label="Settings"
          className={`workspace-button${activeWorkspace === "settings" ? " is-active" : ""}`}
          type="button"
          onClick={() => onWorkspaceSelect("settings")}
        >
          <span className="workspace-button__icon" aria-hidden="true">
            <Settings size={16} strokeWidth={2.2} />
          </span>
          <span>Settings</span>
          <small>Storage and safety</small>
        </button>
      </nav>
      <section className="system-status-card" aria-label="System status">
        <div>
          <span className="status-dot is-ready" />
          <strong>Local agents</strong>
        </div>
        <small>
          {readyTargets}/{targets.length} targets · {isLoading ? "Loading" : `${profiles.length} profiles`}
        </small>
        <div className="agent-chip-row" aria-label="Connected targets">
          {statusTargets.map((target) => {
            const targetIcon = targetIconFor(target);

            return (
              <span
                className={`agent-chip agent-chip--${target.health.status} agent-chip--${targetIcon.flavor}`}
                title={`${target.name} · ${targetStatusLabel[target.health.status]}`}
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
