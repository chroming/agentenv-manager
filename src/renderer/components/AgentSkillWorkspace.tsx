import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FolderKanban,
  LoaderCircle,
  Monitor,
  RefreshCw,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";
import { useRef, useState } from "react";
import type {
  ActivationPreview,
  ProfileDetail,
  ProfileResourceMode,
  ProfileResources,
  SkillLibraryEntry,
  SkillUpdateInfo,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { collectLibraryResourceVersions, libraryResourceVersionsEqual } from "../../shared/libraryVersions";
import { profileResourceMode } from "../../shared/profileResources";
import { isTargetInstalled } from "../../shared/targetHealth";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { targetIconFor } from "./ProfileSidebar";
import { PreviewDialog } from "./PreviewDialog";
import { SkillsEditor } from "./SkillsEditor";
import { Button, ControlGroup, ModalFrame } from "./ui";

type ProfileEditStrategy = "fork" | "shared";

interface PendingProfileChange {
  resources: ProfileResources;
  managementMode?: ProfileResourceMode;
}

interface AgentSkillWorkspaceProps {
  target: TargetInfo;
  targetState?: TargetManagementState;
  profile?: ProfileDetail;
  librarySkills: SkillLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  importedSkills: SkillLibraryEntry[];
  sharedProfileTargetNames: string[];
  localSkillCount: number;
  loading: boolean;
  loadError?: string;
  saving: boolean;
  saveStatus?: string;
  checkingSkillUpdates: boolean;
  preview?: ActivationPreview;
  previewing: boolean;
  applying: boolean;
  onBack(): void;
  onRetry(): void;
  onBeginSetup(scope: "all" | "skills"): void;
  onOpenProfile(profileId?: string): void;
  onOpenImport(): void;
  onDismissImported(): void;
  onCheckSkillUpdates(ids: string[]): void;
  onPreviewSkillUpdate(id: string): void;
  onSaveProfileSkills(
    resources: ProfileResources,
    strategy: ProfileEditStrategy,
    managementMode?: ProfileResourceMode
  ): void;
  onPreviewApply(): void;
  onCancelPreview(): void;
  onApply(): void;
}

const lifecycleLabels: Record<TargetManagementState["lifecycleStatus"], string> = {
  unmanaged: "Not managed",
  applied: "Applied",
  pending: "Changes pending",
  drifted: "Changed outside AgentEnv",
  "recovery-required": "Recovery required"
};

export const AgentSkillWorkspace = ({
  target,
  targetState,
  profile,
  librarySkills,
  skillUpdates,
  importedSkills,
  sharedProfileTargetNames,
  localSkillCount,
  loading,
  loadError,
  saving,
  saveStatus,
  checkingSkillUpdates,
  preview,
  previewing,
  applying,
  onBack,
  onRetry,
  onBeginSetup,
  onOpenProfile,
  onOpenImport,
  onDismissImported,
  onCheckSkillUpdates,
  onPreviewSkillUpdate,
  onSaveProfileSkills,
  onPreviewApply,
  onCancelPreview,
  onApply
}: AgentSkillWorkspaceProps) => {
  const { t } = useI18n();
  const [pendingChange, setPendingChange] = useState<PendingProfileChange>();
  const [sharedEditStrategy, setSharedEditStrategy] = useState<ProfileEditStrategy>();
  const sharedDialogRef = useRef<HTMLElement>(null);
  const sharedCancelRef = useRef<HTMLButtonElement>(null);
  const sharedFallbackRef = useRef<HTMLButtonElement>(null);
  const icon = targetIconFor(target);
  const installed = isTargetInstalled(target.health);
  const managesSkills = Boolean(
    profile && profileResourceMode(profile.resources, target.id, "skills") === "manage"
  );
  const expectedVersions = profile
    ? collectLibraryResourceVersions(profile, librarySkills, target.id)
    : undefined;
  const attachableImportedSkills = profile
    ? importedSkills.filter(
        (skill) =>
          skill.globallyEnabled !== false &&
          !profile.resources.skills.some(
            (reference) => reference.libraryId === skill.id
          )
      )
    : [];
  const profileHash = profile?.targetContentHashes?.[target.id];
  const profileActive = Boolean(
    profile && targetState?.activeProfileId === profile.id
  );
  const affectsOtherAgents =
    sharedProfileTargetNames.length > (profileActive ? 1 : 0);
  const upToDate = Boolean(
    profileActive &&
    targetState?.lifecycleStatus === "applied" &&
    profileHash &&
    targetState.appliedProfileHash === profileHash &&
    libraryResourceVersionsEqual(
      targetState.appliedLibraryVersions,
      expectedVersions
    )
  );
  const lifecycleLabel = targetState
    ? lifecycleLabels[targetState.lifecycleStatus]
    : "Not managed";
  const applyDisabled = Boolean(
    !profile ||
    !installed ||
    !target.health.canWrite ||
    !managesSkills ||
    saving ||
    previewing ||
    applying ||
    upToDate ||
    targetState?.lifecycleStatus === "recovery-required"
  );

  useModalDialog({
    open: Boolean(pendingChange),
    dialogRef: sharedDialogRef,
    initialFocusRef: sharedCancelRef,
    fallbackFocusRef: sharedFallbackRef,
    onDismiss: () => setPendingChange(undefined),
    dismissDisabled: saving
  });

  const saveChange = (
    resources: ProfileResources,
    managementMode?: ProfileResourceMode
  ) => {
    if (
      affectsOtherAgents &&
      !sharedEditStrategy
    ) {
      setPendingChange({ resources, managementMode });
      return;
    }
    onSaveProfileSkills(
      resources,
      affectsOtherAgents ? sharedEditStrategy ?? "shared" : "shared",
      managementMode
    );
  };

  const commitSharedChange = (strategy: ProfileEditStrategy) => {
    if (!pendingChange) return;
    const change = pendingChange;
    setPendingChange(undefined);
    setSharedEditStrategy(strategy);
    onSaveProfileSkills(change.resources, strategy, change.managementMode);
  };

  return (
    <section className="agent-skill-page" aria-label={t("Manage {{name}} Skills", { name: target.name })}>
      <div className="agent-skill-breadcrumb">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={2.2} aria-hidden="true" />
          {t("Agents")}
        </button>
        <span aria-hidden="true">/</span>
        <span>{target.name}</span>
      </div>

      <header className="agent-skill-header">
        <span className={`agent-skill-header__icon target-workflow-icon--${icon.flavor}`} aria-hidden="true">
          {icon.assetUrl ? <img src={icon.assetUrl} alt="" /> : <Monitor size={22} />}
        </span>
        <span className="agent-skill-header__identity">
          <span className="agent-skill-header__title">
            <h2>{target.name}</h2>
            <span className={`agent-skill-health agent-skill-health--${target.health.status}`}>
              {target.health.status === "ready"
                ? t("Ready")
                : target.health.status === "missing"
                  ? t("Missing")
                  : t("Needs setup")}
            </span>
          </span>
          <span>
            {profile
              ? t("Skills managed by AgentEnv")
              : loadError
                ? t("Profile needs attention")
                : t("Skills are not managed yet")}
          </span>
        </span>
        <ControlGroup className="agent-skill-header__actions" aria-label={t("Agent Skill actions")}>
          {profile ? (
            <Button
              className="agent-skill-apply"
              ref={sharedFallbackRef}
              size="prominent"
              variant={applyDisabled ? "secondary" : "primary"}
              disabled={applyDisabled}
              aria-busy={previewing}
              icon={previewing
                ? <LoaderCircle className="is-spinning" size={15} />
                : <ArrowRight size={15} strokeWidth={2.3} />}
              onClick={onPreviewApply}
            >
              {t("Review and apply")}
            </Button>
          ) : null}
        </ControlGroup>
      </header>

      <div className="agent-skill-body">
        {loading ? (
          <div className="agent-skill-loading" role="status">
            <LoaderCircle className="is-spinning" size={18} aria-hidden="true" />
            <span>{t("Loading Agent skills...")}</span>
          </div>
        ) : loadError ? (
          <section className="agent-skill-load-error" role="alert">
            <span className="agent-skill-load-error__icon" aria-hidden="true">
              <TriangleAlert size={21} strokeWidth={2.1} />
            </span>
            <div>
              <h3>{t("This Agent's Profile could not be loaded")}</h3>
              <p>{loadError}</p>
              <Button size="compact" onClick={onRetry}>
                {t("Retry")}
              </Button>
            </div>
          </section>
        ) : !profile ? (
          <section className={`agent-skill-onboarding${installed ? "" : " is-unavailable"}`}>
            <span className="agent-skill-onboarding__icon" aria-hidden="true">
              {installed
                ? <ShieldCheck size={22} strokeWidth={2} />
                : <TriangleAlert size={22} strokeWidth={2} />}
            </span>
            <div>
              <h3>
                {t(installed
                  ? "Preserve and manage this Agent's Skills"
                  : "{{name}} is not installed", { name: target.name })}
              </h3>
              <p>
                {!installed
                  ? t("AgentEnv cannot manage this Agent's Skills until its command or app is detected. Install it, then return to Agents and Refresh.")
                  : localSkillCount > 0
                  ? t("{{count}} local Skills detected. AgentEnv will preserve their content before anything changes.", {
                      count: localSkillCount
                    })
                  : t("AgentEnv will scan this Agent, preserve its current Skills, and prepare a reusable setup.")}
              </p>
              <Button
                size="prominent"
                variant="primary"
                disabled={!installed}
                title={!installed
                  ? t("{{name}} is not detected", { name: target.name })
                  : undefined}
                icon={<ArrowRight size={15} strokeWidth={2.3} />}
                onClick={() => onBeginSetup("skills")}
              >
                {t("Manage {{name}} Skills", { name: target.name })}
              </Button>
            </div>
          </section>
        ) : (
          <>
            <section className="agent-skill-context" aria-label={t("Agent Skill status")}>
              <span className={`agent-skill-context__state agent-skill-context__state--${targetState?.lifecycleStatus ?? "unmanaged"}`}>
                {upToDate ? <CheckCircle2 size={15} /> : targetState?.lifecycleStatus === "drifted" || targetState?.lifecycleStatus === "recovery-required"
                  ? <TriangleAlert size={15} />
                  : <Clock3 size={15} />}
                <span>
                  <strong>{t(upToDate ? "Up to date" : profileActive ? lifecycleLabel : "Ready to apply")}</strong>
                  <small>
                    {saveStatus
                      ? t(saveStatus)
                      : profileActive
                        ? t("{{name}} uses this Profile", { name: target.name })
                        : t("The Agent is unchanged until Apply")}
                  </small>
                </span>
              </span>
              <span className="agent-skill-context__profile">
                <FolderKanban size={15} aria-hidden="true" />
                <span><small>{t("Profile")}</small><strong>{profile.manifest.name}</strong></span>
              </span>
              {saving ? (
                <span className="agent-skill-context__saving" role="status">
                  <LoaderCircle className="is-spinning" size={14} aria-hidden="true" />
                  {t("Saving changes...")}
                </span>
              ) : null}
            </section>

            {!managesSkills ? (
              <section className="agent-skill-management-off">
                <span>
                  <strong>{t("This Profile leaves {{name}} Skills unchanged", { name: target.name })}</strong>
                  <small>{t("Turn on Skill management before editing or applying this list.")}</small>
                </span>
                <Button
                  size="compact"
                  disabled={saving}
                  onClick={() => saveChange(profile.resources, "manage")}
                >
                  {t("Manage Skills")}
                </Button>
              </section>
            ) : (
              <>
                {attachableImportedSkills.length > 0 ? (
                  <section className="agent-imported-skills">
                    <span>
                      <strong>
                        {t("{{count}} imported Skills are ready to add", {
                          count: attachableImportedSkills.length
                        })}
                      </strong>
                      <small>{attachableImportedSkills.map((skill) => skill.name).join(" · ")}</small>
                    </span>
                    <Button size="compact" onClick={onDismissImported}>
                      {t("Not now")}
                    </Button>
                    <Button
                      size="compact"
                      variant="primary"
                      disabled={saving}
                      onClick={() => {
                        saveChange({
                          ...profile.resources,
                          skills: [
                            ...profile.resources.skills,
                            ...attachableImportedSkills.map((skill) => ({
                              libraryId: skill.id,
                              targetName: skill.id,
                              enabled: true
                            }))
                          ]
                        });
                        onDismissImported();
                      }}
                    >
                      {t("Add to Profile")}
                    </Button>
                  </section>
                ) : null}
                <div className="agent-skill-editor">
                  <SkillsEditor
                    value={profile.resources}
                    librarySkills={librarySkills}
                    skillUpdates={skillUpdates}
                    checkingSkillUpdates={checkingSkillUpdates}
                    disabled={saving}
                    appliedSkillVersions={
                      profileActive ? targetState?.appliedLibraryVersions?.skills : undefined
                    }
                    selectedTargetName={target.name}
                    onCheckSkillUpdates={onCheckSkillUpdates}
                    onImportNewSkill={onOpenImport}
                    onPreviewSkillUpdate={onPreviewSkillUpdate}
                    onChange={(resources) => saveChange(resources)}
                  />
                </div>
              </>
            )}

            <details className="agent-skill-advanced">
              <summary>
                <span>{t("Advanced")}</span>
                <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
              </summary>
              <div>
                <Button size="compact" onClick={() => onOpenProfile(profile.id)}>
                  {t("Open full Profile")}
                </Button>
                <Button size="compact" onClick={() => onBeginSetup("all")}>
                  {t("Create Profile from Agent")}
                </Button>
                <span>
                  {t("Detected via")}{" "}
                  {target.health.installationEvidence.map((item) => item.label).join(" · ") || t("None")}
                </span>
              </div>
            </details>
          </>
        )}
      </div>

      {preview ? (
        <PreviewDialog
          preview={preview}
          title={t("Apply {{profile}} to {{target}}?", {
            profile: profile?.manifest.name ?? t("Profile"),
            target: target.name
          })}
          confirmLabel={t("Apply")}
          confirmDisabled={
            applying ||
            preview.issues.some((issue) => issue.disposition === "block")
          }
          confirmBusy={applying}
          onCancel={applying ? undefined : onCancelPreview}
          onConfirm={onApply}
        />
      ) : null}

      {pendingChange ? (
        <ModalFrame
          ariaLabel={t("This Profile is shared")}
          className="agent-shared-profile-dialog ui-dialog-shell"
          dialogRef={sharedDialogRef}
          dismissDisabled={saving}
          onDismiss={() => setPendingChange(undefined)}
        >
          <header className="ui-dialog-header">
            <div className="ui-dialog-header__copy">
              <div className="ui-dialog-title">{t("This Profile is shared")}</div>
              <p className="ui-dialog-description">
                {t("{{profile}} is active on {{count}} Agents. Choose who receives this Skill change.", {
                  profile: profile?.manifest.name ?? t("Profile"),
                  count: sharedProfileTargetNames.length
                })}
              </p>
            </div>
          </header>
          <div className="agent-shared-profile-dialog__body ui-dialog-body">
            <span><strong>{t("Create a copy for {{name}}", { name: target.name })}</strong><small>{t("Recommended. Other Agents keep their current Profile.")}</small></span>
            <span><strong>{t("Update the shared Profile")}</strong><small>{sharedProfileTargetNames.join(" · ")}</small></span>
          </div>
          <footer className="ui-dialog-footer">
            <Button ref={sharedCancelRef} disabled={saving} onClick={() => setPendingChange(undefined)}>
              {t("Cancel")}
            </Button>
            <Button disabled={saving} onClick={() => commitSharedChange("shared")}>
              {t("Update shared Profile")}
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => commitSharedChange("fork")}>
              {t("Create {{name}} copy", { name: target.name })}
            </Button>
          </footer>
        </ModalFrame>
      ) : null}
    </section>
  );
};
