import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { Monitor, Search, TriangleAlert } from "lucide-react";
import type {
  LibraryResourceVersions,
  ProfileDetail,
  ProfileSummary,
  ResourceIconKey,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { libraryResourceVersionsEqual } from "../../shared/libraryVersions";
import { useI18n } from "../i18n";
import {
  compareProfilesByCreationTime,
  listProfileApplications,
  type ProfileResourceSummary
} from "../profileSummary";
import { targetIconFor } from "./ProfileSidebar";
import { OverflowTooltip } from "./OverflowTooltip";
import { ProfileActionsMenu } from "./ProfileActionsMenu";
import { ResourceIconPicker } from "./ResourceIconPicker";

interface ProfileListProps {
  isLoading: boolean;
  profiles: ProfileSummary[];
  search: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  selectedProfileId?: string;
  draftProfile?: ProfileDetail;
  isProfileDirty: boolean;
  profileResourceCounts: Record<string, ProfileResourceSummary>;
  profileLibraryVersions: Record<string, LibraryResourceVersions>;
  targets: TargetInfo[];
  targetStates: TargetManagementState[];
  actionsDisabled?: boolean;
  onDelete(profileId: string, returnFocus: HTMLElement): void;
  onDuplicate(profileId: string): void;
  onSearchChange(value: string): void;
  onSelect(profileId: string): void;
  onIconChange(profileId: string, iconKey: ResourceIconKey): void;
}

export const ProfileList = ({
  isLoading,
  profiles,
  search,
  searchInputRef,
  selectedProfileId,
  draftProfile,
  isProfileDirty,
  profileResourceCounts,
  profileLibraryVersions,
  targets,
  targetStates,
  actionsDisabled = false,
  onDelete,
  onDuplicate,
  onSearchChange,
  onSelect,
  onIconChange
}: ProfileListProps) => {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{
    profileId: string;
    left: number;
    top: number;
  }>();
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextReturnFocusRef = useRef<HTMLElement>(null);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleProfiles = profiles
    .filter((profile) =>
      normalizedSearch.length === 0 ||
      `${profile.name} ${profile.description}`.toLowerCase().includes(normalizedSearch)
    )
    .sort(compareProfilesByCreationTime);

  const closeContextMenu = (restoreFocus = false) => {
    setContextMenu(undefined);
    if (restoreFocus) {
      window.requestAnimationFrame(() => contextReturnFocusRef.current?.focus());
    }
  };

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(
      Math.max(contextMenu.left, margin),
      Math.max(margin, window.innerWidth - rect.width - margin)
    );
    const top = Math.min(
      Math.max(contextMenu.top, margin),
      Math.max(margin, window.innerHeight - rect.height - margin)
    );
    if (left !== contextMenu.left || top !== contextMenu.top) {
      setContextMenu((current) => current ? { ...current, left, top } : current);
      return;
    }
    contextMenuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) closeContextMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu(true);
    };
    const handleViewportChange = () => closeContextMenu();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [contextMenu]);

  return (
    <aside className="profile-index" aria-label={t("Profile list")}>
      <div className="profile-list-toolbar">
        <label className="profile-search ui-composite-field">
          <Search size={15} strokeWidth={2.2} aria-hidden="true" />
          <input
            ref={searchInputRef}
            aria-label={t("Search profiles")}
            placeholder={t("Search Profile name...")}
            value={search}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
        </label>
      </div>
      <div className="profile-list">
        {isLoading ? (
          <div className="inline-state inline-state--loading" role="status">
            <span className="inline-state__icon" aria-hidden="true" />
            <span>{t("Loading profiles")}</span>
          </div>
        ) : null}
        {!isLoading && visibleProfiles.length === 0 ? (
          <div className="inline-state">
            <span className="inline-state__icon" aria-hidden="true">
              <Search size={15} strokeWidth={2.2} />
            </span>
            <span>{t("No profiles match this view")}</span>
          </div>
        ) : null}
        {visibleProfiles.map((profile) => {
          const isBroken = Boolean(profile.loadError);
          const counts = profileResourceCounts[profile.id];
          const applications = listProfileApplications(profile.id, targetStates, targets);
          const isSelected = profile.id === selectedProfileId;
          const iconKey =
            (isSelected ? draftProfile?.manifest.iconKey : undefined) ??
            profile.iconKey ??
            "folder";
          return (
            <div
              className={`profile-row${isSelected ? " is-active" : ""}${isBroken ? " is-invalid" : ""}`}
              key={profile.id}
              role="group"
              aria-label={t("Profile {{name}}", { name: profile.name })}
              onContextMenu={(event) => {
                if (isBroken || actionsDisabled) return;
                event.preventDefault();
                const row = event.currentTarget;
                const content = row.querySelector<HTMLElement>(".profile-row__content") ?? row;
                const rect = row.getBoundingClientRect();
                contextReturnFocusRef.current = content;
                setContextMenu({
                  profileId: profile.id,
                  left: event.clientX || rect.left + 24,
                  top: event.clientY || rect.top + 24
                });
              }}
            >
              {isBroken ? (
                <span className="profile-row__icon profile-row__icon--invalid" aria-hidden="true">
                  <TriangleAlert size={18} strokeWidth={2.2} />
                </span>
              ) : (
                <ResourceIconPicker
                  className="profile-row__icon"
                  iconKey={iconKey}
                  label={profile.name}
                  triggerLabel={t("Change icon for profile {{id}}", { id: profile.id })}
                  onChange={(nextIconKey) => {
                    if (nextIconKey) onIconChange(profile.id, nextIconKey);
                  }}
                />
              )}
              <button
                className="profile-row__content"
                type="button"
                aria-current={isSelected ? "page" : undefined}
                title={profile.loadError}
                onClick={() => onSelect(profile.id)}
              >
                <span className="profile-row__title">
                  <span className="profile-row__name">{profile.name}</span>
                  {isSelected && isProfileDirty ? <strong>{t("Unsaved")}</strong> : null}
                </span>
                {isBroken ? (
                  <span className="profile-row__description profile-row__description--invalid">
                    {t("Stored Profile data could not be loaded")}
                  </span>
                ) : (
                  <>
                    <OverflowTooltip
                      ariaLabel={t("Full profile description {{id}}", { id: profile.id })}
                      className="profile-row__description"
                      focusable={false}
                      text={profile.description || t("No description")}
                    />
                    <span className="profile-row__stats">
                      <span>{t("{{count}} skills", { count: counts?.skills.count ?? 0 })}</span>
                      <span>{counts?.mcp.count ?? 0} MCP</span>
                      <span>{t("{{count}} files", { count: counts?.instructions.count ?? 0 })}</span>
                    </span>
                  </>
                )}
                {!isBroken ? (
                  <span
                    className={`profile-row__deployments${applications.length === 0 ? " profile-row__deployments--empty" : ""}`}
                    aria-label={
                      applications.length > 0
                        ? t("Active on: {{targets}}", {
                            targets: applications
                              .map((application) => application.target?.name ?? application.state.targetId)
                              .join(", ")
                          })
                        : t("Not active")
                    }
                  >
                    {applications.length === 0 ? (
                      <span>{t("Not active")}</span>
                    ) : applications.map((application) => {
                      const targetName = application.target?.name ?? application.state.targetId;
                      const targetIcon = application.target
                        ? targetIconFor(application.target)
                        : undefined;
                      const needsAttention =
                        application.state.lifecycleStatus === "drifted" ||
                        application.state.lifecycleStatus === "recovery-required" ||
                        (application.state.errorCount ?? 0) > 0;
                      const isCurrent = Boolean(
                        !needsAttention &&
                        application.state.appliedProfileHash &&
                        application.state.appliedProfileHash ===
                          (profile.targetContentHashes?.[application.state.targetId] ??
                            profile.contentHash) &&
                        libraryResourceVersionsEqual(
                          application.state.appliedLibraryVersions,
                          profileLibraryVersions[profile.id]
                        )
                      );
                      const deploymentState = needsAttention
                        ? "attention"
                        : isCurrent
                          ? "current"
                          : "pending";
                      const deploymentTitle = needsAttention
                        ? t("{{name}} needs attention", { name: targetName })
                        : isCurrent
                          ? t("{{name}} is up to date", { name: targetName })
                          : t("{{name}} uses this profile; changes are pending", { name: targetName });
                      return (
                        <span
                          className={`profile-target-chip profile-target-chip--${deploymentState}`}
                          title={deploymentTitle}
                          key={application.state.targetId}
                        >
                          {targetIcon?.assetUrl ? (
                            <img
                              className={`profile-target-logo profile-target-logo--${targetIcon.flavor}`}
                              src={targetIcon.assetUrl}
                              alt=""
                            />
                          ) : (
                            <Monitor size={12} strokeWidth={2.2} aria-hidden="true" />
                          )}
                          <span>{targetName}</span>
                        </span>
                      );
                    })}
                  </span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
      {contextMenu
        ? createPortal(
            <ProfileActionsMenu
              className="profile-context-menu"
              disabled={actionsDisabled}
              menuRef={contextMenuRef}
              style={{ left: contextMenu.left, top: contextMenu.top }}
              onDuplicate={() => {
                const profileId = contextMenu.profileId;
                closeContextMenu();
                onDuplicate(profileId);
              }}
              onDelete={() => {
                const profileId = contextMenu.profileId;
                const returnFocus = contextReturnFocusRef.current;
                closeContextMenu();
                if (returnFocus) onDelete(profileId, returnFocus);
              }}
            />,
            document.body
          )
        : null}
    </aside>
  );
};
