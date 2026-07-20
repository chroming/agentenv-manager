import type { RefObject } from "react";
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
  const normalizedSearch = search.trim().toLowerCase();
  const visibleProfiles = profiles
    .filter((profile) =>
      normalizedSearch.length === 0 ||
      `${profile.name} ${profile.description}`.toLowerCase().includes(normalizedSearch)
    )
    .sort(compareProfilesByCreationTime);

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
                event.preventDefault();
                if (isBroken || actionsDisabled) return;
                const row = event.currentTarget;
                const content = row.querySelector<HTMLElement>(".profile-row__content") ?? row;
                void window.agentEnv.openContextMenu([
                  { id: "duplicate", label: t("Duplicate profile") },
                  { type: "separator" },
                  { id: "delete", label: t("Delete profile") }
                ]).then((selection) => {
                  if (selection === "duplicate") onDuplicate(profile.id);
                  if (selection === "delete") onDelete(profile.id, content);
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
    </aside>
  );
};
