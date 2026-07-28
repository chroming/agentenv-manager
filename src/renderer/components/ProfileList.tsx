import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { ResourceIconPicker } from "./ResourceIconPicker";
import { ProfileActionsMenu } from "./ProfileActionsMenu";

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

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(
      Math.max(margin, contextMenu.left),
      Math.max(margin, window.innerWidth - rect.width - margin)
    );
    const top = Math.min(
      Math.max(margin, contextMenu.top),
      Math.max(margin, window.innerHeight - rect.height - margin)
    );
    if (left !== contextMenu.left || top !== contextMenu.top) {
      setContextMenu((current) => current ? { ...current, left, top } : current);
      return;
    }
    contextMenuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const dismiss = (restoreFocus = false) => {
      setContextMenu(undefined);
      if (restoreFocus) {
        window.requestAnimationFrame(() => contextReturnFocusRef.current?.focus());
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest(".profile-row-context-menu")) {
        dismiss();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss(true);
      }
    };
    const handleWindowChange = () => dismiss();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [contextMenu]);

  return (
    <>
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
          const primaryApplication = applications[0];
          const preferredTarget = !primaryApplication
            ? targets.find((target) => target.id === profile.preferredTargetId)
            : undefined;
          const applicationTargetName = primaryApplication
            ? primaryApplication.target?.name ?? primaryApplication.state.targetId
            : preferredTarget?.name;
          const applicationNeedsAttention = Boolean(
            primaryApplication &&
            (
              primaryApplication.state.lifecycleStatus === "drifted" ||
              primaryApplication.state.lifecycleStatus === "recovery-required" ||
              (primaryApplication.state.errorCount ?? 0) > 0
            )
          );
          const applicationIsCurrent = Boolean(
            primaryApplication &&
            !applicationNeedsAttention &&
            (
              primaryApplication.state.lifecycleStatus === "applied" ||
              primaryApplication.state.lifecycleStatus === "applied-with-outside"
            ) &&
            primaryApplication.state.appliedProfileHash &&
            primaryApplication.state.appliedProfileHash ===
              (profile.targetContentHashes?.[primaryApplication.state.targetId] ??
                profile.contentHash) &&
            (
              primaryApplication.state.lifecycleStatus === "applied-with-outside" ||
              libraryResourceVersionsEqual(
                primaryApplication.state.appliedLibraryVersions,
                profileLibraryVersions[profile.id]
              )
            )
          );
          const deploymentState = primaryApplication
            ? applicationNeedsAttention
              ? "attention"
              : applicationIsCurrent
                ? "current"
                : "pending"
            : preferredTarget
              ? "preferred"
              : "empty";
          const deploymentLabel = primaryApplication
            ? t(
                applicationNeedsAttention
                  ? "{{name}} needs attention"
                  : applicationIsCurrent
                    ? "{{name}} active"
                    : "{{name}} pending",
                { name: applicationTargetName ?? primaryApplication.state.targetId }
              )
            : preferredTarget
              ? t("{{name}} preferred", { name: preferredTarget.name })
              : t("Not applied");
          const deploymentTitle = applications.length > 0
            ? t("Active on: {{targets}}", {
                targets: applications
                  .map((application) => application.target?.name ?? application.state.targetId)
                  .join(", ")
              })
            : deploymentLabel;
          const deploymentTarget = primaryApplication?.target ?? preferredTarget;
          const deploymentTargetIcon = deploymentTarget
            ? targetIconFor(deploymentTarget)
            : undefined;
          return (
            <div
              className={`profile-row${isSelected ? " is-active" : ""}${isBroken ? " is-invalid" : ""}`}
              key={profile.id}
              role="group"
              aria-label={t("Profile {{name}}", { name: profile.name })}
              onContextMenu={(event) => {
                event.preventDefault();
                if (isBroken || actionsDisabled) return;
                const row = event.currentTarget;
                const content = row.querySelector<HTMLElement>(".profile-row__content") ?? row;
                contextReturnFocusRef.current = content;
                setContextMenu({
                  profileId: profile.id,
                  left: event.clientX,
                  top: event.clientY
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
                  showAgentIcons
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
                  {isSelected && isProfileDirty ? (
                    <strong className="profile-row__dirty">{t("Unsaved")}</strong>
                  ) : null}
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
                    <span className="profile-row__footer">
                      <span className="profile-row__stats">
                        <span>{t("{{count}} skills", { count: counts?.skills.count ?? 0 })}</span>
                        <span>{counts?.mcp.count ?? 0} MCP</span>
                        <span>{t("{{count}} files", { count: counts?.instructions.count ?? 0 })}</span>
                      </span>
                      <span
                        className={`profile-row__deployments profile-row__deployments--${deploymentState}`}
                        aria-label={deploymentTitle}
                        title={deploymentTitle}
                      >
                        {deploymentTargetIcon?.assetUrl ? (
                          <img
                            className={`profile-target-logo profile-target-logo--${deploymentTargetIcon.flavor}`}
                            src={deploymentTargetIcon.assetUrl}
                            alt=""
                          />
                        ) : (
                          <Monitor size={12} strokeWidth={2} aria-hidden="true" />
                        )}
                        <span className="profile-row__deployment-label">{deploymentLabel}</span>
                        {applications.length > 1 ? (
                          <span className="profile-row__deployment-more">+{applications.length - 1}</span>
                        ) : null}
                      </span>
                    </span>
                  </>
                )}
              </button>
            </div>
          );
        })}
        </div>
      </aside>
      {contextMenu ? createPortal(
        <ProfileActionsMenu
          className="profile-row-context-menu"
          disabled={actionsDisabled}
          menuRef={contextMenuRef}
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onDuplicate={() => {
            onDuplicate(contextMenu.profileId);
            setContextMenu(undefined);
          }}
          onDelete={() => {
            const returnFocus = contextReturnFocusRef.current;
            setContextMenu(undefined);
            if (returnFocus) onDelete(contextMenu.profileId, returnFocus);
          }}
        />,
        document.body
      ) : null}
    </>
  );
};
