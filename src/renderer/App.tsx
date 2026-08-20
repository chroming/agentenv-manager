import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import {
  ArrowRight,
  CheckCircle2,
  History,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Settings2,
  TriangleAlert,
  X
} from "lucide-react";
import type {
  ApplyIssue,
  BackupSummary,
  DiagnosticIssueDetail,
  ProfileDetail,
  ProfileResourceMode,
  ProfileResources,
  ProfileSummary,
  ResourceIconKey,
  RollbackPreview,
  StopManagingMode,
  StopManagingPreview,
  AgentEnvSettings,
  AppLocale,
  GitHubSkillImportInput,
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  RepositorySkillImportInput,
  RepositorySkillImportResult,
  RepositorySkillScanResult,
  RepositorySkillSourceInput,
  LibraryResourceVersions,
  ManageTargetSkillInput,
  SkillInventoryEntry,
  SkillRuntimeIssue,
  SkillImportConflictResolution,
  SkillImportInput,
  SkillImportPreviewInput,
  SkillAvailabilityInput,
  SkillIconInput,
  SkillTagsInput,
  SkillCleanupRequest,
  SkillCleanupBackupSummary,
  SkillCleanupResult,
  SkillLibraryEntry,
  SkillSourceCandidateIgnoreInput,
  SkillSourceCheckAllResult,
  SkillSourceGroupView,
  SkillSourceNameInput,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult,
  SkillUpstream,
  SkillMergeInput,
  SkillMergePreview,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdatePreviewBatchResult,
  SkillUpdateSettingsInput,
  TargetDescriptor,
  TargetInfo,
  TargetCaptureDecision,
  TargetCapturePreview,
  TargetManagementState,
} from "../shared/types";
import { completeOrder, orderByPreference } from "../shared/uiState";
import { profileWithoutLocalSkillOverrides } from "../shared/effectiveProfile";
import { I18nProvider, useI18n } from "./i18n";
import { acceptAppliedProfileState } from "./appliedProfileState";
import { activationPreviewHasWork } from "./activationPreview";
import { formatDiagnosticIssue, parseDiagnosticErrorMessage } from "./diagnostics";
import { formatBytes } from "./formatBytes";
import { createSharedSkillMigrationActions } from "./sharedSkillMigrationActions";
import {
  createSkillManagerNavigation,
  type SkillManagerReturnContext
} from "./skillManagerNavigation";
import type { SkillManagementScope } from "../shared/skillCleanup";
import { collectLibraryResourceVersions, libraryResourceVersionsEqual } from "../shared/libraryVersions";
import { isTargetInstalled } from "../shared/targetHealth";
import { isExternalSkillImportable } from "../shared/skillIdentity";
import { AgentDiscoveryDialog } from "./components/AgentDiscoveryDialog";
import { AgentSettingsSection } from "./components/AgentSettingsSection";
import {
  AppFeedback,
  type AppFeedbackMessage
} from "./components/AppFeedback";
import { DiagnosticSettingsSection } from "./components/DiagnosticSettingsSection";
import { AppUpdateSettings } from "./components/AppUpdateSettings";
import { TelemetryConsentDialog } from "./components/TelemetryConsentDialog";
import { SkillManagementMigrationDialog } from "./components/SkillManagementMigrationDialog";
import { TelemetrySettings } from "./components/TelemetrySettings";
import { BackupManagerDialog } from "./components/BackupManagerDialog";
import { DataSettingsSection } from "./components/DataSettingsSection";
import { DiagnosticIssueDialog } from "./components/DiagnosticIssueDialog";
import { GitHubConnectionSettings } from "./components/GitHubConnectionSettings";
import { InfoTip } from "./components/InfoTip";
import {
  ConversationWorkspace,
  type ConversationWorkspaceViewState
} from "./components/ConversationWorkspace";
import { LibraryHeaderActions } from "./components/LibraryHeaderActions";
import { PreviewDialog } from "./components/PreviewDialog";
import { ProfileMcpEditor } from "./components/ProfileMcpEditor";
import { ProfileDeleteDialog } from "./components/ProfileDeleteDialog";
import { ProfileFormDialog } from "./components/ProfileFormDialog";
import { ProfileEvaluationDialog } from "./components/ProfileEvaluationDialog";
import {
  ProfileRecoveryDialog,
  type ProfileRecoveryMode
} from "./components/ProfileRecoveryDialog";
import { QuickOpen } from "./components/QuickOpen";
import { ProfileList } from "./components/ProfileList";
import { ResourceIcon } from "./components/ResourceIconPicker";
import { ProfileActionsMenu } from "./components/ProfileActionsMenu";
import { ProfileComposerSection } from "./components/ProfileComposerSection";
import { ProfileInstructionsComposerSection } from "./components/ProfileInstructionsComposerSection";
import { GeneralSettingsSection, SettingsCategoryTabs, type SettingsCategory } from "./components/SettingsCategoryTabs";
import {
  appShellClassName, ProfileSidebar, type AppWorkspace
} from "./components/ProfileSidebar";
import { AgentContextSwitcher } from "./components/AgentContextSwitcher";
import { InstructionsWorkspace } from "./components/InstructionsWorkspace";
import {
  SkillLibraryPanel
} from "./components/SkillLibraryPanel";
import {
  repositoryImportProgressKey,
  type PreparedSkillTarget,
  type SkillImportQueueOptions,
  type SkillUpdateActionResult,
  type SkillUpdateCheckStatus
} from "./skillLibraryContracts";
import { SkillUpdateDialog } from "./components/SkillUpdateDialog";
import {
  SkillImportConflictDialog,
  type PendingSkillImport
} from "./components/SkillImportConflictDialog";
import { SkillSettingsSection } from "./components/SkillSettingsSection";
import { ProfileSkillsComposerSection } from "./components/ProfileSkillsComposerSection";
import { TargetCaptureDialog } from "./components/TargetCaptureDialog";
import { TargetWorkspace } from "./components/TargetWorkspace";
import { WorkspaceSyncSettings } from "./components/WorkspaceSyncSettings";
import { createValidationRows } from "./profileValidationRows";
import { defaultProfileIconKey, ProductIcon } from "./productIcons";
import {
  updateAppliedTargetLibraryVersions,
  updateSkillInventoryAfterLibraryUpdate,
  updateProfileLibraryVersions
} from "./libraryUpdateState";
import { runSkillImportQueue } from "./skillImportQueue";
import { useSkillUpdateActivity, type SkillUpdateActivity } from "./skillUpdateActivity";
import { useSkillManagementMigration } from "./hooks/useSkillManagementMigration";
import {
  Button,
  ControlGroup,
  focusInitialActionMenuItem,
  IconButton,
  InspectorHeader,
  ObjectSwitcher,
  PageHeader,
  SingleObjectWorkspace,
  useDisclosureSet
} from "./components/ui";
import {
  deriveApplyActionLabel,
  deriveProfileComparisonControl,
  deriveProfileReadiness
} from "./profileReadiness";
import {
  defaultSkillLibraryViewState,
  updateLibraryScroll,
  updateSkillLibraryControls
} from "./libraryViewState";
import { useLibraryScrollRestoration } from "./hooks/useLibraryScrollRestoration";
import { useModalDialog } from "./hooks/useModalDialog";
import { useDesktopShortcuts } from "./hooks/useDesktopShortcuts";
import { useFreshnessCoordinator } from "./hooks/useFreshnessCoordinator";
import { useAutomaticSkillSourceChecks } from "./hooks/useAutomaticSkillSourceChecks";
import { useAgentDiscovery } from "./hooks/useAgentDiscovery";
import { useAgentRefresh } from "./hooks/useAgentRefresh";
import { useWorkspaceFreshness } from "./hooks/useWorkspaceFreshness";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import {
  ProjectsWorkspace,
} from "./components/ProjectsWorkspace";
import type { ProjectEditorGuard } from "./components/ProjectResourceEditorDialog";
import { useSidebarState } from "./hooks/useSidebarState";
import { useConversationQuickOpen } from "./hooks/useConversationQuickOpen";
import { useConversationIndexWarmup } from "./hooks/useConversationIndexWarmup";
import { useProfileActionGuard } from "./hooks/useProfileActionGuard";
import { useProfileDraftController } from "./hooks/useProfileDraftController";
import { useProfileActivationController } from "./hooks/useProfileActivationController";
import { useGitHubConnectionController } from "./hooks/useGitHubConnectionController";
import { useBackupRecoveryController } from "./hooks/useBackupRecoveryController";
import { useSettingsController } from "./hooks/useSettingsController";
import { useTelemetryConsent } from "./hooks/useTelemetryConsent";
import { useSkillUpdateQueue } from "./hooks/useSkillUpdateQueue";
import {
  projectSkillInventoryBoundary,
  useSkillCleanupBoundaries
} from "./hooks/useSkillCleanupBoundaries";
import { useNativeResourceInspection } from "./hooks/useNativeResourceInspection";
import { useRemoteEndpoints } from "./hooks/useRemoteEndpoints";
import { useWindowChromeState } from "./hooks/useWindowChromeState";
import { useDeviceUiState } from "./hooks/useDeviceUiState";
import { loadProfileCoreData } from "./profileCoreLoader";
import { deriveProfileEndpointContext } from "./profileEndpointContext";
import { WindowTitlebar } from "./components/WindowTitlebar";
import {
  preferredTargetForProfile,
  profileDeploymentStatusLabels,
  summarizeProfileApplications,
  summarizeProfile
} from "./profileSummary";
import { buildQuickOpenItems } from "./quickOpenItems";
import {
  reconcileImportedSkillUpdates,
  summarizeSkillUpdateChecks,
  summarizeSkillUpdateResult,
  updatesFromSourceGroups
} from "./skillUpdateSummary";
import {
  monitoredSkillSourcesDue,
  oldestMonitoredSkillCheckAt
} from "./freshness";
import {
  deriveEnvironmentReview,
  type EnvironmentScanStatus
} from "./environmentReview";
import { deriveAgentSetupAction, deriveAgentSetupActions } from "./agentSetup";
import { useInstructionLibrary } from "./hooks/useInstructionLibrary";

const emptyProfileResources: ProfileResources = {
  instructions: [],
  skills: [],
  managementByTarget: {},
  mcpByTarget: {}
};

type ComposerSection = "instructions" | "skills" | "mcp";
type ProfileDialogMode = "create" | "edit";
type ProfileCreateSource = "blank" | "target";

type ProfileCaptureOrigin = "profiles" | "targets";
type ProfileCaptureActivity = "idle" | "reviewing" | "creating";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export { AppFeedback };

const isGitHubRateLimitError = (message: string) =>
  /github.*(?:rate limit|api limit)|(?:rate limit|api limit).*github/i.test(message);

const AppContent = ({
  onLocalePreferenceChange
}: {
  onLocalePreferenceChange(locale: AppLocale): void;
}) => {
  const { t, formatDate } = useI18n();
  const windowChromeFullScreen = useWindowChromeState();
  const [supportedTargets, setSupportedTargets] = useState<TargetDescriptor[]>([]);
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [targetStates, setTargetStates] = useState<TargetManagementState[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [librarySkills, setLibrarySkills] = useState<SkillLibraryEntry[]>([]);
  const [skillSourceGroups, setSkillSourceGroups] = useState<SkillSourceGroupView[]>([]);
  const [skillLibraryMode, setSkillLibraryMode] = useState<"skills" | "sources">("skills");
  const [skillUpdates, setSkillUpdates] = useState<SkillUpdateInfo[]>([]);
  const [skillInventory, setSkillInventory] = useState<SkillInventoryEntry[]>([]);
  const [skillInventoryIssues, setSkillInventoryIssues] = useState<SkillRuntimeIssue[]>([]);
  const [environmentScanStatus, setEnvironmentScanStatus] =
    useState<EnvironmentScanStatus>("checking");
  const [skillInventoryRefreshing, setSkillInventoryRefreshing] = useState(false);
  const [skillCleanupBackups, setSkillCleanupBackups] = useState<SkillCleanupBackupSummary[]>([]);
  const [skillCleanupResult, setSkillCleanupResult] = useState<SkillCleanupResult>();
  const [pendingSkillImport, setPendingSkillImport] = useState<PendingSkillImport>();
  const [selectedSkillUpdatePlan, setSelectedSkillUpdatePlan] = useState<SkillUpdatePlan>();
  const [bulkSkillUpdatePlans, setBulkSkillUpdatePlans] = useState<SkillUpdatePlan[]>();
  const [bulkSkillUpdateFailures, setBulkSkillUpdateFailures] = useState<
    SkillUpdatePreviewBatchResult["failed"]
  >([]);
  const skillUpdateQueue = useSkillUpdateQueue();
  const [profileLibraryVersions, setProfileLibraryVersions] = useState<
    Record<string, LibraryResourceVersions>
  >({});
  const [skillUsage, setSkillUsage] = useState<Record<string, string[]>>({});
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [profileTargetSelections, setProfileTargetSelections] = useState<Record<string, string>>({});
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview>();
  const [stopManagingPreview, setStopManagingPreview] = useState<StopManagingPreview>();
  const [rollbackError, setRollbackError] = useState<string>();
  const {
    activeWorkspace,
    openWorkspaceNow
  } = useWorkspaceNavigation();
  const { sidebarCollapsed, toggleSidebar } = useSidebarState();
  const [conversationViewState, setConversationViewState] = useState<ConversationWorkspaceViewState>();
  const [projectEditorGuard, setProjectEditorGuard] = useState<ProjectEditorGuard>();
  const [projectOpenRequest, setProjectOpenRequest] = useState<{ requestId: number; projectId: string }>();

  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general");
  const [quickOpen, setQuickOpen] = useState(false);
  const [skillLibraryViewState, setSkillLibraryViewState] = useState(
    defaultSkillLibraryViewState
  );
  const [skillLibraryTool, setSkillLibraryTool] = useState<"import" | "discoveries">();
  const [skillCleanupScope, setSkillCleanupScope] =
    useState<SkillManagementScope>({ kind: "all" });
  const [skillManagerOriginTargetId, setSkillManagerOriginTargetId] = useState<string>();
  const skillManagerReturnRef = useRef<SkillManagerReturnContext | undefined>(undefined);
  const [skillCollectionFocusPath, setSkillCollectionFocusPath] = useState<string>();
  const [skillUpdateCheckStatus, setSkillUpdateCheckStatus] =
    useState<SkillUpdateCheckStatus>();
  const [skillUpdateFeedbackWorkspace, setSkillUpdateFeedbackWorkspace] =
    useState<"library" | "profiles" | "targets">("library");
  const [checkingProfileSkillUpdates, setCheckingProfileSkillUpdates] = useState(false);
  const [profileMetadataSavingId, setProfileMetadataSavingId] = useState<string>();
  const [profileSearch, setProfileSearch] = useState("");
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);
  const {
    clearExpandedIds: clearComposerSections,
    expandId: expandComposerSection,
    isExpanded: composerSectionIsExpanded,
    replaceExpandedIds: replaceComposerSections,
    toggleExpandedId: toggleComposerSection
  } = useDisclosureSet<ComposerSection>();
  const [isTargetMenuOpen, setIsTargetMenuOpen] = useState(false);
  const [targetMenuQuery, setTargetMenuQuery] = useState("");
  const [isProfileActionsOpen, setIsProfileActionsOpen] = useState(false);
  const [profileRecoveryMode, setProfileRecoveryMode] = useState<ProfileRecoveryMode>();
  const [profileDialogMode, setProfileDialogMode] = useState<ProfileDialogMode>();
  const [profileEvaluationOpen, setProfileEvaluationOpen] = useState(false);
  const [profileCreateSource, setProfileCreateSource] = useState<ProfileCreateSource>("blank");
  const [profileCaptureOrigin, setProfileCaptureOrigin] = useState<ProfileCaptureOrigin>("profiles");
  const [profileCaptureScope, setProfileCaptureScope] =
    useState<"all" | "skills">("all");
  const [profileCaptureActivity, setProfileCaptureActivity] = useState<ProfileCaptureActivity>("idle");
  const [targetCapturePreview, setTargetCapturePreview] = useState<TargetCapturePreview>();
  const [targetCaptureDecisions, setTargetCaptureDecisions] = useState<TargetCaptureDecision[]>([]);
  const [profileCaptureStatus, setProfileCaptureStatus] = useState("");
  const [profileCaptureError, setProfileCaptureError] = useState("");
  const [profileFormError, setProfileFormError] = useState("");
  const [profileForm, setProfileForm] = useState({
    targetId: "",
    name: "",
    description: ""
  });
  const [deleteProfileCandidateId, setDeleteProfileCandidateId] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [diagnosticIssue, setDiagnosticIssue] = useState<DiagnosticIssueDetail>();
  const remote = useRemoteEndpoints({
    targets, supportedTargets, setTargetStates, enabled: !isLoading,
    sharedSkillsLabel: t("Shared Skills"), onError: setError
  });
  const { profileTargets, targetNames } = remote;
  const { acceptUiState, currentUiState, persistUiState, uiState } = useDeviceUiState(setError);
  const {
    nativeMcpConnections,
    nativeMcpIssues,
    nativeInstructionSnapshots,
    nativeInstructionIssues,
    setNativeMcpConnections,
    setNativeMcpIssues,
    refreshNativeResources,
    loadForProfileCore
  } = useNativeResourceInspection({ setError });
  useConversationIndexWarmup(!isLoading);
  const profileObjectActionsRef = useRef<HTMLDivElement>(null);
  const profileApplyControlRef = useRef<HTMLDivElement>(null);
  const profileActionsButtonRef = useRef<HTMLButtonElement>(null);
  const profileActionsMenuRef = useRef<HTMLDivElement>(null);
  const profileSearchInputRef = useRef<HTMLInputElement>(null);
  const skillSearchInputRef = useRef<HTMLInputElement>(null);
  const dataRefreshRequestRef = useRef(0);
  const skillUpdateResultRevisionRef = useRef(0);
  const rollbackReturnFocusRef = useRef<HTMLElement | null>(null);
  const appModalDialogRef = useRef<HTMLElement>(null);
  const appModalInitialFocusRef = useRef<HTMLButtonElement>(null);
  const appModalFallbackFocusRef = useRef<HTMLElement>(null);
  const resetProfileActivationRef = useRef<() => void>(() => undefined);
  const invalidateProfilePresentation = useCallback(() => {
    setSkillUpdateCheckStatus(undefined);
    setRollbackPreview(undefined);
    resetProfileActivationRef.current();
  }, []);
  const {
    acceptProfile: acceptSelectedProfile,
    acceptProfileMetadata,
    beginFlow: beginProfileFlow,
    clearProfile: clearSelectedProfile,
    discardDraft: discardProfileDraft,
    draftProfile,
    isDirty: isProfileDirty,
    isFlowCurrent: isProfileFlowCurrent,
    isSaving: isProfileSaving,
    profileLoadingId,
    replaceSavedProfile,
    saveDraft,
    saveSelectedProfile,
    selectProfile: loadSelectedProfile,
    selectedProfileId,
    setStatus: setProfileSaveStatus,
    status: profileSaveStatus,
    updateDraft: updateDraftProfile
  } = useProfileDraftController({
    profiles,
    targets,
    librarySkills,
    profileLibraryVersions,
    setProfiles,
    setProfileLibraryVersions,
    setSkillUsage,
    setTargetStates,
    onBusyChange: setBusy,
    onError: setError,
    onDraftInvalidated: invalidateProfilePresentation,
    onSelectionChange: (profileId) => {
      if (currentUiState().selectedProfileId !== profileId) {
        persistUiState({ selectedProfileId: profileId });
      }
    }
  });
  const {
    applyProfile: applyProfileActivation,
    clearPreview: clearProfilePreview,
    clearRefreshDetail: clearProfileApplyRefreshDetail,
    isApplying: isProfileApplying,
    isPreviewing: isProfilePreviewing,
    preview,
    previewProfile: runProfilePreview,
    refreshDetail: profileApplyRefreshDetail,
    refreshPreview: refreshProfilePreview,
    reset: resetProfileActivation
  } = useProfileActivationController({
    onApplied: (profile, appliedPreview) => {
      acceptAppliedProfileState({
        profile,
        preview: appliedPreview,
        setTargetStates,
        setBackups,
        setSkillInventory
      });
    },
    onBusyChange: setBusy,
    onError: setError,
    onRollbackClear: () => setRollbackPreview(undefined),
    onStatus: setProfileSaveStatus,
    onTargetsRefresh: setTargets,
    onTargetStatesRefresh: (states) => setTargetStates((current) => [
      ...states,
      ...current.filter((state) => state.targetId.startsWith("ssh:"))
    ]),
    translate: t
  });
  resetProfileActivationRef.current = resetProfileActivation;
  const settingsController = useSettingsController({
    onBackupRetentionChanged: () => backupRecovery.actions.refreshManagedBackups("mutation"),
    onBusyChange: setBusy,
    onError: setError,
    onLocaleChange: onLocalePreferenceChange,
    onTargetSettingsChanged: async (nextSettings) => {
      clearProfilePreview();
      setRollbackPreview(undefined);
      await refreshProfiles({
        checkSkillUpdates: false,
        forceTargetRefresh: true,
        settingsOverride: nextSettings
      });
    }
  });
  const skillSettings = settingsController.state.settings;
  const settingsSaveStatus = settingsController.state.status;
  const updateSkillSettings = settingsController.actions.update;
  const telemetryConsent = useTelemetryConsent({
    isLoading,
    settings: skillSettings,
    onAccepted: settingsController.actions.accept,
    onError: setError
  });
  const skillManagementMigration = useSkillManagementMigration({
    inventory: skillInventory,
    isLoading: isLoading || environmentScanStatus === "checking",
    telemetryOpen: telemetryConsent.open
  });
  const { activity: skillUpdateActivity, activityRef: skillUpdateActivityRef,
    begin: beginSkillUpdateActivity, finish: finishSkillUpdateActivity
  } = useSkillUpdateActivity(() => undefined);
  const {
    states: freshnessStates,
    markFresh,
    run: runFreshness
  } = useFreshnessCoordinator();
  const activeLibraryView =
    activeWorkspace === "library" && skillLibraryMode === "skills" ? "skills" : undefined;
  const refreshSkillSourceGroups = useCallback(async (): Promise<boolean> => {
    try {
      setSkillSourceGroups(await window.agentEnv.listSkillSourceGroups());
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    }
  }, []);
  const libraryScroll = useLibraryScrollRestoration({
    activeView: activeLibraryView,
    scrollTop: activeLibraryView === "skills" ? skillLibraryViewState.scrollTop : 0,
    restoreKey: activeLibraryView === "skills" ? librarySkills : activeWorkspace,
    onScrollTopChange: (scrollTop) => {
      if (activeLibraryView === "skills") {
        setSkillLibraryViewState((current) => updateLibraryScroll(current, scrollTop));
      }
    }
  });

  useEffect(() => {
    if (rollbackPreview || busy) {
      return;
    }
    const returnFocus = rollbackReturnFocusRef.current;
    if (returnFocus?.isConnected) {
      returnFocus.focus();
    }
    rollbackReturnFocusRef.current = null;
  }, [busy, rollbackPreview]);

  useEffect(() => {
    if (!skillUpdateCheckStatus || !["success", "info"].includes(skillUpdateCheckStatus.state)) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setSkillUpdateCheckStatus(undefined), 5000);
    return () => window.clearTimeout(timeout);
  }, [skillUpdateCheckStatus]);

  const loadSkillCleanupHistory = async (
    shouldApply: () => boolean = () => true
  ) => {
    try {
      const cleanupBackupItems = await window.agentEnv.listSkillCleanupBackups();
      if (shouldApply()) {
        setSkillCleanupBackups(cleanupBackupItems);
      }
      return cleanupBackupItems;
    } catch (unknownError) {
      console.warn(
        `[AgentEnv] Cleanup history is unavailable: ${
          unknownError instanceof Error ? unknownError.message : String(unknownError)
        }`
      );
      return [];
    }
  };

  const loadTargetRecoveryHistory = async (
    shouldApply: () => boolean = () => true
  ) => {
    try {
      const backupItems = await window.agentEnv.listBackups();
      if (shouldApply()) {
        setBackups(backupItems);
      }
      return backupItems;
    } catch (unknownError) {
      console.warn(
        `[AgentEnv] Target recovery history is unavailable: ${
          unknownError instanceof Error ? unknownError.message : String(unknownError)
        }`
      );
      return [];
    }
  };

  const loadProfileCore = async (
    settingsOverride?: AgentEnvSettings,
    shouldApply: () => boolean = () => true,
    forceTargetRefresh = false
  ) => {
    loadForProfileCore(shouldApply);
    void loadSkillCleanupHistory(shouldApply);
    void loadTargetRecoveryHistory(shouldApply);
    const core = await loadProfileCoreData({
      forceTargetRefresh,
      settingsOverride,
      onSkillsLoaded: (items) => {
        if (shouldApply()) setLibrarySkills(items);
      }
    });
    if (!shouldApply()) return core;
    acceptUiState(core.uiState);
    setSupportedTargets(core.supportedTargetItems);
    setTargets(core.targetItems);
    setTargetStates(
      core.targetStateItems.map((targetState) => ({
        ...targetState,
        activeProfileName:
          core.profileItems.find((profile) => profile.id === targetState.activeProfileId)?.name ??
          targetState.activeProfileName
      }))
    );
    setProfiles(core.profileItems);
    settingsController.actions.accept(core.settings);
    markFresh("agents");
    markFresh("skill-library");
    setSelectedTargetId((current) =>
      current && core.targetItems.some((target) => target.id === current)
        ? current
        : core.targetItems[0]?.id
    );
    return core;
  };

  const loadProfileEnrichment = async (
    core: Awaited<ReturnType<typeof loadProfileCore>>,
    checkSkillUpdates: boolean,
    shouldApply: () => boolean = () => true,
    forceSkillUpdateCheck = false
  ) => {
    if (shouldApply()) {
      setEnvironmentScanStatus("checking");
    }
    const skillUpdateResultRevision = skillUpdateResultRevisionRef.current;
    const {
      supportedTargetItems,
      targetItems,
      profileItems,
      skillItems,
      settings
    } = core;
    const [sourceChecksResult, skillInventoryResult, githubStatusResult] =
      await Promise.allSettled([
        checkSkillUpdates
          ? window.agentEnv.listSkillSourceGroups().then(async (groups) => {
              const shouldCheck =
                settings.skillAutoCheckEnabled &&
                (
                  forceSkillUpdateCheck ||
                  monitoredSkillSourcesDue({
                    groups,
                    intervalMinutes: settings.skillAutoCheckIntervalMinutes,
                    now: Date.now()
                  })
                );
              return {
                checked: shouldCheck
                  ? (
                      await runFreshness(
                        "skill-upstreams",
                        "startup",
                        () => window.agentEnv.checkMonitoredSkillSourceGroups(),
                        {
                          force: true,
                          partialError: (value) => {
                            const result = value as SkillSourceCheckAllResult;
                            return result.failed > 0
                              ? `${result.failed} source checks failed`
                              : undefined;
                          }
                        }
                      )
                    ).value
                  : undefined,
                groups
              };
            })
          : Promise.resolve(undefined),
        runFreshness(
          "local-skills",
          "startup",
          () => window.agentEnv.scanSkillInventory(),
          { force: true }
        ).then((outcome) => outcome.value ?? { entries: [], issues: [] }),
        window.agentEnv.readGitHubAuthStatus()
      ]);
    const sourceLoad = sourceChecksResult.status === "fulfilled"
      ? sourceChecksResult.value
      : undefined;
    const checkedSources = sourceLoad?.checked;
    const loadedSourceGroups = checkedSources?.groups ?? sourceLoad?.groups;
    const skillUpdateItems = loadedSourceGroups
      ? updatesFromSourceGroups(loadedSourceGroups, skillItems)
      : skillUpdates;
    const githubStatus =
      githubStatusResult.status === "fulfilled"
        ? githubStatusResult.value
        : {
            state: "configured" as const,
            error: "GitHub is temporarily unavailable. Local resources are still available."
          };
    const profileDetails = await Promise.all(
      profileItems
        .filter((profile) => !profile.loadError)
        .map((profile) => window.agentEnv.readProfile(profile.id))
    );
    const usage: Record<string, string[]> = {};
    const nextProfileLibraryVersions: Record<string, LibraryResourceVersions> = {};
    for (const profile of profileDetails) {
      const profileTarget = supportedTargetItems.find(
        (targetItem) => targetItem.id === profile.manifest.preferredTargetId
      ) ?? supportedTargetItems[0];
      nextProfileLibraryVersions[profile.id] = collectLibraryResourceVersions(
        profile,
        skillItems,
        profileTarget?.id
      );
      for (const skillRef of profile.resources.skills) {
        usage[skillRef.libraryId] = (usage[skillRef.libraryId] ?? []).concat(
          profile.manifest.name
        );
      }
    }
    if (!shouldApply()) {
      return { skillUpdateItems };
    }
    if (skillUpdateResultRevision === skillUpdateResultRevisionRef.current) {
      setSkillUpdates(skillUpdateItems);
      if (loadedSourceGroups) setSkillSourceGroups(loadedSourceGroups);
    }
    if (skillInventoryResult.status === "fulfilled") {
      setSkillInventory(skillInventoryResult.value.entries);
      setSkillInventoryIssues(skillInventoryResult.value.issues);
      setEnvironmentScanStatus("ready");
      markFresh("local-skills");
    } else {
      setEnvironmentScanStatus("error");
      console.warn(
        `[AgentEnv] Local Skill inventory is unavailable: ${
          skillInventoryResult.reason instanceof Error
            ? skillInventoryResult.reason.message
            : String(skillInventoryResult.reason)
        }`
      );
    }
    githubConnection.actions.acceptAuthStatus(githubStatus);
    if (checkedSources) {
      markFresh("skill-upstreams", {
        error: checkedSources.failed > 0
          ? `${checkedSources.failed} source checks failed`
          : undefined,
        status: checkedSources.failed > 0 ? "partial" : "ready"
      });
    } else if (loadedSourceGroups) {
      const checkedAt = oldestMonitoredSkillCheckAt(loadedSourceGroups);
      if (checkedAt !== undefined) {
        markFresh("skill-upstreams", { at: checkedAt });
      }
    }
    setSkillUsage(usage);
    setProfileLibraryVersions(nextProfileLibraryVersions);
    return { skillUpdateItems };
  };

  const refreshProfiles = async ({
    checkSkillUpdates = false,
    forceSkillUpdateCheck = false,
    forceTargetRefresh = false,
    settingsOverride
  }: {
    checkSkillUpdates?: boolean;
    forceSkillUpdateCheck?: boolean;
    forceTargetRefresh?: boolean;
    settingsOverride?: AgentEnvSettings;
  } = {}) => {
    const requestId = ++dataRefreshRequestRef.current;
    const shouldApply = () => dataRefreshRequestRef.current === requestId;
    const core = await loadProfileCore(
      settingsOverride,
      shouldApply,
      forceTargetRefresh
    );
    const enrichment = await loadProfileEnrichment(
      core,
      checkSkillUpdates || forceSkillUpdateCheck,
      shouldApply,
      forceSkillUpdateCheck
    );
    return { ...core, ...enrichment };
  };

  const refreshInstructionDependents = async () => {
    const profileId = selectedProfileId;
    await refreshProfiles({ checkSkillUpdates: false });
    if (profileId) {
      await loadSelectedProfile(profileId);
    }
  };
  const {
    blocks: instructionBlocks,
    loading: instructionBlocksLoading,
    refresh: refreshInstructionBlocks,
    create: createInstructionBlock,
    update: updateInstructionBlock,
    remove: removeInstructionBlock
  } = useInstructionLibrary(refreshInstructionDependents);

  const refreshWorkspaceStateAfterSync = () => {
    const profileId = selectedProfileId;
    void refreshProfiles({ checkSkillUpdates: false })
      .then(async ({ profileItems }) => {
        const selectedSummary = (
          profileId ? profileItems.find((item) => item.id === profileId) : undefined
        ) ?? profileItems.find((item) => !item.loadError);
        if (!selectedSummary || selectedSummary.loadError) {
          clearSelectedProfile();
          return;
        }
        acceptSelectedProfile(await window.agentEnv.readProfile(selectedSummary.id));
        invalidateProfilePresentation();
      })
      .catch((unknownError) => {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
  };

  const backupRecovery = useBackupRecoveryController({
    activeWorkspace,
    onBusyChange: setBusy,
    onError: setError,
    onRestoreApplied: async () => {
      clearSelectedProfile();
      const refreshed = await refreshProfiles();
      const firstProfile = refreshed.profileItems.find((profile) => !profile.loadError);
      if (firstProfile) {
        setSelectedTargetId(firstProfile.preferredTargetId ?? targets[0]?.id);
        acceptSelectedProfile(await window.agentEnv.readProfile(firstProfile.id));
      }
    },
    runFreshness,
    translate: t
  });
  const {
    backupCleanupConfirm,
    backupDeleteCandidate,
    backupManagerNotice,
    backupManagerOpen,
    backupPreviewCandidate,
    dataBackupStatus,
    dataRestorePreview,
    managedBackupPreview,
    managedBackupPreviewLoading,
    managedBackups,
    managedBackupsLoading,
    managerReturnFocusRef: backupManagerReturnFocusRef,
    restoreReturnFocusRef: dataRestoreReturnFocusRef
  } = backupRecovery.state;

  const githubConnection = useGitHubConnectionController({
    onError: setError,
    onOpenPage: (url) => window.agentEnv.openGitHubDevicePage(url),
    onRefresh: () => refreshProfiles(),
    onStatusReset: settingsController.actions.clearStatus
  });
  const {
    authStatus: githubAuthStatus,
    codeCopied: githubCodeCopied,
    deviceLogin: githubDeviceLogin,
    loginChecking: githubLoginChecking,
    loginMessage: githubLoginMessage
  } = githubConnection.state;

  const refreshSkills = async (
    reason: "page-entry" | "focus" | "mutation" | "manual" = "manual"
  ) => {
    const announce = reason === "manual";
    if (announce) setError(undefined);
    try {
      await runFreshness("skill-library", reason, async () => {
        setEnvironmentScanStatus("checking");
        const inventoryPromise = runFreshness(
          "local-skills",
          reason,
          () => window.agentEnv.scanSkillInventory()
        ).then((outcome) => outcome.value ?? {
          entries: skillInventory,
          issues: skillInventoryIssues
        });
        void inventoryPromise.then(
          () => setEnvironmentScanStatus("ready"),
          () => setEnvironmentScanStatus("error")
        );
        const [skillItems, inventoryItems, , sourceGroupItems] =
          await Promise.all([
            window.agentEnv.listSkillLibrary(),
            inventoryPromise,
            loadSkillCleanupHistory(),
            window.agentEnv.listSkillSourceGroups()
          ]);
        setLibrarySkills(skillItems);
        setSkillInventory(inventoryItems.entries);
        setSkillInventoryIssues(inventoryItems.issues);
        setEnvironmentScanStatus("ready");
        setSkillSourceGroups(sourceGroupItems);
        return skillItems;
      });
    } catch (unknownError) {
      if (announce) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    }
  };

  const commitSkillUpdates = (next: SetStateAction<SkillUpdateInfo[]>) => {
    skillUpdateResultRevisionRef.current += 1;
    setSkillUpdates(next);
  };

  const replaceLibrarySkillLocally = (
    updated: SkillLibraryEntry,
    options: { invalidateUpdateCheck?: boolean } = {}
  ) => {
    setLibrarySkills((current) =>
      current.some((skill) => skill.id === updated.id)
        ? current.map((skill) => (skill.id === updated.id ? updated : skill))
        : current.concat(updated)
    );
    if (options.invalidateUpdateCheck) {
      commitSkillUpdates((current) =>
        current.filter((item) => item.id !== updated.id));
      setSelectedSkillUpdatePlan((current) =>
        current?.id === updated.id ? undefined : current
      );
    }
  };

  const applyLibraryContentUpdatesLocally = (
    updatedSkills: SkillLibraryEntry[],
    syncCopiedInstalls: boolean
  ) => {
    if (updatedSkills.length === 0) return;
    const updatesById = new Map(updatedSkills.map((skill) => [skill.id, skill]));
    setLibrarySkills((current) =>
      current.map((skill) => updatesById.get(skill.id) ?? skill)
    );
    setSkillInventory((current) => {
      const next = updateSkillInventoryAfterLibraryUpdate(current, updatedSkills);
      return syncCopiedInstalls
        ? next.map((item) => {
          const updated = item.libraryId ? updatesById.get(item.libraryId) : undefined;
          return updated && item.installMethod === "copied"
            ? { ...item, contentHash: updated.contentHash, contentMatchesLibrary: true }
            : item;
        })
        : next;
    });
    commitSkillUpdates((current) => [
      ...current.filter((item) => !updatesById.has(item.id)),
      ...updatedSkills
        .filter((skill) => skill.updatePolicy === "tracked")
        .map((skill): SkillUpdateInfo => ({
          id: skill.id,
          name: skill.name,
          sourceType: skill.sourceType,
          currentRevision: skill.remoteRevision ?? skill.contentHash,
          latestRevision: skill.remoteRevision ?? skill.contentHash,
          latestUpdatedAt: skill.upstream?.updatedAt,
          updateAvailable: false
        }))
    ]);
    setProfileLibraryVersions((current) =>
      updateProfileLibraryVersions(current, updatedSkills));
    setTargetStates((current) =>
      updateAppliedTargetLibraryVersions(
        current,
        updatedSkills,
        skillInventory,
        syncCopiedInstalls
      ));
  };

  const refreshTrackedSkillUpdateLocally = (skill: SkillLibraryEntry) => {
    if (skill.updatePolicy !== "tracked") return;
    void window.agentEnv
      .checkSkillLibraryUpdates([skill.id])
      .then((updates) => {
        commitSkillUpdates((current) => [
          ...current.filter((item) => item.id !== skill.id),
          ...updates
        ]);
      })
      .catch((unknownError) => {
        commitSkillUpdates((current) => [
          ...current.filter((item) => item.id !== skill.id),
          {
            id: skill.id,
            name: skill.name,
            sourceType: skill.sourceType,
            updateAvailable: false,
            error:
              unknownError instanceof Error
                ? unknownError.message
                : String(unknownError)
          }
        ]);
      });
  };

  useEffect(() => {
    let isMounted = true;
    const requestId = ++dataRefreshRequestRef.current;
    const shouldApply = () => isMounted && dataRefreshRequestRef.current === requestId;

    loadProfileCore(undefined, shouldApply)
      .then(async (core) => {
        if (!shouldApply()) {
          return;
        }

        setIsLoading(false);
        void refreshInstructionBlocks().catch((unknownError) => {
          if (shouldApply()) {
            setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
          }
        });
        void probeSupportedAgents();
        void loadProfileEnrichment(core, true, shouldApply).catch((unknownError) => {
          if (shouldApply()) {
            setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
          }
        });

        const { profileItems, targetItems, targetStateItems, uiState: loadedUiState } = core;
        const usableProfiles = profileItems.filter((profile) => !profile.loadError);
        if (usableProfiles.length === 0) {
          return;
        }

        const initialTarget =
          targetItems.find(
            (target) =>
              isTargetInstalled(target.health) &&
              targetStateItems.some(
                (state) => state.targetId === target.id && Boolean(state.activeProfileId)
              )
          ) ?? targetItems.find((target) => isTargetInstalled(target.health)) ?? targetItems[0];
        const initialTargetId = initialTarget?.id;
        const activeProfileId = targetStateItems.find(
          (state) => state.targetId === initialTargetId
        )?.activeProfileId;
        const initialProfile =
          usableProfiles.find((profile) => profile.id === loadedUiState.selectedProfileId) ??
          usableProfiles.find((profile) => profile.id === activeProfileId) ??
          usableProfiles.find(
            (profile) => !initialTargetId || profile.preferredTargetId === initialTargetId
          ) ??
          usableProfiles[0];
        const initialProfileTargetId =
          initialTargetId ?? initialProfile.preferredTargetId ?? targetItems[0]?.id;
        setSelectedTargetId(initialProfileTargetId);
        setProfileTargetSelections({ [initialProfile.id]: initialProfileTargetId });
        replaceComposerSections(activeProfileId === initialProfile.id ? ["skills"] : []);
        const requestId = beginProfileFlow();
        const profile = await window.agentEnv.readProfile(initialProfile.id);
        if (isMounted && isProfileFlowCurrent(requestId)) {
          acceptSelectedProfile(profile);
        }
      })
      .catch((unknownError) => {
        if (isMounted) {
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      if (dataRefreshRequestRef.current === requestId) {
        dataRefreshRequestRef.current += 1;
      }
    };
  }, []);

  useAutomaticSkillSourceChecks({
    activityRef: skillUpdateActivityRef,
    enabled: !isLoading && skillSettings.skillAutoCheckEnabled,
    groups: skillSourceGroups,
    intervalMinutes: skillSettings.skillAutoCheckIntervalMinutes,
    lastCheckAt: freshnessStates["skill-upstreams"].lastAttemptAt,
    runFreshness,
    onResult: (result) => {
      setSkillSourceGroups(result.groups);
      syncSkillUpdatesFromSourceGroups(result.groups);
    }
  });

  const {
    cancelPendingAction: cancelPendingProfileAction,
    continuePendingAction: continuePendingProfileAction,
    guardAction: guardProfileAction,
    pendingAction: pendingProfileAction
  } = useProfileActionGuard({
    autoSaveDirty:
      !projectEditorGuard?.dirty &&
      profileSaveStatus !== "Profile save failed" &&
      (isProfileDirty || isProfileSaving),
    dirty:
      Boolean(projectEditorGuard?.dirty) ||
      (profileSaveStatus === "Profile save failed" && isProfileDirty),
    onBusyChange: setBusy,
    onDiscard: projectEditorGuard?.dirty ? projectEditorGuard.discard : discardProfileDraft,
    onError: setError,
    onSave: async () => {
      if (projectEditorGuard?.dirty) await projectEditorGuard.save();
      if (isProfileDirty || isProfileSaving) await saveDraft();
    }
  });
  const conversationQuickOpen = useConversationQuickOpen({
    targets, t, formatDate, guardAction: guardProfileAction,
    captureScroll: libraryScroll.captureScroll, openWorkspaceNow
  });

  const selectProfileNow = async (
    profileId: string,
    composerSection?: ComposerSection,
    targetOverrideId?: string
  ) => {
    replaceComposerSections(composerSection ? [composerSection] : []);
    openWorkspaceNow("profiles");
    await loadSelectedProfile(profileId, {
      onBeforeLoad: () => {
        clearProfilePreview();
        setRollbackPreview(undefined);
      },
      onLoaded: (profile) => {
        const profileTargetId =
          targetOverrideId ??
          preferredTargetForProfile(
            profile.id,
            profile.manifest.preferredTargetId,
            targetStates,
            targets,
            profileTargetSelections[profile.id]
          );
        setSelectedTargetId(profileTargetId);
        if (profileTargetId) {
          setProfileTargetSelections((current) => ({
            ...current,
            [profile.id]: profileTargetId
          }));
        }
      }
    });
  };

  const reorderProfiles = (profileIds: string[]) => {
    const order = completeOrder(profileIds, profiles.map((profile) => profile.id));
    setProfiles((current) => orderByPreference(current, order, (profile) => profile.id));
    persistUiState({ profileOrder: order });
  };

  const selectWorkspace = useCallback((workspace: AppWorkspace) => {
    if (workspace === activeWorkspace) {
      return;
    }
    const label = {
      library: "open Skills",
      instructions: "open Instructions",
      projects: "open Projects",
      profiles: "open Profiles",
      conversations: "open Conversations",
      targets: "open Agents",
      settings: "open Settings"
    }[workspace];
    guardProfileAction(label, () => {
      libraryScroll.captureScroll();
      if (workspace === "library") {
        setSkillUpdateFeedbackWorkspace("library");
      }
      openWorkspaceNow(workspace);
    });
  }, [
    activeWorkspace,
    guardProfileAction,
    libraryScroll.captureScroll,
    openWorkspaceNow
  ]);

  useEffect(
    () => window.agentEnv.onOpenSettingsRequested(() => {
      selectWorkspace("settings");
    }),
    [selectWorkspace]
  );

  const selectProfile = (
    profileId: string,
    composerSection?: ComposerSection,
    targetOverrideId?: string
  ) => {
    const summary = profiles.find((profile) => profile.id === profileId);
    if (summary?.loadError) {
      setError(t("Profile {{name}} needs repair: {{error}}", {
        name: summary.name,
        error: summary.loadError
      }));
      return;
    }
    if (profileId === selectedProfileId) {
      if (targetOverrideId) {
        setSelectedTargetId(targetOverrideId);
        setProfileTargetSelections((current) => ({
          ...current,
          [profileId]: targetOverrideId
        }));
      }
      openWorkspaceNow("profiles");
      if (composerSection) expandComposerSection(composerSection);
      return;
    }
    const profileName = profiles.find((profile) => profile.id === profileId)?.name ?? "profile";
    guardProfileAction(`switch to ${profileName}`, () =>
      selectProfileNow(profileId, composerSection, targetOverrideId)
    );
  };

  const openAgentConfiguration = (targetId: string) => {
    const targetName =
      targets.find((target) => target.id === targetId)?.name ?? "Agent";
    const setupAction = deriveAgentSetupAction(targetId, profiles, targetStates);

    if (setupAction.kind !== "review-current") {
      selectProfile(setupAction.profileId, undefined, targetId);
      return;
    }
    guardProfileAction(`configure ${targetName}`, () => {
      openCreateFromTargetDialogNow(targetId, "all");
    });
  };

  const prepareSkillImport = async (
    source: SkillImportPreviewInput,
    preferredResolution?: SkillImportConflictResolution
  ): Promise<SkillImportPreviewInput | undefined> => {
    const preview = await window.agentEnv.previewSkillImport(source);
    if (preview.conflicts.length === 0) {
      return {
        ...source,
        input: {
          ...source.input,
          expectedContentHash: preview.incoming.contentHash
        }
      } as SkillImportPreviewInput;
    }

    const resolution = preferredResolution
      ? "existingId" in preferredResolution &&
        preview.conflicts.some(
          (conflict) => conflict.existing.id === preferredResolution.existingId
        )
        ? preferredResolution
        : undefined
      : await new Promise<SkillImportConflictResolution | undefined>((resolve) => {
          setPendingSkillImport({ preview, resolve });
        });
    if (preferredResolution && !resolution) {
      throw new Error("The selected Library Skill is no longer a matching import conflict.");
    }
    if (!resolution) return undefined;
    return {
      ...source,
      input: {
        ...source.input,
        expectedContentHash: preview.incoming.contentHash,
        conflictResolution: resolution
      }
    } as SkillImportPreviewInput;
  };

  const dismissSkillImport = () => {
    if (pendingSkillImport?.committing) return;
    pendingSkillImport?.resolve(undefined);
    setPendingSkillImport(undefined);
  };

  const confirmSkillImport = (resolution: SkillImportConflictResolution) => {
    if (!pendingSkillImport || pendingSkillImport.committing) return;
    pendingSkillImport.resolve(resolution);
    setPendingSkillImport((current) =>
      current ? { ...current, committing: true } : current
    );
  };

  const changeProfileIconNow = async (profileId: string, iconKey: ResourceIconKey) => {
    if (draftProfile?.id === profileId) {
      updateDraftProfile({
        ...draftProfile,
        manifest: { ...draftProfile.manifest, iconKey }
      });
      return;
    }
    if (profileMetadataSavingId === profileId) {
      return;
    }
    const expectedContentHash =
      (draftProfile?.id === profileId ? draftProfile.contentHash : undefined) ??
      profiles.find((profile) => profile.id === profileId)?.contentHash;
    if (!expectedContentHash) {
      setError("Refresh this Profile before changing its icon.");
      return;
    }
    setError(undefined);
    setProfileMetadataSavingId(profileId);
    try {
      const previousName =
        profiles.find((profile) => profile.id === profileId)?.name ??
        draftProfile?.manifest.name ??
        profileId;
      const saved = await window.agentEnv.updateProfileMetadata({
        id: profileId,
        expectedContentHash,
        iconKey
      });
      acceptProfileMetadata(saved, previousName);
    } catch (unknownError) {
      setProfileSaveStatus("");
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setProfileMetadataSavingId((current) => current === profileId ? undefined : current);
    }
  };

  const changeProfileIcon = (profileId: string, iconKey: ResourceIconKey) => {
    void changeProfileIconNow(profileId, iconKey);
  };

  useDesktopShortcuts({
    activeWorkspace,
    isProfileSaving,
    onSaveProfile: async () => { void await saveSelectedProfile(); },
    onRefreshSkills: refreshSkills,
    onOpenProfileSearch: () => {
      setProfileSwitcherOpen(true);
      window.requestAnimationFrame(() => {
        profileSearchInputRef.current?.focus();
        profileSearchInputRef.current?.select();
      });
    },
    onOpenQuickSearch: () => setQuickOpen(true),
    profileSearchRef: profileSearchInputRef,
    skillSearchRef: skillSearchInputRef
  });

  const openCreateProfileDialogNow = () => {
    const targetId = selectedTargetId ?? targets[0]?.id;
    if (!targetId) {
      setError("No enabled Agent available");
      return;
    }
    setProfileForm({ targetId, name: "", description: "" });
    setProfileCreateSource("blank");
    setProfileCaptureOrigin("profiles");
    setProfileCaptureScope("all");
    setProfileCaptureActivity("idle");
    setTargetCapturePreview(undefined);
    setTargetCaptureDecisions([]);
    setProfileCaptureError("");
    setProfileFormError("");
    setProfileDialogMode("create");
    openWorkspaceNow("profiles");
    setIsProfileActionsOpen(false);
  };

  const openCreateProfileDialog = () => {
    guardProfileAction("create a new Profile", openCreateProfileDialogNow);
  };

  const openCreateFromTargetDialogNow = (
    targetId: string,
    scope: "all" | "skills" = "all",
    returnFocus?: HTMLElement | null
  ) => {
    appModalFallbackFocusRef.current = returnFocus ?? null;
    const target = targets.find((item) => item.id === targetId);
    setProfileForm({
      targetId,
      name: target?.name ?? "",
      description: ""
    });
    setProfileCreateSource("target");
    setProfileCaptureOrigin("targets");
    setProfileCaptureScope(scope);
    setProfileCaptureActivity("idle");
    setTargetCapturePreview(undefined);
    setTargetCaptureDecisions([]);
    setProfileCaptureError("");
    setProfileFormError("");
    setProfileDialogMode("create");
  };

  const openCreateFromTargetDialog = (
    targetId: string,
    scope: "all" | "skills" = "all",
    returnFocus?: HTMLElement | null
  ) => {
    const targetName = targets.find((item) => item.id === targetId)?.name ?? "Agent";
    guardProfileAction(
      scope === "skills"
        ? `manage ${targetName} Skills`
        : `create a profile from ${targetName}`,
      () => openCreateFromTargetDialogNow(targetId, scope, returnFocus)
    );
  };

  const openEditProfileDialog = () => {
    if (!draftProfile) {
      return;
    }
    setProfileForm({
      targetId: draftProfile.manifest.preferredTargetId ?? selectedTargetId ?? targets[0]?.id ?? "",
      name: draftProfile.manifest.name,
      description: draftProfile.manifest.description
    });
    setProfileCreateSource("blank");
    setProfileCaptureError("");
    setProfileDialogMode("edit");
    setProfileFormError("");
    setIsProfileActionsOpen(false);
  };

  const reviewTargetCapture = async () => {
    if (!profileForm.name.trim()) {
      setProfileFormError("Profile name is required");
      return;
    }
    setProfileFormError("");
    setProfileCaptureError("");
    setTargetCapturePreview(undefined);
    setTargetCaptureDecisions([]);
    setProfileCaptureActivity("reviewing");
    setBusy(true);
    try {
      const captured = await window.agentEnv.previewCreateProfileFromTarget(
        profileForm.targetId,
        profileCaptureScope
      );
      setTargetCapturePreview(captured);
      setTargetCaptureDecisions([]);
      setProfileForm((current) => ({
        ...current,
        name: current.name.trim() || captured.suggestedName
      }));
    } catch (unknownError) {
      setProfileCaptureError(
        unknownError instanceof Error ? unknownError.message : String(unknownError)
      );
    } finally {
      setProfileCaptureActivity("idle");
      setBusy(false);
    }
  };

  const submitProfileDialog = async () => {
    const name = profileForm.name.trim();
    const description = profileForm.description.trim();
    const isTargetCapture = profileDialogMode === "create" && profileCreateSource === "target";
    if (!profileDialogMode || !name) {
      setProfileFormError("Profile name is required");
      return;
    }

    if (isTargetCapture && !targetCapturePreview) {
      await reviewTargetCapture();
      return;
    }

    setProfileFormError("");
    setProfileCaptureError("");
    setBusy(true);
    if (!isTargetCapture) {
      setError(undefined);
    }
    try {
      if (profileDialogMode === "create") {
        if (profileCreateSource === "target") {
          setProfileCaptureActivity("creating");
        }
        const saved = profileCreateSource === "target" && targetCapturePreview
          ? (await window.agentEnv.createProfileFromTarget({
              previewId: targetCapturePreview.id,
              name,
              ...(targetCaptureDecisions.length > 0
                ? { decisions: targetCaptureDecisions }
                : {})
            })).profile
          : await window.agentEnv.createProfile({
              preferredTargetId: profileForm.targetId,
              name,
              description
            });
        const refreshed = await refreshProfiles();
        const nextProfileOrder = [
          saved.id,
          ...refreshed.profileItems.map((profile) => profile.id).filter((id) => id !== saved.id)
        ];
        setProfiles(orderByPreference(refreshed.profileItems, nextProfileOrder, (profile) => profile.id));
        persistUiState({ profileOrder: nextProfileOrder });
        setSelectedTargetId(saved.manifest.preferredTargetId ?? profileForm.targetId);
        setProfileTargetSelections((current) => ({
          ...current,
          [saved.id]: saved.manifest.preferredTargetId ?? profileForm.targetId
        }));
        acceptSelectedProfile(saved);
        if (profileCreateSource === "target") {
          setProfileCaptureStatus(
            profileCaptureScope === "skills"
              ? t("Skill setup saved. Agent unchanged.")
              : t("{{name}} created. Agent unchanged.", {
                  name: saved.manifest.name
                })
          );
        }
      } else if (draftProfile) {
        updateDraftProfile({
          ...draftProfile,
          manifest: {
            ...draftProfile.manifest,
            name,
            description
          }
        });
        await saveDraft();
      }
      clearComposerSections();
      openWorkspaceNow(
        profileCaptureOrigin === "targets" && profileCaptureScope === "skills"
          ? "targets"
          : "profiles"
      );
      setProfileDialogMode(undefined);
      setTargetCapturePreview(undefined);
      setTargetCaptureDecisions([]);
      clearProfilePreview();
      setRollbackPreview(undefined);
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      if (isTargetCapture) {
        setProfileCaptureError(message);
      } else {
        setProfileSaveStatus("");
        setError(message);
      }
    } finally {
      setProfileCaptureActivity("idle");
      setBusy(false);
    }
  };

  const duplicateProfileNow = async (profileId: string | undefined) => {
    if (!profileId) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setIsProfileActionsOpen(false);
    profileActionsButtonRef.current?.focus();
    try {
      const saved = await window.agentEnv.duplicateProfile(profileId);
      const refreshed = await refreshProfiles();
      const nextProfileOrder = [
        saved.id,
        ...refreshed.profileItems.map((profile) => profile.id).filter((id) => id !== saved.id)
      ];
      setProfiles(orderByPreference(refreshed.profileItems, nextProfileOrder, (profile) => profile.id));
      persistUiState({ profileOrder: nextProfileOrder });
      setSelectedTargetId(saved.manifest.preferredTargetId ?? selectedTargetId);
      setProfileTargetSelections((current) => ({
        ...current,
        ...(saved.manifest.preferredTargetId
          ? { [saved.id]: saved.manifest.preferredTargetId }
          : {})
      }));
      acceptSelectedProfile(saved);
      clearComposerSections();
      clearProfilePreview();
      setRollbackPreview(undefined);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const duplicateProfile = (profileId: string | undefined = selectedProfileId) => {
    if (!profileId) return;
    guardProfileAction("duplicate this Profile", () => duplicateProfileNow(profileId));
  };

  const deleteProfile = async () => {
    if (!deleteProfileCandidateId) {
      return;
    }
    const deletedProfileId = deleteProfileCandidateId;
    const deletingSelectedProfile = deletedProfileId === selectedProfileId;
    const deletedTargetId = draftProfile?.manifest.preferredTargetId ?? selectedTargetId;
    setBusy(true);
    setError(undefined);
    try {
      await window.agentEnv.deleteProfile(deletedProfileId);
      const { profileItems } = await refreshProfiles();
      persistUiState({
        profileOrder: currentUiState().profileOrder.filter((id) => id !== deletedProfileId)
      });
      if (deletingSelectedProfile) {
        const nextProfile = profileItems.find(
          (profile) => !profile.loadError && profile.preferredTargetId === deletedTargetId
        );
        if (nextProfile) {
          const nextDetail = await window.agentEnv.readProfile(nextProfile.id);
          setSelectedTargetId(nextProfile.preferredTargetId ?? deletedTargetId);
          setProfileTargetSelections((current) => ({
            ...current,
            ...(nextProfile.preferredTargetId
              ? { [nextProfile.id]: nextProfile.preferredTargetId }
              : {})
          }));
          acceptSelectedProfile(nextDetail);
        } else {
          clearSelectedProfile();
        }
      }
      setDeleteProfileCandidateId(undefined);
      setIsProfileActionsOpen(false);
      clearProfilePreview();
      setRollbackPreview(undefined);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const openDeleteProfileDialog = (
    profileId: string | undefined = selectedProfileId,
    returnFocus: HTMLElement | null = profileActionsButtonRef.current
  ) => {
    if (!profileId) return;
    appModalFallbackFocusRef.current = returnFocus;
    const open = () => setDeleteProfileCandidateId(profileId);
    if (profileId === selectedProfileId) {
      guardProfileAction("delete this Profile", open);
    } else {
      open();
    }
  };

  const closeProfileDialog = () => {
    setProfileDialogMode(undefined);
    setDeleteProfileCandidateId(undefined);
    clearProfilePreview();
    setRollbackPreview(undefined);
    setTargetCapturePreview(undefined);
    setTargetCaptureDecisions([]);
    setProfileCaptureActivity("idle");
    setProfileCaptureError("");
    setProfileFormError("");
  };

  const appModalOpen = Boolean(
    pendingSkillImport || pendingProfileAction || profileDialogMode || deleteProfileCandidateId ||
    profileRecoveryMode || dataRestorePreview || backupManagerOpen ||
    telemetryConsent.blocksAgentSuggestions || skillManagementMigration.open
  );
  const {
    agentProbeComplete, allowSuggestionPreferences, detectedDisabledAgents,
    dialogPhase: agentDiscoveryDialogPhase,
    dialogOpen: agentDiscoveryDialogOpen,
    discoveredTargets, enabledAgentIds, visibleAgentSuggestions,
    chooseTargetConfigRoot, dismissAgentSuggestions, enableSuggestedAgents,
    openAgentChooser, openAgentSetup, probeSupportedAgents, resetTargetConfigRoot,
    restoreAllAgentSuggestions, setAgentEnabled, setDiscoveredTargets, setTargetCommandOverride,
    suppressAgentSuggestion
  } = useAgentDiscovery({
    appModalOpen,
    isLoading,
    settings: skillSettings,
    supportedTargets,
    agentOrder: uiState.agentOrder,
    updateSettings: updateSkillSettings
  });
  const agentSetupActions = deriveAgentSetupActions(visibleAgentSuggestions, profiles, targetStates);
  const reorderAgents = (targetIds: string[]) => {
    const allKnownIds = supportedTargets.map((target) => target.id);
    const order = completeOrder(targetIds, allKnownIds);
    setSupportedTargets((current) => orderByPreference(current, order, (target) => target.id));
    setTargets((current) => orderByPreference(current, order, (target) => target.id));
    setDiscoveredTargets((current) => orderByPreference(current, order, (target) => target.id));
    persistUiState({ agentOrder: order });
  };
  const dismissAppModal = () => {
    if (pendingSkillImport) {
      dismissSkillImport();
    } else if (backupManagerOpen) {
      backupRecovery.actions.closeManager();
    } else if (dataRestorePreview) {
      backupRecovery.actions.dismissDataRestore();
    } else if (pendingProfileAction) {
      cancelPendingProfileAction();
    } else {
      closeProfileDialog();
    }
  };
  useModalDialog({
    open: appModalOpen,
    dialogRef: appModalDialogRef,
    initialFocusRef: appModalInitialFocusRef,
    fallbackFocusRef: backupManagerOpen
      ? backupManagerReturnFocusRef
      : dataRestorePreview
        ? dataRestoreReturnFocusRef
        : appModalFallbackFocusRef,
    onDismiss: dismissAppModal,
    dismissDisabled:
      Boolean(pendingSkillImport?.committing) ||
      profileCaptureActivity !== "idle" ||
      (busy && !pendingSkillImport),
    focusKey:
      pendingSkillImport
        ? `skill-import:${pendingSkillImport.preview.incoming.contentHash}`
        : profileDialogMode === "create" && profileCreateSource === "target"
        ? `target-capture:${targetCapturePreview ? "review" : "setup"}`
        : profileDialogMode ?? (deleteProfileCandidateId
            ? "delete"
            : dataRestorePreview
              ? "restore"
              : backupDeleteCandidate
                ? "delete-backup"
                : backupPreviewCandidate
                  ? `preview-backup:${backupPreviewCandidate.kind}:${backupPreviewCandidate.id}`
                : backupCleanupConfirm
                  ? "cleanup-backups"
                  : backupManagerOpen
                    ? "manage-backups"
                    : "guard")
  });

  const selectTargetNow = (targetId: string) => {
    setIsTargetMenuOpen(false);
    if (targetId === selectedTargetId) {
      return;
    }

    setSelectedTargetId(targetId);
    if (selectedProfileId) {
      setProfileTargetSelections((current) => ({
        ...current,
        [selectedProfileId]: targetId
      }));
    }
    clearProfilePreview();
    setRollbackPreview(undefined);
  };

  const selectTarget = (targetId: string) => {
    if (targetId === selectedTargetId) {
      setIsTargetMenuOpen(false);
      return;
    }
    const targetName = profileTargets.find((target) => target.id === targetId)?.name ?? "Agent";
    guardProfileAction(`apply to ${targetName}`, () => selectTargetNow(targetId));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }
      if (skillLibraryTool) {
        setSkillLibraryTool(undefined);
        setSkillCleanupScope({ kind: "all" });
        return;
      }
      if (isProfileActionsOpen) {
        setIsProfileActionsOpen(false);
        profileActionsButtonRef.current?.focus();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    isProfileActionsOpen,
    isTargetMenuOpen,
    skillLibraryTool
  ]);

  useEffect(() => {
    if (!isProfileActionsOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        profileObjectActionsRef.current?.contains(target) ||
        profileApplyControlRef.current?.contains(target)
      ) {
        return;
      }
      setIsTargetMenuOpen(false);
      setIsProfileActionsOpen(false);
      profileActionsButtonRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isProfileActionsOpen]);

  useEffect(() => {
    if (!isProfileActionsOpen) return;
    window.requestAnimationFrame(() => focusInitialActionMenuItem(profileActionsMenuRef.current));
  }, [isProfileActionsOpen]);

  const {
    selectedTarget,
    selectedRemoteEndpoint,
    selectedAgentId,
    selectedPolicyTarget,
    profileTarget,
    resourceSummary,
    currentTargetSkills,
    currentTargetInstructions,
    instructionsPolicy,
    skillsPolicy,
    updateResourceManagement: updateSelectedResourceManagement
  } = deriveProfileEndpointContext({
    selectedTargetId,
    profileTargets,
    remoteEndpoints: remote.endpoints,
    supportedTargets,
    draftProfile,
    librarySkills,
    skillInventory,
    nativeInstructionSnapshots,
    updateDraftProfile
  });
  const loadingProfileSummary = profileLoadingId
    ? profiles.find((profile) => profile.id === profileLoadingId)
    : undefined;
  const installedTargets = targets.filter((target) => isTargetInstalled(target.health));
  const activeTargetName = selectedTarget?.name ?? draftProfile?.manifest.preferredTargetId ?? "Agent";
  const targetStateById = new Map(targetStates.map((state) => [state.targetId, state]));
  const preparedSkillTargetsBySkill = useMemo(
    () =>
      targetStates
        .reduce<Record<string, PreparedSkillTarget[]>>((bySkill, target) => {
          for (const preparation of target.sharedSkillPreparations ?? []) {
            bySkill[preparation.skillKey] = [
              ...(bySkill[preparation.skillKey] ?? []),
              {
                targetId: target.targetId, targetName: preparation.targetName,
                disposition: preparation.disposition, libraryId: preparation.libraryId,
                sharedPaths: preparation.sharedPaths
              }
            ];
          }
          return bySkill;
        }, {}),
    [targetStates]
  );
  const environmentReview = useMemo(
    () =>
      deriveEnvironmentReview({
        scanStatus: environmentScanStatus,
        inventory: skillInventory,
        installedTargetIds: installedTargets.map((target) => target.id),
        profiles,
        targetStates,
        preparedTargetsBySkill: preparedSkillTargetsBySkill
      }),
    [
      environmentScanStatus,
      installedTargets,
      preparedSkillTargetsBySkill,
      profiles,
      skillInventory,
      targetStates
    ]
  );
  const selectedTargetState = targetStates.find((state) => state.targetId === selectedTarget?.id);
  const selectedAppliedProfileSnapshot =
    draftProfile &&
    selectedTargetState?.activeProfileId === draftProfile.id &&
    selectedTargetState.appliedProfileSnapshot?.profileId === draftProfile.id
      ? selectedTargetState.appliedProfileSnapshot
      : undefined;
  const deleteProfileCandidate = deleteProfileCandidateId
    ? profiles.find((profile) => profile.id === deleteProfileCandidateId)
    : undefined;
  const deleteProfileCandidateName = deleteProfileCandidate?.name ??
    (draftProfile && draftProfile.id === deleteProfileCandidateId
      ? draftProfile.manifest.name
      : deleteProfileCandidateId) ?? t("Profile");
  const isDeleteProfileCandidateActive = Boolean(
    deleteProfileCandidateId && targetStates.some(
      (state) => state.activeProfileId === deleteProfileCandidateId
    )
  );
  const deleteProfileCandidateActiveTargets = deleteProfileCandidateId
    ? targetStates
        .filter((state) => state.activeProfileId === deleteProfileCandidateId)
        .map(
          (state) =>
            profileTargets.find((target) => target.id === state.targetId)?.name ?? state.targetId
        )
    : [];
  const validationRows = draftProfile
    ? createValidationRows(draftProfile, selectedTarget, preview)
    : [];
  const localValidationErrors = validationRows
    .filter((row) => row.level === "error" && row.source !== "access" && row.source !== "conflicts")
    .map((row) => row.detail ?? `${row.label} is invalid`);
  const selectedTargetProfileHash =
    selectedTarget && draftProfile
      ? draftProfile.targetContentHashes?.[selectedAgentId ?? selectedTarget.id]
      : undefined;
  const readinessInput = {
    profile: draftProfile
      ? { id: draftProfile.id, contentHash: selectedTargetProfileHash }
      : undefined,
    target: selectedTarget,
    targetState: selectedTargetState,
    dependenciesCurrent:
      selectedTargetState?.activeProfileId === draftProfile?.id
        ? libraryResourceVersionsEqual(
            selectedTargetState?.appliedLibraryVersions,
            draftProfile
              ? collectLibraryResourceVersions(
                  profileWithoutLocalSkillOverrides(
                    draftProfile,
                    selectedTargetState?.skillReceipts,
                    selectedTargetState?.sharedSkillPreparations
                  ),
                  librarySkills,
                  selectedAgentId
                )
              : undefined
          )
        : undefined,
    isDirty: isProfileDirty,
    saveFailed: profileSaveStatus === "Profile save failed",
    localValidationErrors,
    preview
  };
  const readiness = deriveProfileReadiness(readinessInput);
  const applyActionLabel = deriveApplyActionLabel(readinessInput);
  const profileSaveWorking = isProfileSaving || profileMetadataSavingId === draftProfile?.id;
  const ReadinessIcon =
    profileSaveWorking
      ? LoaderCircle
      : readiness.status === "ready" || readiness.status === "unmanaged" || readiness.status === "applied"
      ? CheckCircle2
      : readiness.status === "dirty" || readiness.status === "apply-pending"
        ? RefreshCw
        : TriangleAlert;
  const readinessActionText = (() => {
    if (profileSaveWorking || readiness.status === "dirty") return t("Saving changes...");
    if (readiness.status === "save-failed") return t("Changes could not be saved");
    if (isProfilePreviewing) return t("Reviewing changes");
    if (isProfileApplying) return t("Applying Profile");
    if (readiness.status === "applied") return t("Up to date");
    if (readiness.status === "apply-pending") return t("Changes pending");
    if (readiness.status === "unmanaged" || readiness.status === "ready") {
      return t("Ready to apply");
    }
    if (readiness.status === "target-unavailable") return t("Unavailable");
    if (["validation-error", "review-required", "preview-error"].includes(readiness.status)) {
      return t("Needs review");
    }
    if (readiness.status === "no-target") return t("Select an Agent");
    return t(readiness.message);
  })();
  const selectedProfileDeployment = draftProfile
    ? summarizeProfileApplications(draftProfile.id, targetStates, profileTargets)
    : undefined;
  const selectedProfileDeploymentLabel =
    selectedProfileDeployment && selectedProfileDeployment.items.length > 1
      ? t("{{count}} Agents · {{status}}", {
          count: selectedProfileDeployment.items.length,
          status: t(profileDeploymentStatusLabels[selectedProfileDeployment.state])
        })
      : undefined;
  const selectedProfileDeploymentTitle = selectedProfileDeployment?.items
    .map((application) => t("{{name}} · {{status}}", {
      name: application.name,
      status: t(profileDeploymentStatusLabels[application.state])
    }))
    .join(", ");
  const applyDisabled =
    !draftProfile ||
    !selectedTarget ||
    busy ||
    isProfileSaving ||
    profileMetadataSavingId === draftProfile.id ||
    isProfileDirty ||
    readiness.status === "applied";
  const applyDescription = !draftProfile
    ? t("Select a Profile before previewing changes")
    : !selectedTarget
      ? t("Select an Agent before previewing changes")
      : busy
        ? t("An action is in progress")
        : profileSaveWorking || readiness.status === "dirty"
          ? t("Saving changes...")
          : readiness.status === "save-failed"
            ? t("Changes could not be saved")
            : t(readiness.message);
  const previewHasBlockingIssues =
    preview?.issues.some((issue) => issue.disposition === "block") === true;
  const canApply = Boolean(
    preview &&
      activationPreviewHasWork(preview) &&
      !previewHasBlockingIssues &&
      localValidationErrors.length === 0 &&
      !rollbackPreview &&
      (selectedTarget?.health.canWrite ?? false)
  );

  const previewSelectedProfile = async () => {
    const savedProfile = isProfileDirty || isProfileSaving
      ? await saveDraft()
      : draftProfile;
    if (!savedProfile) return;
    await runProfilePreview({
      profile: savedProfile,
      target: selectedTarget,
      dirty: false,
      localValidationErrors,
      onSaveRequired: () => setSkillUpdateCheckStatus(undefined)
    });
  };

  const runReadinessRemediation = () => {
    if (readiness.remediationLabel === "Open Agents") {
      openWorkspaceNow("targets");
      return;
    }
    if (readiness.remediationLabel === "Retry save") {
      void saveSelectedProfile();
      return;
    }
    if (readiness.remediationLabel === "Open Recovery") {
      setSettingsCategory("data");
      openWorkspaceNow("settings");
      backupRecovery.actions.revealManager();
    }
  };

  const applySelectedProfile = () => applyProfileActivation(draftProfile);

  const leavePreviewSkillUnmanaged = async (
    issue: ApplyIssue,
    targetId: string,
    refreshPreview: () => Promise<void>
  ) => {
    if (!issue.path || !issue.resourceId) return;
    const issuePath = issue.path;
    setError(undefined);
    try {
      await window.agentEnv.setUnmanagedSkillLocations({
        items: [{
          path: issuePath,
          targetId,
          coverage: "exact"
        }],
        unmanaged: true
      });
      setSkillInventory((current) => projectSkillInventoryBoundary(current, {
        items: [{ path: issuePath, targetId, coverage: "exact" }],
        unmanaged: true
      }));
      await refreshPreview();
      setProfileSaveStatus(
        `${issue.resourceId} is left unmanaged on this device.`
      );
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  const adoptCompatibleTargetChanges = async () => {
    if (!draftProfile || !selectedTarget) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await window.agentEnv.adoptTargetChanges(
        draftProfile.id,
        selectedTarget.id
      );
      replaceSavedProfile(result.profile);
      clearProfilePreview();
      const adoptedLabels = result.adopted.map((kind) =>
        t(
          kind === "instructions"
            ? "Instructions"
            : "MCPs"
        )
      );
      setProfileSaveStatus(
        result.skipped.length > 0
          ? t("Adopted {{resources}}; {{count}} items still need review", {
              resources: adoptedLabels.join(", "),
              count: result.skipped.length
            })
          : t("Adopted {{resources}} from {{target}}", {
              resources: adoptedLabels.join(", "),
              target: selectedTarget.name
            })
      );
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const previewSelectedRollback = async (backupId: string) => {
    rollbackReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setError(undefined);
    setRollbackError(undefined);
    clearProfilePreview();
    try {
      const nextPreview = await window.agentEnv.previewRollback(backupId);
      setRollbackPreview(nextPreview);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const restoreSelectedRollback = async () => {
    if (!rollbackPreview) {
      return;
    }

    setBusy(true);
    setError(undefined);
    setRollbackError(undefined);
    setProfileSaveStatus("");
    let restored = false;
    try {
      const result = await window.agentEnv.rollback(rollbackPreview.backupId);
      if (!result.ok) {
        const message = result.errors.join("\n");
        setError(message);
        setRollbackError(message);
        return;
      }
      await refreshProfiles();
      restored = true;
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setRollbackError(message);
    } finally {
      setBusy(false);
      if (restored) {
        setRollbackPreview(undefined);
        setRollbackError(undefined);
      }
    }
  };

  const previewStopManaging = async (targetId: string, mode: StopManagingMode) => {
    setBusy(true);
    setError(undefined);
    try {
      setStopManagingPreview(await window.agentEnv.previewStopManaging(targetId, mode));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const confirmStopManaging = async () => {
    if (!stopManagingPreview) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await window.agentEnv.stopManaging(stopManagingPreview.id);
      if (!result.ok) {
        setError(result.errors.join("\n"));
        return;
      }
      setStopManagingPreview(undefined);
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const importUnmanagedSkill = async (
    sourcePath: string,
    sourceHandling?: SkillImportInput["sourceHandling"],
    errorScope: "global" | "caller" | "batch" = "global",
    sourceCollection?: SkillImportInput["sourceCollection"],
    upstream?: SkillUpstream,
    preferredResolution?: SkillImportConflictResolution
  ) => {
    setBusy(true);
    setError(undefined);
    try {
      const prepared = await prepareSkillImport({
        kind: "local",
        input: { sourcePath, sourceHandling, sourceCollection, upstream }
      }, preferredResolution);
      if (!prepared || prepared.kind !== "local") {
        return { ok: false as const };
      }
      const result = await window.agentEnv.importSkillToLibrary(prepared.input);
      setPendingSkillImport(undefined);
      setSelectedSkillUpdatePlan(undefined);
      if (errorScope === "batch") {
        replaceLibrarySkillLocally(result.skill);
      } else {
        await Promise.all([
          refreshProfiles(),
          refreshSkillSourceGroups()
        ]);
      }
      setSkillUpdateCheckStatus({
        state: "success",
        message:
          result.sourceUpdated
            ? `Updated source for ${result.skill.name}`
            : result.reused
            ? `Using existing ${result.skill.name} from Library`
            : result.managedLocations.length > 0
            ? `Imported ${result.skill.name} · Local copy is now managed`
            : `Imported ${result.skill.name} to Library`
      });
      return {
        ok: true as const,
        conflictResolution: prepared.input.conflictResolution
      };
    } catch (unknownError) {
      setPendingSkillImport(undefined);
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      if (errorScope === "caller") throw new Error(message);
      setError(message);
      return { ok: false as const };
    } finally {
      setBusy(false);
    }
  };

  const importExternalSkill = async (skill: SkillInventoryEntry) => {
    if (
      !isExternalSkillImportable(skill.externalEvidence)
    ) {
      setError(`${skill.name} is managed by ${skill.externalEvidence?.displayName ?? "another tool"} and cannot be imported from this runtime copy.`);
      return false;
    }
    setBusy(true);
    setError(undefined);
    try {
      const prepared = await prepareSkillImport({
        kind: "local",
        input: {
          sourcePath: skill.path,
          id: skill.skillKey,
          upstream: skill.externalEvidence?.upstream,
          provenance: {
            importedVia: "local-scan",
            externalManager: "skills-cli",
            externalLockPath: skill.externalEvidence?.lockPath
          }
        }
      });
      if (!prepared || prepared.kind !== "local") return false;
      const result = await window.agentEnv.importSkillToLibrary(prepared.input);
      setPendingSkillImport(undefined);
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles();
      setSkillUpdateCheckStatus({
        state: "success",
        message: result.sourceUpdated
          ? `Updated source for ${skill.name}`
          : result.reused
          ? `${skill.name} already has a matching Library copy`
          : `Imported ${skill.name} to Library as ${result.skill.id}`
      });
      return true;
    } catch (unknownError) {
      setPendingSkillImport(undefined);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateLibrarySkill = async (
    plan: SkillUpdatePlan,
    syncCopiedInstalls = false
  ): Promise<SkillUpdateActionResult> => {
    if (!plan.previewId) {
      const message = "Skill update preview is unavailable; review the update again";
      setError(message);
      return { status: "failed", error: message };
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await skillUpdateQueue.execute([plan], false, false, syncCopiedInstalls);
      applyLibraryContentUpdatesLocally(result.updated, syncCopiedInstalls);
      if (result.failed.length > 0) {
        const message = result.failed[0]!.error;
        setSkillUpdateCheckStatus({ state: "error", message: `Update ${plan.id} failed` });
        setError(message);
        return { status: "failed", error: message };
      }
      if (result.updated.length === 0) {
        const message = `Update ${plan.id} did not change the Library`;
        setSkillUpdateCheckStatus({ state: "error", message });
        setError(message);
        return { status: "failed", error: message };
      }
      const refreshed = await refreshSkillSourceGroups();
      if (!refreshed) {
        const message = t(
          "The Skill was updated, but the Library view could not be refreshed. Close and reopen Skills, then try Refresh."
        );
        setSkillUpdateCheckStatus({ state: "error", message });
        setError(message);
        return { status: "partial", error: message };
      }
      if (result.updated.length > 0) {
        setSkillUpdateCheckStatus(
          summarizeSkillUpdateResult(
            plan.id,
            skillUpdates.filter((item) => item.id !== plan.id),
            t
          )
        );
      }
      return { status: "completed" };
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setSkillUpdateCheckStatus({ state: "error", message: `Update ${plan.id} failed` });
      setError(message);
      return { status: "failed", error: message };
    } finally {
      setBusy(false);
    }
  };

  const removeLibrarySkill = async (id: string) => {
    setBusy(true);
    setError(undefined);
    setSelectedSkillUpdatePlan(undefined);
    try {
      const result = await window.agentEnv.removeSkillFromLibrary(id);
      setSkillCleanupResult(result);
      await refreshProfiles();
      await refreshSkillSourceGroups();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSkillUpdateCheckStatus({
        state: "error",
        message: `Delete ${id} failed`
      });
    } finally {
      setBusy(false);
    }
  };

  const previewSkillMerge = async (id: string): Promise<SkillMergePreview> => {
    setError(undefined);
    try {
      return await window.agentEnv.previewSkillMerge(id);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      throw unknownError;
    }
  };

  const mergeLibrarySkills = async (input: SkillMergeInput) => {
    setBusy(true);
    setError(undefined);
    setSkillUpdateCheckStatus({ state: "checking", message: `Merging ${input.ids.length} skills...` });
    try {
      const result = await window.agentEnv.mergeLibrarySkills(input);
      setSkillCleanupResult({
        backupId: result.backupId,
        libraryId: result.skill.id,
        managedLocations: [],
        operation: "merge",
        profilesUpdated: result.profilesUpdated,
        installsUpdated: result.installsUpdated
      });
      await refreshProfiles({ checkSkillUpdates: false });
      setSkillUpdateCheckStatus({
        state: "success",
        message: `Merged ${input.ids.length} skills into ${result.skill.id}`
      });
      return true;
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setSkillUpdateCheckStatus({ state: "error", message: "Skill merge failed" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reviewSkillUsage = (id: string) => {
    const firstProfileName = skillUsage[id]?.[0];
    const profile = profiles.find((item) => item.name === firstProfileName);
    setSkillLibraryTool(undefined);
    if (profile) {
      selectProfile(profile.id, "skills");
    } else {
      openWorkspaceNow("profiles");
    }
  };

  const updateAllLibrarySkills = async (
    plans: SkillUpdatePlan[],
    syncCopiedInstalls = false
  ) => {
    const applicablePlans = plans.filter((plan) => Boolean(plan.previewId));
    if (applicablePlans.length === 0) {
      return;
    }

    skillUpdateQueue.resetStop();
    setBusy(true);
    setError(undefined);
    try {
      const result = await skillUpdateQueue.execute(
        applicablePlans,
        true,
        true,
        syncCopiedInstalls
      );
      const updatedSkills = result.updated;
      applyLibraryContentUpdatesLocally(updatedSkills, syncCopiedInstalls);
      await refreshSkillSourceGroups();
      const updatedIds = new Set(updatedSkills.map((skill) => skill.id));
      const remainingUpdates = skillUpdates.filter(
        (update) =>
          !updatedIds.has(update.id) && update.updateAvailable && !update.error
      ).length;
      if (result.cancelled) {
        setSkillUpdateCheckStatus({
          state: "success",
          message: `Updated ${plural(updatedSkills.length, "skill")} · Remaining updates skipped`
        });
      } else if (result.failed.length === 0) {
        setSkillUpdateCheckStatus({
          state: "success",
          message:
            remainingUpdates > 0
              ? `Updated ${plural(updatedSkills.length, "skill")} · More updates remain`
              : `Updated ${plural(updatedSkills.length, "skill")} · All tracked skills are up to date`
        });
      }
      if (result.failed.length > 0) {
        setSkillUpdateCheckStatus({
          state: "error",
          message: `${plural(result.failed.length, "update")} failed`
        });
        setError(result.failed.map((failure) => failure.error).join("\n"));
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const previewAllLibrarySkillUpdates = async (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    const activity: SkillUpdateActivity = { kind: "preview-skills", skillIds: ids };
    if (!beginSkillUpdateActivity(activity)) return;
    setError(undefined);
    skillUpdateQueue.resetRun();
    setSkillUpdateCheckStatus({ state: "checking", message: "Preparing updates..." });
    try {
      const result = await window.agentEnv.previewLibrarySkillUpdates(ids);
      setBulkSkillUpdatePlans(result.plans);
      setBulkSkillUpdateFailures(result.failed);
      setSkillUpdateCheckStatus(undefined);
    } catch (unknownError) {
      setBulkSkillUpdatePlans(undefined);
      setBulkSkillUpdateFailures([]);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSkillUpdateCheckStatus(undefined);
    } finally {
      finishSkillUpdateActivity(activity);
    }
  };

  const checkSkillUpdates = async () => {
    const activity: SkillUpdateActivity = { kind: "check-library" };
    if (!beginSkillUpdateActivity(activity)) return;
    setError(undefined);
    setProfileSaveStatus("");
    setSkillUpdateFeedbackWorkspace("library");
    setSkillUpdateCheckStatus({ state: "checking", message: "Checking library updates..." });
    try {
      const skillUpdateItems = await window.agentEnv.checkSkillLibraryUpdates();
      commitSkillUpdates(skillUpdateItems);
      setSkillUpdateCheckStatus(summarizeSkillUpdateChecks(skillUpdateItems, t));
      const checkError = skillUpdateItems.find((item) => item.error)?.error;
      if (checkError) {
        setError(checkError);
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setSkillUpdateCheckStatus({ state: "error", message: "Update check failed" });
    } finally {
      finishSkillUpdateActivity(activity);
    }
  };

  const checkProfileSkillUpdates = async (ids: string[]) => {
    if (checkingProfileSkillUpdates || ids.length === 0) {
      return;
    }
    setCheckingProfileSkillUpdates(true);
    setError(undefined);
    setSkillUpdateFeedbackWorkspace(
      activeWorkspace === "targets" ? "targets" : "profiles"
    );
    setSkillUpdateCheckStatus({ state: "checking", message: "Checking Profile Skills..." });
    try {
      const updates = await window.agentEnv.checkSkillLibraryUpdates(ids);
      const selectedIds = new Set(ids);
      commitSkillUpdates((current) => [
        ...current.filter((update) => !selectedIds.has(update.id)),
        ...updates
      ]);
      setSkillUpdateCheckStatus(summarizeSkillUpdateChecks(updates, t));
      const checkError = updates.find((item) => item.error)?.error;
      if (checkError) {
        setError(checkError);
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSkillUpdateCheckStatus({ state: "error", message: "Profile Skill check failed" });
    } finally {
      setCheckingProfileSkillUpdates(false);
    }
  };

  const refreshSkillDiscoveries = async (
    announce = true,
    reason: "page-entry" | "focus" | "mutation" | "manual" =
      announce ? "manual" : "mutation"
  ) => {
    if (announce) setError(undefined);
    try {
      await runFreshness("local-skills", reason, async () => {
        setSkillInventoryRefreshing(true);
        setEnvironmentScanStatus("checking");
        try {
          const inventory = await window.agentEnv.scanSkillInventory();
          setSkillInventory(inventory.entries);
          setSkillInventoryIssues(inventory.issues);
          setEnvironmentScanStatus("ready");
          return inventory;
        } finally {
          setSkillInventoryRefreshing(false);
        }
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setEnvironmentScanStatus("error");
      if (announce) {
        setError(message);
      }
    }
  };

  const skillManagerNavigation = createSkillManagerNavigation({
    targets,
    profile: draftProfile,
    target: selectedTarget,
    setReturnContext: (value) => { skillManagerReturnRef.current = value; },
    setSelectedTargetId,
    setFeedbackWorkspace: setSkillUpdateFeedbackWorkspace,
    setLibraryMode: setSkillLibraryMode,
    setScope: setSkillCleanupScope,
    setOriginTargetId: setSkillManagerOriginTargetId,
    setCollectionFocusPath: setSkillCollectionFocusPath,
    setActiveTool: setSkillLibraryTool,
    openWorkspace: openWorkspaceNow,
    captureLibraryScroll: libraryScroll.captureScroll,
    clearProfilePreview,
    refreshInventory: (reason) => refreshSkillDiscoveries(false, reason),
    refreshProfilePreview,
    guardProfileAction
  });
  const openSkillDiscoveries = skillManagerNavigation.openAll;
  const openTargetSkillManager = skillManagerNavigation.openTarget;
  const openEnvironmentReview = skillManagerNavigation.openShared;
  const reviewPreviewSkillCollection = skillManagerNavigation.reviewCollection;
  const reviewPreviewLocalSkills = skillManagerNavigation.reviewProfile;

  const {
    setUnmanagedSkillLocations,
    setSkillCollectionDecision,
    leaveSkillGroupUnmanaged,
    manageSkillGroupWithAgentEnv,
    setSharedSkillRetention, readSharedSkillAreaState, setSharedSkillAreaMode
  } = useSkillCleanupBoundaries({
    skillInventory,
    setSkillInventory,
    setBusy,
    setError,
    setProfileSaveStatus,
    setSkillUpdateCheckStatus
  });

  const {
    retireSharedSkill,
    moveSharedSkillToAgentDirectories,
    moveSkillCollectionToAgentDirectories
  } = createSharedSkillMigrationActions({
    targetStates,
    dirtyProfileId: isProfileDirty ? draftProfile?.id : undefined,
    targetNames,
    setBusy,
    setError,
    setResult: setSkillCleanupResult,
    setSuccess: (message) => setSkillUpdateCheckStatus({ state: "success", message }),
    refresh: () => refreshProfiles({ checkSkillUpdates: false }).then(() => undefined),
    saveDirtyProfile: async () => void await saveDraft()
  });
  const scanGitHubSkills = (url: string): Promise<GitHubSkillScanResult> =>
    window.agentEnv.scanGitHubSkills(url);
  const scanRepositorySkills = (
    input: RepositorySkillSourceInput
  ): Promise<RepositorySkillScanResult> => window.agentEnv.scanRepositorySkills(input);

  const syncSkillUpdatesFromSourceGroups = (groups: SkillSourceGroupView[]) => {
    const sourceUpdates = updatesFromSourceGroups(groups, librarySkills);
    const sourceIds = new Set(
      groups.flatMap((group) => group.candidates.flatMap((candidate) =>
        candidate.libraryId ? [candidate.libraryId] : []
      ))
    );
    commitSkillUpdates((current) => [
      ...current.filter((update) => !sourceIds.has(update.id)),
      ...sourceUpdates
    ]);
  };

  const checkSkillSourceGroup = async (sourceId: string) => {
    const activity: SkillUpdateActivity = { kind: "check-source", sourceId };
    if (!beginSkillUpdateActivity(activity)) return;
    setError(undefined);
    setSkillUpdateFeedbackWorkspace("library");
    setSkillUpdateCheckStatus({ state: "checking", message: t("Checking source...") });
    try {
      const group = await window.agentEnv.checkSkillSourceGroup(sourceId);
      setSkillSourceGroups((current) => {
        const next = current.some((candidate) => candidate.sourceId === sourceId)
          ? current.map((candidate) => candidate.sourceId === sourceId ? group : candidate)
          : [...current, group];
        return next;
      });
      syncSkillUpdatesFromSourceGroups([group]);
      if (group.error) {
        setSkillUpdateCheckStatus({ state: "error", message: t("Source check failed") });
        setError(group.error);
        return;
      }
      const changes = group.counts.updates + group.counts.new + group.counts.removed;
      setSkillUpdateCheckStatus({
        state: "success",
        message: changes > 0
          ? t("Source checked · {{count}} changes", { count: changes })
          : t("Source is current")
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setSkillUpdateCheckStatus({ state: "error", message: t("Source check failed") });
      setError(message);
    } finally {
      finishSkillUpdateActivity(activity);
    }
  };

  const checkMonitoredSkillSourceGroups = async () => {
    const activity: SkillUpdateActivity = { kind: "check-sources" };
    if (!beginSkillUpdateActivity(activity)) return;
    setError(undefined);
    setSkillUpdateFeedbackWorkspace("library");
    setSkillUpdateCheckStatus({ state: "checking", message: t("Checking monitored sources...") });
    try {
      const outcome = await runFreshness(
        "skill-upstreams",
        "manual",
        () => window.agentEnv.checkMonitoredSkillSourceGroups(),
        {
          force: true,
          partialError: (value) => {
            const result = value as SkillSourceCheckAllResult;
            return result.failed > 0
              ? t("{{count}} source checks failed", { count: result.failed })
              : undefined;
          }
        }
      );
      const result = outcome.value;
      if (!result) return;
      setSkillSourceGroups(result.groups);
      syncSkillUpdatesFromSourceGroups(result.groups);
      if (result.failed > 0) {
        setSkillUpdateCheckStatus({
          state: "error",
          message: t("{{count}} source checks failed", { count: result.failed })
        });
        setError(t("Open each failed source for details and retry."));
        return;
      }
      const changes = result.groups.filter((group) => group.automaticChecks !== false)
        .reduce((count, group) =>
          count + group.counts.updates + group.counts.new + group.counts.removed, 0);
      setSkillUpdateCheckStatus({
        state: "success",
        message: changes > 0
          ? t("Checked {{sources}} sources · {{changes}} changes", {
              sources: result.checked,
              changes
            })
          : t("Monitored sources are current")
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setSkillUpdateCheckStatus({ state: "error", message: t("Source checks failed") });
      setError(message);
    } finally {
      finishSkillUpdateActivity(activity);
    }
  };

  const setSkillSourceName = async (input: SkillSourceNameInput) => {
    setError(undefined);
    try {
      const group = await window.agentEnv.setSkillSourceName(input);
      setSkillSourceGroups((current) => current.map((candidate) =>
        candidate.sourceId === group.sourceId ? group : candidate
      ));
      setSkillUpdateFeedbackWorkspace("library");
      setSkillUpdateCheckStatus({ state: "success", message: t("Source name updated") });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      throw unknownError;
    }
  };

  const setSkillSourceMonitored = async (sourceId: string, enabled: boolean) => {
    setError(undefined);
    try {
      const group = await window.agentEnv.setSkillSourceMonitored({ sourceId, enabled });
      setSkillSourceGroups((current) => current.map((candidate) =>
        candidate.sourceId === group.sourceId ? group : candidate
      ));
      setSkillUpdateFeedbackWorkspace("library");
      setSkillUpdateCheckStatus({
        state: "success",
        message: t(enabled ? "Source added to routine checks" : "Source set to manual only")
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      throw unknownError;
    }
  };

  const setSkillSourceCandidateIgnored = async (
    input: SkillSourceCandidateIgnoreInput
  ) => {
    setError(undefined);
    try {
      const group = await window.agentEnv.setSkillSourceCandidateIgnored(input);
      setSkillSourceGroups((current) => current.map((candidate) =>
        candidate.sourceId === group.sourceId ? group : candidate
      ));
      setSkillUpdateFeedbackWorkspace("library");
      setSkillUpdateCheckStatus({
        state: "success",
        message: t(input.ignored
          ? "Skill ignored for this source"
          : "Skill included for this source")
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      throw unknownError;
    }
  };

  const previewSkillSourceMerge = async (
    input: SkillSourceMergePreviewInput
  ): Promise<SkillSourceMergePreview> => {
    setError(undefined);
    return window.agentEnv.previewSkillSourceMerge(input);
  };

  const mergeSkillSources = async (previewId: string): Promise<SkillSourceMergeResult> => {
    setError(undefined);
    setSkillUpdateFeedbackWorkspace("library");
    setSkillUpdateCheckStatus({ state: "checking", message: t("Merging sources...") });
    try {
      const result = await window.agentEnv.mergeSkillSources(previewId);
      await refreshSkillSourceGroups();
      setSkillUpdateCheckStatus({
        state: "success",
        message: t("Merged {{sources}} sources · {{skills}} Skills", {
          sources: result.mergedSourceCount,
          skills: result.affectedSkillCount
        })
      });
      return result;
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setSkillUpdateCheckStatus({ state: "error", message: t("Source merge failed") });
      setError(message);
      throw unknownError;
    }
  };

  const importGitHubSkills = async (
    inputs: GitHubSkillImportInput[],
    options?: SkillImportQueueOptions
  ): Promise<GitHubSkillImportResult> => {
    setBusy(true);
    setError(undefined);
    try {
      const queueResult = await runSkillImportQueue(inputs, options, {
        progressKey: (input) => input.url,
        prepare: async (input) => {
          const prepared = await prepareSkillImport({ kind: "github", input });
          return prepared?.kind === "github" ? prepared.input : undefined;
        },
        importPrepared: (input) => window.agentEnv.importGitHubSkillToLibrary(input),
        updatesSource: (input) => input.conflictResolution?.action === "update-source",
        failure: (input, error) => ({
          id: input.id ?? "skill",
          sourceUrl: input.url,
          error: error instanceof Error ? error.message : String(error)
        })
      });
      setPendingSkillImport(undefined);
      const result: GitHubSkillImportResult = {
        imported: queueResult.imported,
        failed: queueResult.failed
      };
      const updatedSourceCount = queueResult.updatedSourceCount;
      setSelectedSkillUpdatePlan(undefined);
      try {
        await refreshProfiles({ checkSkillUpdates: false });
        await refreshSkillSourceGroups();
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      } finally {
        commitSkillUpdates((current) =>
          reconcileImportedSkillUpdates(current, result.imported));
      }
      if (result.imported.length > 0) {
        setSkillUpdateCheckStatus({
          state: result.failed.length > 0 ? "info" : "success",
          message:
            result.failed.length > 0
              ? `Imported ${result.imported.length} · ${result.failed.length} failed`
              : updatedSourceCount === result.imported.length
                ? `Updated ${updatedSourceCount} ${updatedSourceCount === 1 ? "skill source" : "skill sources"}`
                : updatedSourceCount > 0
                  ? `Imported ${result.imported.length - updatedSourceCount} · Updated ${updatedSourceCount} ${updatedSourceCount === 1 ? "source" : "sources"}`
                  : `Imported ${result.imported.length} ${result.imported.length === 1 ? "skill" : "skills"}`
        });
      }
      return result;
    } finally {
      setBusy(false);
    }
  };

  const importRepositorySkills = async (
    inputs: RepositorySkillImportInput[],
    options?: SkillImportQueueOptions
  ): Promise<RepositorySkillImportResult> => {
    setBusy(true);
    setError(undefined);
    try {
      const queueResult = await runSkillImportQueue(inputs, options, {
        progressKey: (input: RepositorySkillImportInput) => repositoryImportProgressKey(input),
        prepare: async (input) => {
          const prepared = await prepareSkillImport({ kind: "repository", input });
          return prepared?.kind === "repository" ? prepared.input : undefined;
        },
        importPrepared: (input) => window.agentEnv.importRepositorySkillToLibrary(input),
        updatesSource: (input) => input.conflictResolution?.action === "update-source",
        failure: (input, error) => ({
          id: input.id ?? "skill",
          repository: input.repository,
          ref: input.ref,
          directory: input.directory,
          error: error instanceof Error ? error.message : String(error)
        })
      });
      setPendingSkillImport(undefined);
      const result: RepositorySkillImportResult = {
        imported: queueResult.imported,
        failed: queueResult.failed
      };
      const updatedSourceCount = queueResult.updatedSourceCount;
      setSelectedSkillUpdatePlan(undefined);
      try {
        await refreshProfiles({ checkSkillUpdates: false });
        await refreshSkillSourceGroups();
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      } finally {
        commitSkillUpdates((current) =>
          reconcileImportedSkillUpdates(current, result.imported));
      }
      if (result.imported.length > 0) {
        setSkillUpdateCheckStatus({
          state: result.failed.length > 0 ? "info" : "success",
          message:
            result.failed.length > 0
              ? `Imported ${result.imported.length} · ${result.failed.length} failed`
              : updatedSourceCount === result.imported.length
                ? `Updated ${updatedSourceCount} ${updatedSourceCount === 1 ? "skill source" : "skill sources"}`
                : updatedSourceCount > 0
                  ? `Imported ${result.imported.length - updatedSourceCount} · Updated ${updatedSourceCount} ${updatedSourceCount === 1 ? "source" : "sources"}`
                  : `Imported ${result.imported.length} ${result.imported.length === 1 ? "skill" : "skills"}`
        });
      }
      return result;
    } finally {
      setBusy(false);
    }
  };

  const manageTargetSkill = async (input: ManageTargetSkillInput) => {
    setBusy(true);
    setError(undefined);
    try {
      await window.agentEnv.manageTargetSkill(input);
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const consolidateSkillGroup = async (input: SkillCleanupRequest) => {
    setBusy(true);
    setError(undefined);
    setSkillUpdateCheckStatus({ state: "checking", message: `Cleaning up ${input.skillKey}...` });
    try {
      const result = await window.agentEnv.consolidateSkillGroup(input);
      setSkillCleanupResult(result);
      await refreshProfiles();
      setSkillUpdateCheckStatus(undefined);
      return true;
    } catch (unknownError) {
      const operationError = unknownError instanceof Error ? unknownError.message : String(unknownError);
      try {
        await refreshProfiles({ checkSkillUpdates: false });
        setError(operationError);
      } catch (refreshError) {
        setError(
          `${operationError}\nRefresh failed: ${
            refreshError instanceof Error ? refreshError.message : String(refreshError)
          }`
        );
      }
      setSkillUpdateCheckStatus(undefined);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const autoConsolidateSkillGroups = async (
    inputs: SkillCleanupRequest[],
    options?: {
      onProgress?(event: {
        skillKey: string;
        status: "managing" | "managed" | "failed" | "skipped";
        error?: string;
      }): void;
      shouldStop?(): boolean;
    }
  ) => {
    if (inputs.length === 0) {
      return { completedSkillKeys: [], failures: {}, skippedSkillKeys: [] };
    }
    setBusy(true);
    setError(undefined);
    setSkillCleanupResult(undefined);
    setSkillUpdateCheckStatus({
      state: "checking",
      message: `Managing ${plural(inputs.length, "skill")}...`
    });
    const completed: SkillCleanupResult[] = [];
    const completedSkillKeys: string[] = [];
    const failures: Record<string, string> = {};
    const skippedSkillKeys: string[] = [];
    for (const [index, input] of inputs.entries()) {
      if (options?.shouldStop?.()) {
        const skipped = inputs.slice(index).map((item) => item.skillKey);
        skippedSkillKeys.push(...skipped);
        for (const skillKey of skipped) {
          options.onProgress?.({ skillKey, status: "skipped" });
        }
        break;
      }
      options?.onProgress?.({ skillKey: input.skillKey, status: "managing" });
      try {
        completed.push(await window.agentEnv.consolidateSkillGroup(input));
        completedSkillKeys.push(input.skillKey);
        options?.onProgress?.({ skillKey: input.skillKey, status: "managed" });
      } catch (unknownError) {
        const message = unknownError instanceof Error
          ? unknownError.message
          : String(unknownError);
        failures[input.skillKey] = message;
        options?.onProgress?.({ skillKey: input.skillKey, status: "failed", error: message });
      }
    }
    try {
      await refreshProfiles({ checkSkillUpdates: false });
      if (Object.keys(failures).length === 0) {
        if (completed.length === 1) {
          setSkillCleanupResult(completed[0]);
          setSkillUpdateCheckStatus(undefined);
        } else {
          setSkillUpdateCheckStatus({
            state: "success",
            message: `Managed ${plural(completed.length, "local skill")} · Backups are available in History`
          });
        }
      } else {
        setSkillUpdateCheckStatus({
          state: "error",
            message: `${plural(completed.length, "skill")} managed · ${plural(Object.keys(failures).length, "skill")} need review`
          });
        setError(Object.entries(failures).map(([skillKey, message]) => `${skillKey}: ${message}`).join("\n"));
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSkillUpdateCheckStatus({ state: "error", message: "Skill cleanup refresh failed" });
    } finally {
      setBusy(false);
    }
    return { completedSkillKeys, failures, skippedSkillKeys };
  };

  const undoSkillCleanup = async (backupId = skillCleanupResult?.backupId) => {
    if (!backupId) {
      return;
    }
    setBusy(true);
    setError(undefined);
    const restoringRemoval =
      skillCleanupResult?.backupId === backupId && skillCleanupResult.operation === "remove";
    const restoringMerge =
      skillCleanupResult?.backupId === backupId && skillCleanupResult.operation === "merge";
    try {
      await window.agentEnv.rollbackSkillCleanup(backupId);
      setSkillCleanupResult(undefined);
      await refreshProfiles();
      setSkillUpdateCheckStatus({
        state: "success",
        message: restoringRemoval
          ? "Skill removal undone"
          : restoringMerge
            ? "Skill merge undone"
            : "Skill cleanup undone"
      });
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const saveSkillUpdateSettings = async (
    change: SkillUpdateSettingsInput
  ): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await window.agentEnv.setSkillUpdateSettings(change);
      replaceLibrarySkillLocally(updated, { invalidateUpdateCheck: true });
      refreshTrackedSkillUpdateLocally(updated);
      setSkillUpdateCheckStatus({
        state: "success",
        message: t("Update settings saved for {{name}}", { name: updated.name })
      });
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setSkillAvailability = async (input: SkillAvailabilityInput) => {
    setError(undefined);
    try {
      await window.agentEnv.setSkillAvailability(input);
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles({ checkSkillUpdates: false });
      setSkillUpdateCheckStatus({
        state: "success",
        message: input.enabled
          ? t("{{id}} is available to Profiles", { id: input.id })
          : t("{{id}} is hidden from Profile selection", { id: input.id })
      });
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSkillUpdateCheckStatus({
        state: "error",
        message: t(input.enabled ? "Enable {{id}} failed" : "Disable {{id}} failed", {
          id: input.id
        })
      });
      return false;
    }
  };

  const setSkillIcon = async (input: SkillIconInput) => {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await window.agentEnv.setSkillIcon(input);
      replaceLibrarySkillLocally(updated);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const setSkillTags = async (input: SkillTagsInput) => {
    setError(undefined);
    try {
      const updated = await window.agentEnv.setSkillTags(input);
      replaceLibrarySkillLocally(updated);
      setSkillUpdateCheckStatus({
        state: "success",
        message: t("Tags saved for {{name}}", { name: updated.name })
      });
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    }
  };

  const previewLibrarySkillUpdate = async (id: string) => {
    const activity: SkillUpdateActivity = { kind: "preview-skill", skillId: id };
    if (!beginSkillUpdateActivity(activity)) return;
    setError(undefined);
    setProfileSaveStatus("");
    setSelectedSkillUpdatePlan(undefined);
    skillUpdateQueue.resetRun();
    setSkillUpdateFeedbackWorkspace("library");
    setSkillUpdateCheckStatus({ state: "checking", message: `Checking ${id}...` });
    try {
      const updatePlan = await window.agentEnv.previewLibrarySkillUpdate(id);
      if (updatePlan.sourceStatus === "removed") {
        commitSkillUpdates((current) => {
          const previous = current.find((update) => update.id === id);
          const removedUpdate: SkillUpdateInfo = {
            id,
            name: updatePlan.name,
            sourceType: updatePlan.sourceType,
            currentRevision: updatePlan.currentRevision,
            updateAvailable: false,
            sourceStatus: "removed"
          };
          return previous
            ? current.map((update) => update.id === id ? removedUpdate : update)
            : [...current, removedUpdate];
        });
        setSkillUpdateCheckStatus({
          state: "info",
          message: t("{{id}} was removed upstream", { id })
        });
        if (librarySkills.some((skill) => skill.id === id && skill.sourceCollection)) {
          await refreshSkillSourceGroups();
        }
      } else if (updatePlan.errors.length > 0) {
        setSkillUpdateCheckStatus({
          state: "error",
          message: `${id} check failed`
        });
        const rateLimitError = updatePlan.errors.find(isGitHubRateLimitError);
        if (rateLimitError && githubAuthStatus.state !== "signed-in") {
          setError(rateLimitError);
        }
      } else {
        setSelectedSkillUpdatePlan(
          updatePlan.updateAvailable && updatePlan.changes.length > 0 ? updatePlan : undefined
        );
        if (!updatePlan.updateAvailable && updatePlan.latestRevision) {
          commitSkillUpdates((current) => current.map((update) =>
            update.id === id
              ? {
                  ...update,
                  currentRevision: updatePlan.latestRevision,
                  latestRevision: updatePlan.latestRevision,
                  updateAvailable: false,
                  error: undefined
                }
              : update
          ));
          if (librarySkills.some((skill) => skill.id === id && skill.sourceCollection)) {
            await refreshSkillSourceGroups();
          }
        }
        setSkillUpdateCheckStatus({
          state: "success",
          message: updatePlan.updateAvailable
            ? t("1 update available for {{id}}", { id })
            : t("{{id}} source is current", { id })
        });
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setSkillUpdateCheckStatus({ state: "error", message: t("{{id}} check failed", { id }) });
    } finally {
      finishSkillUpdateActivity(activity);
    }
  };

  const refreshTargets = useAgentRefresh({
    agentOrder: uiState.agentOrder,
    loadRecoveryHistory: loadTargetRecoveryHistory,
    profiles,
    runFreshness,
    setError,
    setDiscoveredTargets,
    setMcpConnections: setNativeMcpConnections,
    setMcpIssues: setNativeMcpIssues,
    setSelectedTargetId,
    setSupportedTargets,
    setTargetStates,
    setTargets
  });

  const removeRemoteDevice = async (id: string) => {
    await remote.remove(id);
    if (selectedTargetId?.startsWith(`ssh:${id}:`)) {
      setSelectedTargetId(targets[0]?.id);
    }
  };

  useWorkspaceFreshness({
    activeWorkspace,
    isLoading,
    refreshSkills,
    refreshSkillDiscoveries,
    refreshTargets
  });

  const dismissAppFeedback = () => {
    setError(undefined);
    setSkillUpdateCheckStatus(undefined);
    setProfileSaveStatus("");
    clearProfileApplyRefreshDetail();
    settingsController.actions.clearStatus();
    setSkillCleanupResult(undefined);
    setProfileCaptureStatus("");
  };
  const viewDiagnosticIssue = async (reference: string) => {
    try {
      const issue = await window.agentEnv.readDiagnosticIssue(reference);
      if (issue) setDiagnosticIssue(issue);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };
  const copyLatestDiagnosticIssue = async () => {
    try {
      const issue = await window.agentEnv.readLatestDiagnosticIssue();
      if (!issue) {
        settingsController.actions.setStatus("No diagnostic issues recorded");
        return;
      }
      await window.agentEnv.copyText(formatDiagnosticIssue(issue));
      settingsController.actions.setStatus("Latest diagnostic issue copied");
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };
  const exportDiagnosticReport = async () => {
    setError(undefined);
    settingsController.actions.clearStatus();
    try {
      const path = await window.agentEnv.exportDiagnostics();
      if (path) {
        settingsController.actions.setStatus(t("Diagnostic report exported to {{path}}", { path }));
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };
  const openDiagnosticLogFolder = async () => {
    try {
      await window.agentEnv.openDiagnosticsFolder();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };
  const openGitHubConnectionSettings = () => {
    setError(undefined);
    setSkillUpdateCheckStatus(undefined);
    setSettingsCategory("connections");
    openWorkspaceNow("settings");
    window.setTimeout(() => {
      const section = document.getElementById("github-connection-settings");
      section?.focus();
      section?.scrollIntoView?.({ block: "center" });
    }, 0);
  };
  const showGitHubRecovery =
    Boolean(error && isGitHubRateLimitError(error)) &&
    githubAuthStatus.state !== "signed-in";
  const captureFeedbackVisible = profileCaptureOrigin === "targets"
    ? activeWorkspace === "targets" || activeWorkspace === "profiles"
    : activeWorkspace === "profiles";
  const parsedAppError = error ? parseDiagnosticErrorMessage(error) : undefined;
  const appFeedback: AppFeedbackMessage | undefined = error
    ? {
        kind: "error",
        title: showGitHubRecovery
          ? "GitHub request limited"
          : skillUpdateCheckStatus?.state === "error"
            ? skillUpdateCheckStatus.message
            : "Action failed",
        message: showGitHubRecovery
          ? "Anonymous GitHub requests are limited. Connect your account and try again."
          : parsedAppError?.message ?? error,
        diagnosticReference: parsedAppError?.reference,
        action: showGitHubRecovery
          ? { label: "Connect GitHub", onClick: openGitHubConnectionSettings }
          : undefined
      }
    : profileCaptureStatus && captureFeedbackVisible
      ? { kind: "success", title: profileCaptureStatus }
    : skillCleanupResult && activeWorkspace === "library"
      ? {
          kind: "success",
          title:
            skillCleanupResult.operation === "remove"
              ? t("Removed {{id}}", { id: skillCleanupResult.libraryId })
              : skillCleanupResult.operation === "merge"
                ? t("Merged duplicates into {{id}}", { id: skillCleanupResult.libraryId })
              : skillCleanupResult.operation === "retire"
                ? t("Moved {{id}} out of the shared folder", { id: skillCleanupResult.libraryId })
                : skillCleanupResult.libraryCreated
                  ? t("Added {{id}} to Library", { id: skillCleanupResult.libraryId })
                  : t("Managed copies for {{id}}", { id: skillCleanupResult.libraryId }),
          message:
            skillCleanupResult.operation === "remove"
              ? skillCleanupResult.managedLocations.length === 0
                ? t("Removed from the Library. No Agent installs were affected.")
                : t("Removed from the Library and {{count}} managed Agent installs.", {
                    count: skillCleanupResult.managedLocations.length
                  })
              : skillCleanupResult.operation === "merge"
                ? t("Updated {{profiles}} Profiles and {{installs}} managed installs. A restorable backup is available in History.", {
                    profiles: skillCleanupResult.profilesUpdated ?? 0,
                    installs: skillCleanupResult.installsUpdated ?? 0
                  })
              : t("{{count}} local copies were updated. A restorable backup is available in History.", {
                  count: skillCleanupResult.managedLocations.length
                }),
          action: {
            label:
              skillCleanupResult.operation === "remove"
                ? "Undo removal"
                : skillCleanupResult.operation === "merge"
                  ? "Undo merge"
                  : "Undo cleanup",
            onClick: () => void undoSkillCleanup()
          }
        }
    : skillUpdateCheckStatus && activeWorkspace === skillUpdateFeedbackWorkspace
      ? {
          kind:
            skillUpdateCheckStatus.state === "checking"
              ? "loading"
              : skillUpdateCheckStatus.state === "error"
                ? "error"
                : skillUpdateCheckStatus.state === "info"
                  ? "info"
                  : "success",
          title: skillUpdateCheckStatus.message
        }
      : profileSaveStatus &&
          activeWorkspace === "profiles" &&
          ![
            "Saving Profile",
            "Saving Profile details",
            "Profile saved",
            "Profile details saved",
            "Profile save failed"
          ].includes(profileSaveStatus)
        ? {
            kind: "info",
            title: profileSaveStatus,
            message:
              profileSaveStatus === "The Agent changed while Preview was open. Preview refreshed."
                ? profileApplyRefreshDetail
                : undefined
          }
      : dataBackupStatus && activeWorkspace === "settings"
          ? {
              kind: dataBackupStatus === "Creating data export" ? "loading" : "success",
              title: dataBackupStatus
            }
        : settingsSaveStatus && activeWorkspace === "settings"
          ? {
              kind:
                settingsSaveStatus === "Saving settings"
                  ? "loading"
                  : settingsSaveStatus === "No diagnostic issues recorded"
                    ? "info"
                    : "success",
              title: settingsSaveStatus
            }
        : undefined;
  const hasPersistentAppFeedback =
    appFeedback?.kind === "error" || appFeedback?.kind === "warning";
  const profileApplyControl = profileTargets.length > 0 ? (
    <div className="profile-apply-control" ref={profileApplyControlRef}>
      <Button
        className="profile-apply-button ui-inspector-header__command"
        aria-describedby="profile-apply-description"
        title={t(applyActionLabel)}
        disabled={applyDisabled}
        busy={isProfilePreviewing}
        variant="primary"
        onClick={previewSelectedProfile}
      >
        {t("Apply")}
      </Button>
      <span id="profile-apply-description" hidden>{applyDescription}</span>
    </div>
  ) : null;
  const evaluationControl = deriveProfileComparisonControl({
    platform: window.agentEnv.platform,
    target: selectedTarget,
    readinessStatus: readiness.status,
    isDirty: isProfileDirty,
    isBusy: busy,
    isSaving: isProfileSaving || profileMetadataSavingId === draftProfile?.id
  });
  const evaluationDescription = t(evaluationControl.description, {
    target: selectedTarget?.name ?? t("the selected Agent")
  });
  const openProfileEvaluation = async () => {
    if (!draftProfile || !selectedTarget || evaluationControl.disabled) return;
    if (isProfileDirty || isProfileSaving) await saveDraft();
    setIsTargetMenuOpen(false);
    setIsProfileActionsOpen(false);
    setProfileEvaluationOpen(true);
  };
  const targetWorkspaceControl = (
    <AgentContextSwitcher
      className="profile-agent-switcher"
      open={isTargetMenuOpen}
      query={targetMenuQuery}
      selectedId={selectedTargetId}
      selectionLabel={t("Select apply Agent")}
      targets={profileTargets}
      onOpenChange={(open) => {
        setIsProfileActionsOpen(false);
        setIsTargetMenuOpen(open);
      }}
      onQueryChange={setTargetMenuQuery}
      onSelect={selectTarget}
    />
  );

  const profileReadinessStatus = (
    <span className={`profile-action-status profile-action-status--${readiness.status}`}>
      <span
        className="profile-action-status__copy"
        role="status"
        aria-label={t("Profile readiness")}
        title={t(readiness.message)}
      >
        <span className="profile-action-status__icon" aria-hidden="true">
          <ReadinessIcon
            className={profileSaveWorking ? "is-spinning" : undefined}
            size={13}
            strokeWidth={2.3}
          />
        </span>
        <span className="profile-action-status__text">
          <span
            className="profile-action-status__primary"
            data-ui-overflow-detail="true"
            title={t(readinessActionText)}
          >
            {t(readinessActionText)}
          </span>
          {selectedProfileDeploymentLabel ? (
            <>
              <span className="profile-action-status__divider" aria-hidden="true">·</span>
              <span
                className="profile-action-status__applications"
                title={selectedProfileDeploymentTitle}
              >
                {selectedProfileDeploymentLabel}
              </span>
            </>
          ) : null}
        </span>
      </span>
      {readiness.remediationLabel ? (
        <button
          className="profile-action-status__action"
          type="button"
          aria-label={t(readiness.remediationLabel)}
          title={t(readiness.remediationLabel)}
          disabled={busy}
          onClick={runReadinessRemediation}
        >
          <span>{t(readiness.remediationLabel)}</span>
          <ArrowRight size={12} strokeWidth={2.3} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
  const profileObjectActions = draftProfile && !profileLoadingId ? (
    <div className="profile-object-actions" ref={profileObjectActionsRef}>
      <ControlGroup
        className="profile-commit-actions"
        aria-label={t("Selected Profile actions")}
      >
        {targetWorkspaceControl}
        {profileApplyControl}
        <IconButton
          ref={profileActionsButtonRef}
          className="profile-more-button"
          aria-expanded={isProfileActionsOpen}
          aria-haspopup="menu"
          disabled={busy || !draftProfile || draftProfile.id !== selectedProfileId}
          label={t("More Profile actions")}
          onClick={() => {
            setIsTargetMenuOpen(false);
            setIsProfileActionsOpen((current) => !current);
          }}
        >
          <MoreHorizontal size={16} strokeWidth={2.2} />
        </IconButton>
        {isProfileActionsOpen ? (
          <ProfileActionsMenu
            disabled={busy}
            compareDisabled={evaluationControl.disabled}
            compareDescription={evaluationDescription}
            menuRef={profileActionsMenuRef}
            appliedRestoreAvailable={!selectedRemoteEndpoint && Boolean(selectedAppliedProfileSnapshot)}
            appliedRestoreDescription={selectedAppliedProfileSnapshot
              ? t("Restore the Profile version last applied to {{target}}.", {
                  target: selectedTarget?.name ?? t("this Agent")
                })
              : t("Apply this Profile to {{target}} once to create a restore point.", {
                  target: selectedTarget?.name ?? t("this Agent")
                })}
            onCompare={() => void openProfileEvaluation()}
            onDuplicate={() => duplicateProfile()}
            onDelete={() => {
              setIsProfileActionsOpen(false);
              openDeleteProfileDialog();
            }}
            onOpenRecovery={() => {
              setIsProfileActionsOpen(false);
              setProfileRecoveryMode("history");
            }}
            onRestoreLastApplied={selectedRemoteEndpoint ? undefined : () => {
              setIsProfileActionsOpen(false);
              setProfileRecoveryMode("applied");
            }}
          />
        ) : null}
      </ControlGroup>
      {profileReadinessStatus}
    </div>
  ) : null;

  const quickOpenItems = buildQuickOpenItems({
    profiles,
    skills: librarySkills,
    targets,
    t,
    onOpenWorkspace: workspace => {
      if (workspace === "library") setSkillLibraryMode("skills");
      selectWorkspace(workspace);
    },
    onOpenProfile: selectProfile,
    onOpenSkill: skill => {
      setSkillLibraryMode("skills");
      setSkillLibraryViewState(current =>
        updateSkillLibraryControls(current, { search: skill.name }));
      selectWorkspace("library");
    },
    onOpenTarget: openAgentConfiguration,
    onOpenLocalSkills: () => {
      setSkillLibraryMode("skills");
      selectWorkspace("library");
      void openSkillDiscoveries();
    },
    onRefreshSkills: refreshSkills,
    onRefreshTargets: refreshTargets
  });

  return (
    <main
      className={appShellClassName(
        activeWorkspace,
        sidebarCollapsed,
        windowChromeFullScreen
      )}
    >
      <WindowTitlebar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />
      <ProfileSidebar
        targets={targets}
        profiles={profiles}
        isLoading={isLoading}
        collapsed={sidebarCollapsed}
        activeWorkspace={activeWorkspace}
        onWorkspaceSelect={selectWorkspace}
        onAgentSelect={openAgentConfiguration}
        onOpenAgents={() => selectWorkspace("targets")}
        onQuickOpen={() => setQuickOpen(true)}
      />

      <QuickOpen items={quickOpenItems} open={quickOpen}
        onDismiss={() => setQuickOpen(false)}
        searchAdditionalItems={conversationQuickOpen.searchAdditionalItems} />

      <section
        className={`editor-panel${
          hasPersistentAppFeedback ? " editor-panel--has-persistent-feedback" : ""
        }`}
        aria-label={
          activeWorkspace === "library"
            ? t("Library workspace")
            : activeWorkspace === "instructions"
              ? t("Instructions workspace")
            : activeWorkspace === "profiles"
              ? t("Profile editor")
              : activeWorkspace === "projects"
                ? t("Workspace browser")
              : activeWorkspace === "conversations"
                ? t("Conversation workspace")
              : t("{{name}} workspace", { name: activeWorkspace })
        }
      >
        <AppFeedback
          feedback={appFeedback}
          onDismiss={dismissAppFeedback}
          onViewDiagnostic={(reference) => void viewDiagnosticIssue(reference)}
        />
        {activeWorkspace === "library" ? (
          <>
            <PageHeader
              className="page-header library-page-header"
              title={t("Skills")}
              help={
                <InfoTip
                  label={t("Manage reusable Skills, their sources, updates, and local copies.")}
                />
              }
              actions={
                <LibraryHeaderActions
                  mode={skillLibraryMode}
                  toolOpen={Boolean(skillLibraryTool)}
                  freshness={freshnessStates["skill-library"]}
                  onImport={() => setSkillLibraryTool("import")}
                  onScanLocal={() => {
                    void openSkillDiscoveries();
                  }}
                  onRefresh={() => {
                    void refreshSkills();
                  }}
                />
              }
            />
            <SkillLibraryPanel
              model={{
                status: {
                  isLoading,
                  isBusy: busy,
                  isRefreshingInventory: skillInventoryRefreshing
                },
                catalog: {
                  librarySkills,
                  skillUpdates,
                  skillUsage,
                  installedTargetIds: targets
                    .filter((target) => isTargetInstalled(target.health))
                    .map((target) => target.id),
                  activeProfileTargetIds: targetStates
                    .filter((state) => Boolean(state.activeProfileId))
                    .map((state) => state.targetId),
                  targetNames,
                  preparedTargetsBySkill: preparedSkillTargetsBySkill
                },
                sources: {
                  sourceGroups: skillSourceGroups,
                  sourceGroupsLoading: false,
                  libraryMode: skillLibraryMode
                },
                cleanup: {
                  skillInventory,
                  scanIssues: skillInventoryIssues,
                  cleanupBackups: skillCleanupBackups,
                  cleanupScope: skillCleanupScope,
                  originTargetId: skillManagerOriginTargetId,
                  focusCollectionPath: skillCollectionFocusPath
                },
                updates: {
                  selectedUpdatePlan: selectedSkillUpdatePlan,
                  bulkUpdatePlans: bulkSkillUpdatePlans,
                  bulkUpdateFailures: bulkSkillUpdateFailures,
                  updateRun: skillUpdateQueue.run,
                  bulkUpdateStopRequested: skillUpdateQueue.stopRequested,
                  updateActivity: skillUpdateActivity
                },
                workspace: {
                  activeTool: skillLibraryTool,
                  importConflictOpen: Boolean(pendingSkillImport)
                },
                view: {
                  viewState: skillLibraryViewState,
                  searchInputRef: skillSearchInputRef
                }
              }}
              actions={{
                navigation: {
                  onCloseTool: () => {
                    const returnContext = skillManagerReturnRef.current;
                    skillManagerNavigation.close(returnContext);
                  },
                  onFocusCollectionHandled: () => setSkillCollectionFocusPath(undefined),
                  onLibraryModeChange: setSkillLibraryMode,
                  onCleanupScopeChange: setSkillCleanupScope,
                  onViewStateChange: (next) => {
                    libraryScroll.resetScrollNow();
                    setSkillLibraryViewState(next);
                  },
                  scrollOwnerRef: libraryScroll.setScrollOwner
                },
                inventory: {
                  onRefreshInventory: refreshSkillDiscoveries,
                  onSelectLocalSkillSource: () => window.agentEnv.selectLocalSkillSource(),
                  onReleaseSkillArchive: (token) => window.agentEnv.releaseSkillArchive(token),
                  onScanLocalSkillSource: (rootPath) => window.agentEnv.scanLocalSkillSource(rootPath),
                  onImportUnmanaged: (sourcePath, sourceHandling, deferFullRefresh) =>
                    importUnmanagedSkill(
                      sourcePath,
                      sourceHandling,
                      deferFullRefresh ? "batch" : "global"
                    ).then((outcome) => outcome.ok),
                  onResolveCollectionConflict: async (item, strategy, deferFullRefresh) => {
                    const preferredResolution =
                      strategy === "use-collection" && item.libraryId
                        ? { action: "replace" as const, existingId: item.libraryId }
                        : undefined;
                    const outcome = await importUnmanagedSkill(
                      item.path,
                      "copy-only",
                      deferFullRefresh ? "batch" : "global",
                      undefined,
                      undefined,
                      preferredResolution
                    );
                    if (!outcome.ok) return false;
                    if (outcome.conflictResolution?.action === "keep-existing") {
                      return setSkillCollectionDecision({
                        path: item.path,
                        useLibrary: true,
                        sourceContentHash: item.contentHash
                      });
                    }
                    if (item.collectionDecision === "use-library") {
                      return setSkillCollectionDecision({ path: item.path, useLibrary: false });
                    }
                    return true;
                  },
                  onImportLocalSourceSkill: (sourcePath, sourceCollection, upstream) =>
                    importUnmanagedSkill(
                      sourcePath,
                      "copy-only",
                      "caller",
                      sourceCollection,
                      upstream
                    ).then((outcome) => outcome.ok),
                  onImportExternal: importExternalSkill,
                  onManageTargetSkill: manageTargetSkill,
                  onConsolidateSkillGroup: consolidateSkillGroup,
                  onAutoConsolidateSkillGroups: autoConsolidateSkillGroups,
                  onCopyCleanupDetails: async (details) => {
                    try {
                      await window.agentEnv.copyText(details);
                      return true;
                    } catch (unknownError) {
                      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
                      return false;
                    }
                  },
                  onLeaveSkillGroupUnmanaged: (skillKey) => void leaveSkillGroupUnmanaged(skillKey),
                  onManageSkillGroupWithAgentEnv: (skillKey) => void manageSkillGroupWithAgentEnv(skillKey),
                  onSetUnmanagedSkillLocations: setUnmanagedSkillLocations,
                  onSetSkillCollectionDecision: setSkillCollectionDecision,
                  onSetSharedSkillRetention: setSharedSkillRetention,
                  onReadSharedSkillAreaState: readSharedSkillAreaState,
                  onSetSharedSkillAreaMode: setSharedSkillAreaMode,
                  onRetireSharedSkill: retireSharedSkill,
                  onMoveSharedSkillToAgents: moveSharedSkillToAgentDirectories,
                  onMoveSkillCollection: moveSkillCollectionToAgentDirectories,
                  onRestoreCleanup: (backupId) => void undoSkillCleanup(backupId)
                },
                files: {
                  onListSkillFiles: (id) => window.agentEnv.listSkillFiles(id),
                  onReadSkillFile: (id, path) => window.agentEnv.readSkillFile({ id, path })
                },
                repository: {
                  onScanGitHubSkills: scanGitHubSkills,
                  onImportGitHubSkills: importGitHubSkills,
                  onScanRepositorySkills: scanRepositorySkills,
                  onImportRepositorySkills: importRepositorySkills,
                  onCancelRepositoryOperations: () => window.agentEnv.cancelRepositoryOperations()
                },
                sources: {
                  onCheckSourceGroup: checkSkillSourceGroup,
                  onCheckMonitoredSourceGroups: checkMonitoredSkillSourceGroups,
                  onSetSourceName: setSkillSourceName,
                  onSetSourceMonitored: setSkillSourceMonitored,
                  onSetSourceCandidateIgnored: setSkillSourceCandidateIgnored,
                  onPreviewSourceMerge: previewSkillSourceMerge,
                  onMergeSources: mergeSkillSources
                },
                catalog: {
                  onSaveUpdateSettings: saveSkillUpdateSettings,
                  onSetAvailability: setSkillAvailability,
                  onSetIcon: (input) => void setSkillIcon(input),
                  onSetTags: setSkillTags,
                  onRemoveLibrarySkill: removeLibrarySkill,
                  onPreviewSkillMerge: previewSkillMerge,
                  onMergeLibrarySkills: mergeLibrarySkills,
                  onReviewSkillUsage: reviewSkillUsage,
                  onOpenSource: (url) => {
                    void window.agentEnv.openExternalUrl(url).catch((unknownError) => {
                      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
                    });
                  },
                  onCopySource: (source) => {
                    void window.agentEnv.copyText(source).then(() => {
                      setSkillUpdateCheckStatus({
                        state: "success",
                        message: t("Repository address copied")
                      });
                    }).catch((unknownError) => {
                      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
                    });
                  }
                },
                updates: {
                  onPreviewLibrarySkillUpdate: previewLibrarySkillUpdate,
                  onCloseUpdatePreview: () => {
                    setSelectedSkillUpdatePlan(undefined);
                    skillUpdateQueue.resetRun();
                  },
                  onUpdateLibrarySkill: updateLibrarySkill,
                  onUpdateAllLibrarySkills: updateAllLibrarySkills,
                  onStopBulkLibrarySkillUpdates: skillUpdateQueue.requestStop,
                  onPreviewAllLibrarySkillUpdates: previewAllLibrarySkillUpdates,
                  onCloseBulkUpdatePreview: () => {
                    setBulkSkillUpdatePlans(undefined);
                    setBulkSkillUpdateFailures([]);
                    skillUpdateQueue.resetRun();
                    skillUpdateQueue.resetStop();
                  },
                  onCheckUpdates: checkSkillUpdates
                }
              }}
            />
          </>
        ) : activeWorkspace === "instructions" ? (
          <InstructionsWorkspace
            blocks={instructionBlocks}
            loading={instructionBlocksLoading}
            onRefresh={async () => { await refreshInstructionBlocks(); }}
            onImport={() => window.agentEnv.selectInstructionFile()}
            onCreate={createInstructionBlock}
            onUpdate={updateInstructionBlock}
            onRemove={removeInstructionBlock}
          />
        ) : activeWorkspace === "profiles" ? (
          <section className="profile-page">
              <PageHeader
                className="profile-page-header"
                title={t("Profiles")}
              help={
                <InfoTip
                  label={t("Compose reusable resources, then preview and apply them to an Agent.")}
                />
              }
            />
            <SingleObjectWorkspace
              className="profile-workbench"
              surface="open"
              aria-label={t("Profiles")}
            >
              <div className="profile-editor-surface">
                {profileLoadingId ? (
                  <div
                    className="profile-loading-surface"
                    role="status"
                    aria-live="polite"
                    aria-label={t("Loading Profile {{name}}", {
                      name: loadingProfileSummary?.name ?? t("Profile")
                    })}
                  >
                    <InspectorHeader
                      className="profile-hero profile-hero--loading"
                      responsive="stack"
                      titleLabel={loadingProfileSummary?.name ?? t("Profile")}
                      icon={(
                        <ResourceIcon
                          iconKey={loadingProfileSummary?.iconKey ?? defaultProfileIconKey}
                          size={18}
                        />
                      )}
                      title={(
                        <span className="profile-hero__title">
                          <ProfileList
                            isLoading={isLoading}
                            profiles={profiles}
                            search={profileSearch}
                            searchInputRef={profileSearchInputRef}
                            selectedProfileId={profileLoadingId ?? selectedProfileId}
                            draftProfile={draftProfile}
                            isProfileDirty={isProfileDirty}
                            profileSaveStatus={profileSaveStatus}
                            targets={profileTargets}
                            targetStates={targetStates}
                            actionsDisabled={busy}
                            variant="hero"
                            open={profileSwitcherOpen}
                            onOpenChange={setProfileSwitcherOpen}
                            onCreate={(returnFocus) => {
                              appModalFallbackFocusRef.current = returnFocus;
                              openCreateProfileDialog();
                            }}
                            onDelete={openDeleteProfileDialog}
                            onDuplicate={duplicateProfile}
                            onReorder={reorderProfiles}
                            onSearchChange={setProfileSearch}
                            onSelect={selectProfile}
                          />
                        </span>
                      )}
                      description={(
                        <span className="profile-description">{t("Loading Profile...")}</span>
                      )}
                      actions={(
                        <LoaderCircle
                          className="is-spinning profile-loading-indicator"
                          size={18}
                          strokeWidth={2.2}
                          aria-hidden="true"
                        />
                      )}
                    />
                    <div className="profile-composer profile-composer--loading" aria-hidden="true">
                      {["Instructions", "Skills", "MCPs"].map((section) => (
                        <div className="profile-loading-row" key={section}>
                          <span className="profile-loading-row__icon" />
                          <span>
                            <strong>{t(section)}</strong>
                            <small>{t("Loading...")}</small>
                          </span>
                          <span className="profile-loading-row__line" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : draftProfile ? (
                  <>
                    <InspectorHeader
                      className="profile-hero"
                      responsive="stack"
                      titleLabel={draftProfile.manifest.name}
                      icon={(
                        <ResourceIcon
                          iconKey={draftProfile.manifest.iconKey ?? defaultProfileIconKey}
                          size={18}
                        />
                      )}
                      title={(
                        <span className="profile-hero__title">
                          <ProfileList
                            isLoading={isLoading}
                            profiles={profiles}
                            search={profileSearch}
                            searchInputRef={profileSearchInputRef}
                            selectedProfileId={profileLoadingId ?? selectedProfileId}
                            draftProfile={draftProfile}
                            isProfileDirty={isProfileDirty}
                            profileSaveStatus={profileSaveStatus}
                            targets={profileTargets}
                            targetStates={targetStates}
                            actionsDisabled={busy}
                            variant="hero"
                            open={profileSwitcherOpen}
                            onOpenChange={setProfileSwitcherOpen}
                            onCreate={(returnFocus) => {
                              appModalFallbackFocusRef.current = returnFocus;
                              openCreateProfileDialog();
                            }}
                            onDelete={openDeleteProfileDialog}
                            onDuplicate={duplicateProfile}
                            onReorder={reorderProfiles}
                            onSearchChange={setProfileSearch}
                            onSelect={selectProfile}
                          />
                          <IconButton
                            aria-label={t("Edit Profile")}
                            className="profile-edit-button"
                            label={t("Edit Profile")}
                            size="compact"
                            variant="ghost"
                            onClick={openEditProfileDialog}
                          >
                            <Pencil size={13} strokeWidth={2.1} />
                          </IconButton>
                        </span>
                      )}
                      description={(
                        <span className="profile-description">
                          {draftProfile.manifest.description || t("No description")}
                        </span>
                      )}
                      actions={profileObjectActions}
                    />
                    <section
                      className="profile-composer"
                      aria-label={t("Profile composer")}
                    >
                      <ProfileInstructionsComposerSection
                        profile={draftProfile}
                        blocks={instructionBlocks}
                        summary={resourceSummary?.instructions ?? {
                          count: 0, total: 0, mode: "manage"
                        }}
                        policy={instructionsPolicy}
                        capabilityAvailable={Boolean(profileTarget?.capabilities.instructions)}
                        expanded={composerSectionIsExpanded("instructions")}
                        targetName={activeTargetName}
                        fileName={profileTarget?.instructionsLabel ?? t("Instructions")}
                        currentValue={currentTargetInstructions?.content}
                        currentValueAvailable={Boolean(currentTargetInstructions) &&
                          !nativeInstructionIssues.some((issue) => issue.targetId === selectedTarget?.id)}
                        onToggle={() => toggleComposerSection("instructions")}
                        onPolicyChange={(policy) =>
                          updateSelectedResourceManagement("instructions", policy)}
                        onChange={(instructions, resources) =>
                          updateDraftProfile({ ...draftProfile, instructions, resources })}
                      />
                      <ProfileSkillsComposerSection
                        profile={draftProfile}
                        summary={resourceSummary?.skills ?? {
                          count: 0, total: 0, names: [], mode: "manage"
                        }}
                        policy={skillsPolicy}
                        capabilityAvailable={Boolean(profileTarget?.capabilities.skills)}
                        expanded={composerSectionIsExpanded("skills")}
                        targetId={selectedAgentId}
                        targetName={activeTargetName}
                        targetState={selectedTargetState}
                        currentSkills={currentTargetSkills}
                        environmentScanStatus={environmentScanStatus}
                        librarySkills={librarySkills}
                        skillUpdates={skillUpdates}
                        checkingSkillUpdates={checkingProfileSkillUpdates}
                        onToggle={() => toggleComposerSection("skills")}
                        onPolicyChange={(policy) =>
                          updateSelectedResourceManagement("skills", policy)}
                        onReviewSharedSkills={openEnvironmentReview}
                        onRefresh={() => { void refreshSkills("manual"); }}
                        onCheckUpdates={(ids) => { void checkProfileSkillUpdates(ids); }}
                        onPreviewUpdate={(id) => { void previewLibrarySkillUpdate(id); }}
                        onChange={(resources) => updateDraftProfile({ ...draftProfile, resources })}
                      />
                      <ProfileComposerSection
                        id="mcp"
                        icon={<ProductIcon name="mcps" size={18} />}
                        title={t("MCPs")}
                        description={t(
                          "External tools and service connections"
                        )}
                        count={resourceSummary?.mcp.total ?? 0}
                        enabledCount={resourceSummary?.mcp.count ?? 0}
                        countSummary={t("Saved {{profile}} · Agent {{agent}}", {
                          profile: resourceSummary?.mcp.total ?? 0,
                          agent: (nativeMcpConnections ?? []).filter(
                            (connection) => connection.targetId === selectedTarget?.id
                          ).length
                        })}
                        chipNames={resourceSummary?.mcp.names ?? []}
                        policy={resourceSummary?.mcp.mode ?? "ignore"}
                        policyDisabled={!profileTarget?.capabilities.mcpActivation}
                        policyLabel={t("MCPs application policy for {{name}}", {
                          name: activeTargetName
                        })}
                        policyStatus={
                          selectedRemoteEndpoint
                            ? t("Keep Agent for SSH Apply")
                            : profileTarget?.capabilities.mcpActivation
                            ? undefined
                            : t("Agent controlled")
                        }
                        expanded={composerSectionIsExpanded("mcp")}
                        onToggle={() => toggleComposerSection("mcp")}
                        onPolicyChange={(policy) =>
                          updateSelectedResourceManagement("mcp", policy)
                        }
                      >
                        <ProfileMcpEditor
                          target={selectedPolicyTarget}
                          connections={selectedRemoteEndpoint ? [] : nativeMcpConnections}
                          issues={selectedRemoteEndpoint ? [] : nativeMcpIssues}
                          value={draftProfile.resources ?? emptyProfileResources}
                          onChange={(resources) =>
                            updateDraftProfile({ ...draftProfile, resources })
                          }
                          onRefresh={refreshNativeResources}
                        />
                      </ProfileComposerSection>
                    </section>
                    {rollbackPreview ? (
                      <PreviewDialog
                        preview={rollbackPreview}
                        targetNames={targetNames}
                        title={t("Rollback preview")}
                        confirmLabel={t("Restore backup")}
                        confirmDisabled={
                          busy || rollbackPreview.errors.length > 0
                        }
                        cancelDisabled={busy}
                        errorMessage={rollbackError}
                        onCancel={
                          busy
                            ? undefined
                            : () => {
                                setRollbackPreview(undefined);
                                setRollbackError(undefined);
                              }
                        }
                        onConfirm={restoreSelectedRollback}
                      />
                    ) : null}
                    {preview ? (
                      <PreviewDialog
                        preview={preview}
                        targetNames={targetNames}
                        title={t("Apply {{profile}} to {{target}}?", {
                          profile: draftProfile.manifest.name,
                          target: activeTargetName
                        })}
                        confirmLabel={t("Apply")}
                        confirmDisabled={!canApply || busy}
                        confirmBusy={isProfileApplying}
                        compareDisabled={evaluationControl.disabled}
                        compareDescription={evaluationDescription}
                        suspended={profileEvaluationOpen}
                        onOpenRecovery={selectedRemoteEndpoint ? undefined : () => {
                          clearProfilePreview();
                          setSettingsCategory("data");
                          openWorkspaceNow("settings");
                          backupRecovery.actions.revealManager();
                        }}
                        onAdoptTargetChanges={selectedRemoteEndpoint ? undefined : adoptCompatibleTargetChanges}
                        onLeaveSkillUnmanaged={selectedRemoteEndpoint ? undefined : (issue) =>
                          leavePreviewSkillUnmanaged(issue, preview.targetId, async () => {
                            if (!draftProfile) return;
                            await refreshProfilePreview(
                              draftProfile.id,
                              preview.targetId
                            );
                          })}
                        onReviewSkillCollection={selectedRemoteEndpoint ? undefined : reviewPreviewSkillCollection}
                        onManageLocalSkills={selectedRemoteEndpoint ? undefined : reviewPreviewLocalSkills}
                        onManageSharedSkills={selectedRemoteEndpoint ? undefined : openEnvironmentReview}
                        onCompare={() => void openProfileEvaluation()}
                        onCancel={clearProfilePreview}
                        onConfirm={applySelectedProfile}
                      />
                    ) : null}
                      <SkillUpdateDialog
                        plan={selectedSkillUpdatePlan}
                        busy={busy}
                        progress={selectedSkillUpdatePlan
                          ? skillUpdateQueue.run[selectedSkillUpdatePlan.id]
                          : undefined}
                        onClose={() => {
                          setSelectedSkillUpdatePlan(undefined);
                          skillUpdateQueue.resetRun();
                        }}
                        onReadChange={(previewId, path) =>
                          window.agentEnv.readLibrarySkillUpdateChange({ previewId, path })}
                        onConfirm={updateLibrarySkill}
                      />
                  </>
                ) : (
                  <div className="profile-empty-surface">
                    <div className="empty-state">
                      <h2>{t("No Profile selected")}</h2>
                      <p className="muted">{t("Choose a Profile or create one.")}</p>
                    </div>
                    {profileApplyControl}
                  </div>
                )}
              </div>
              {pendingProfileAction ? (
                <div
                  className="preview-modal-backdrop"
                  data-dismiss-policy="standard"
                  onClick={busy ? undefined : cancelPendingProfileAction}
                >
                  <section
                    ref={appModalDialogRef}
                    className="profile-form-dialog profile-form-dialog--compact"
                    role="dialog"
                    aria-label={t("Unsaved changes")}
                    aria-modal="true"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <header className="profile-dialog-header">
                      <div className="ui-dialog-header__copy">
                        <div className="section-title ui-dialog-title">
                          {t(projectEditorGuard?.dirty ? "Save changes?" : "Profile could not be saved")}
                        </div>
                        <p className="muted ui-dialog-description">
                          {projectEditorGuard?.dirty
                            ? t("Save before you {{action}}, or discard the current draft.", { action: t(pendingProfileAction.label) })
                            : t("Retry saving before you {{action}}, or restore the last saved version.", { action: t(pendingProfileAction.label) })}
                        </p>
                      </div>
                    </header>
                    <footer className="preview-actions profile-dirty-actions">
                      <Button ref={appModalInitialFocusRef} disabled={busy} onClick={cancelPendingProfileAction}>
                        {t(projectEditorGuard?.dirty ? "Cancel" : "Keep editing")}
                      </Button>
                      <Button disabled={busy} onClick={() => void continuePendingProfileAction(false)}>
                        {t(projectEditorGuard?.dirty ? "Discard changes" : "Restore saved version")}
                      </Button>
                      <Button variant="primary" disabled={busy} onClick={() => void continuePendingProfileAction(true)}>
                        {t(projectEditorGuard?.dirty ? "Save and continue" : "Retry and continue")}
                      </Button>
                    </footer>
                  </section>
                </div>
              ) : null}
              <ProfileFormDialog
                open={Boolean(
                  profileDialogMode &&
                  !(profileDialogMode === "create" && profileCreateSource === "target")
                )}
                mode={profileDialogMode ?? "create"}
                source={profileCreateSource}
                sourceChoiceComplete={Boolean(targetCapturePreview)}
                busy={busy}
                targets={targets}
                form={profileForm}
                error={profileFormError}
                iconKey={draftProfile?.manifest.iconKey ?? defaultProfileIconKey}
                dialogRef={appModalDialogRef}
                initialFocusRef={appModalInitialFocusRef}
                onSourceChange={(source) => {
                  setProfileCreateSource(source);
                  if (source !== "target") return;
                  setProfileCaptureOrigin("profiles");
                  setProfileCaptureError("");
                  const currentTarget = targets.find(
                    (target) => target.id === profileForm.targetId
                  );
                  const nextTarget =
                    currentTarget && isTargetInstalled(currentTarget.health)
                      ? currentTarget
                      : targets.find((target) =>
                          isTargetInstalled(target.health));
                  if (nextTarget) {
                    setProfileForm((current) => ({
                      ...current,
                      targetId: nextTarget.id,
                      name: current.name.trim() || nextTarget.name
                    }));
                  }
                }}
                onTargetChange={(targetId) =>
                  setProfileForm({ ...profileForm, targetId })}
                onNameChange={(name) => {
                  setProfileFormError("");
                  setProfileForm({ ...profileForm, name });
                }}
                onDescriptionChange={(description) =>
                  setProfileForm({ ...profileForm, description })}
                onIconChange={(iconKey) => {
                  if (draftProfile) changeProfileIcon(draftProfile.id, iconKey);
                }}
                onClose={closeProfileDialog}
                onSubmit={() => {
                  void submitProfileDialog();
                }}
              />
              <ProfileDeleteDialog
                open={Boolean(deleteProfileCandidateId)}
                busy={busy}
                active={isDeleteProfileCandidateActive}
                profileName={deleteProfileCandidateName}
                activeTargetNames={deleteProfileCandidateActiveTargets}
                dialogRef={appModalDialogRef}
                initialFocusRef={appModalInitialFocusRef}
                onClose={closeProfileDialog}
                onDelete={() => {
                  void deleteProfile();
                }}
                onOpenAgents={() => {
                  closeProfileDialog();
                  openWorkspaceNow("targets");
                }}
              />
              {profileEvaluationOpen && draftProfile && selectedTarget ? (
                <ProfileEvaluationDialog
                  open
                  profile={draftProfile}
                  target={selectedTarget}
                  returnFocusRef={profileActionsButtonRef}
                  onClose={() => setProfileEvaluationOpen(false)}
                  onReviewApply={() => {
                    setProfileEvaluationOpen(false);
                    window.requestAnimationFrame(() => void previewSelectedProfile());
                  }}
                />
              ) : null}
              {profileRecoveryMode && draftProfile ? (
                <ProfileRecoveryDialog
                  mode={profileRecoveryMode}
                  open
                  profileId={draftProfile.id}
                  profileName={draftProfile.manifest.name}
                  targetName={selectedTarget?.name}
                  appliedSnapshot={selectedAppliedProfileSnapshot}
                  onClose={() => setProfileRecoveryMode(undefined)}
                  onRestored={async (restored) => {
                    await refreshProfiles();
                    replaceSavedProfile(restored, "Profile restored");
                    clearProfilePreview();
                    setRollbackPreview(undefined);
                  }}
                  onRestoreApplied={async () => {
                    if (!draftProfile || !selectedTarget) return;
                    const current = isProfileDirty || isProfileSaving
                      ? await saveDraft()
                      : draftProfile;
                    if (!current) throw new Error("Profile is unavailable");
                    const restored = await window.agentEnv.restoreAppliedProfile(
                      current.id,
                      selectedTarget.id,
                      current.contentHash ?? ""
                    );
                    await refreshProfiles();
                    replaceSavedProfile(restored, "Profile restored to last applied version");
                    clearProfilePreview();
                    setRollbackPreview(undefined);
                  }}
                />
              ) : null}
            </SingleObjectWorkspace>
          </section>
        ) : activeWorkspace === "projects" ? (
          <ProjectsWorkspace
            targets={targets}
            uiState={uiState}
            onUpdateUiState={persistUiState}
            onEditorGuardChange={setProjectEditorGuard}
            openRequest={projectOpenRequest}
            editorGuardPromptOpen={Boolean(pendingProfileAction && projectEditorGuard?.dirty)}
          />
        ) : activeWorkspace === "conversations" ? (
          <ConversationWorkspace
            targets={targets}
            initialViewState={conversationViewState}
            onViewStateChange={setConversationViewState}
            openRequest={conversationQuickOpen.openRequest}
            onOpenRequestHandled={conversationQuickOpen.handleOpenRequest}
            onOpenProject={(project) => {
              setProjectOpenRequest({ requestId: Date.now(), projectId: project.id });
              openWorkspaceNow("projects");
            }}
          />
        ) : activeWorkspace === "targets" ? (
            <TargetWorkspace
              targets={targets}
              remoteDevices={remote.devices}
              remoteEndpoints={remote.endpoints}
              remoteDevicesBusy={remote.busy}
              detectedDisabledAgentCount={detectedDisabledAgents.length}
              targetStates={targetStates}
              environmentReview={environmentReview}
              targetNames={targetNames}
              mcpConnections={nativeMcpConnections ?? []}
              backups={backups}
              rollbackPreview={rollbackPreview}
              rollbackError={rollbackError}
              stopManagingPreview={stopManagingPreview}
              isLoading={isLoading}
              busy={busy}
              freshness={freshnessStates.agents}
              onRefresh={async () => {
                await Promise.all([refreshTargets(), remote.refresh(true)]);
              }}
              onRefreshRemoteDevices={() => remote.refresh(true)}
              onAddRemoteDevice={remote.add}
              onUpdateRemoteDevice={remote.update}
              onRemoveRemoteDevice={removeRemoteDevice}
              onReorder={reorderAgents}
              onChooseAgents={openAgentChooser}
              onChooseSetupAgent={openAgentSetup}
              onConfigure={openAgentConfiguration}
              onReviewEnvironment={openEnvironmentReview}
              onCreateProfileFromTarget={(targetId, returnFocus) =>
                openCreateFromTargetDialog(targetId, "all", returnFocus)}
              onManageSkills={openTargetSkillManager}
              onPreviewRollback={previewSelectedRollback}
              onCancelRollback={() => {
                setRollbackPreview(undefined);
                setRollbackError(undefined);
              }}
              onRestoreRollback={restoreSelectedRollback}
              onPreviewStopManaging={previewStopManaging}
              onCancelStopManaging={() => setStopManagingPreview(undefined)}
              onStopManaging={confirmStopManaging}
            />
        ) : activeWorkspace === "settings" ? (
          <section className="settings-page" aria-label={t("Settings")}>
            <PageHeader
              className="page-header"
              title={t("Settings")}
            />
            <SettingsCategoryTabs active={settingsCategory} onChange={setSettingsCategory} />
            <div
              className="settings-category-frame"
              id="settings-category-panel"
              role="tabpanel"
              aria-labelledby={`settings-tab-${settingsCategory}`}
            >
            <div className="settings-category-panel">
            {settingsCategory === "general" ? (
              <>
              <GeneralSettingsSection
                locale={skillSettings.locale}
                onLocaleChange={(locale) => updateSkillSettings({ locale })}
                conversationTerminal={skillSettings.conversationTerminal}
                onConversationTerminalChange={(conversationTerminal) =>
                  updateSkillSettings({ conversationTerminal })}
              />
              <AppUpdateSettings
                busy={busy}
                settings={skillSettings}
                onChange={(input) => void updateSkillSettings(input)}
                onOpenConnections={openGitHubConnectionSettings}
              />
              </>
            ) : null}
            {settingsCategory === "agents" ? (
            <AgentSettingsSection
              supportedAgents={supportedTargets}
              enabledAgentIds={
                enabledAgentIds
              }
              agents={agentProbeComplete ? discoveredTargets : targets}
              agentStates={targetStates}
              suppressedAgentIds={skillSettings.suppressedAgentSuggestionIds ?? []}
              busy={busy}
              onReorder={reorderAgents}
              onSetEnabled={setAgentEnabled}
              onRestoreAgentSuggestions={restoreAllAgentSuggestions}
              onOpenRecovery={() => openWorkspaceNow("targets")}
              configRoots={skillSettings.targetConfigRoots ?? {}}
              commandOverrides={skillSettings.targetCommandOverrides ?? {}}
              onChooseConfigRoot={chooseTargetConfigRoot}
              onResetConfigRoot={resetTargetConfigRoot}
              onSetCommandOverride={setTargetCommandOverride}
            />
            ) : null}
            {settingsCategory === "skills" ? (
              <SkillSettingsSection
                busy={busy}
                settings={skillSettings}
                onChange={(input) => void updateSkillSettings(input)}
              />
            ) : null}
            {settingsCategory === "connections" ? (
              <>
                <WorkspaceSyncSettings onWorkspaceChanged={refreshWorkspaceStateAfterSync} />
                <GitHubConnectionSettings
                  authStatus={githubAuthStatus}
                  busy={busy}
                  codeCopied={githubCodeCopied}
                  deviceLogin={githubDeviceLogin}
                  loginChecking={githubLoginChecking}
                  loginMessage={githubLoginMessage}
                  onCheckLogin={() => void githubConnection.actions.pollLogin()}
                  onCopyCode={() => void githubConnection.actions.copyDeviceCode()}
                  onOpenDevicePage={(url) => void githubConnection.actions.openDevicePage(url)}
                  onSignIn={() => {
                    backupRecovery.actions.clearDataBackupStatus();
                    void githubConnection.actions.startLogin();
                  }}
                  onSignOut={() => void githubConnection.actions.signOut()}
                />
              </>
            ) : null}
            {settingsCategory === "data" ? (
            <>
            <DataSettingsSection
              backupRetentionDays={skillSettings.backupRetentionDays}
              busy={busy}
              freshness={freshnessStates.backups}
              inventory={managedBackups}
              inventoryLoading={managedBackupsLoading}
              onBackupRetentionChange={(backupRetentionDays) => {
                void updateSkillSettings({ backupRetentionDays });
              }}
              onExport={() => void backupRecovery.actions.createDataBackup()}
              onManageBackups={backupRecovery.actions.openManager}
              onOpenFolder={() => void window.agentEnv.openDataFolder()}
              onRestore={() => void backupRecovery.actions.selectDataRestore()}
            />
            <TelemetrySettings
              busy={busy}
              settings={skillSettings}
              onChange={(input) => void updateSkillSettings(input)}
            />
            <DiagnosticSettingsSection
              busy={busy}
              onCopyLatest={copyLatestDiagnosticIssue}
              onExport={exportDiagnosticReport}
              onOpenLogs={openDiagnosticLogFolder}
            />
            </>
            ) : null}
            </div>
            </div>
            {backupManagerOpen ? (
              <BackupManagerDialog
                busy={busy}
                cleanupConfirm={backupCleanupConfirm}
                deleteCandidate={backupDeleteCandidate}
                dialogRef={appModalDialogRef}
                initialFocusRef={appModalInitialFocusRef}
                inventory={managedBackups}
                inventoryLoading={managedBackupsLoading}
                notice={backupManagerNotice}
                preview={managedBackupPreview}
                previewCandidate={backupPreviewCandidate}
                previewLoading={managedBackupPreviewLoading}
                formatBytes={formatBytes}
                formatDate={formatDate}
                onBackOrClose={backupRecovery.actions.closeManager}
                onCancelCleanup={backupRecovery.actions.cancelCleanup}
                onCancelDelete={backupRecovery.actions.cancelDelete}
                onCleanup={() => void backupRecovery.actions.cleanupBackups()}
                onDelete={() => void backupRecovery.actions.deleteSelectedBackup()}
                onOpenCleanupConfirm={backupRecovery.actions.openCleanupConfirm}
                onOpenDelete={backupRecovery.actions.openDelete}
                onPreview={(item) => void backupRecovery.actions.previewBackup(item)}
              />
            ) : null}
            {dataRestorePreview ? (
              <div
                className="preview-modal-backdrop"
                data-dismiss-policy="standard"
                onClick={() => {
                  if (!busy) backupRecovery.actions.dismissDataRestore();
                }}
              >
                <section ref={appModalDialogRef} className="profile-form-dialog profile-form-dialog--compact data-restore-dialog ui-dialog-shell" role="dialog" aria-modal="true" aria-label={t("Restore AgentEnv data")} onClick={(event) => event.stopPropagation()}>
                  <header className="profile-dialog-header ui-dialog-header">
                    <div className="ui-dialog-header__copy">
                      <div className="section-title ui-dialog-title">{t("Restore AgentEnv data")}</div>
                      <p className="muted ui-dialog-description">{t("Replace current Profiles, Library resources, settings, deployment state, and recovery history.")}</p>
                    </div>
                  </header>
                  <div className="data-restore-summary ui-dialog-body">
                    <span><strong>{t("Created")}</strong>{formatDate(dataRestorePreview.createdAt)}</span>
                    <span><strong>{t("Format")}</strong>{t("Version {{version}}", { version: dataRestorePreview.formatVersion })}</span>
                    <span><strong>{t("Contents")}</strong>{t("{{count}} top-level items", { count: dataRestorePreview.topLevelItemCount })}</span>
                    <code title={dataRestorePreview.path}>{dataRestorePreview.path}</code>
                    <p>{t("A safety backup of the current data will be created before replacement.")}</p>
                  </div>
                  <footer className="preview-actions ui-dialog-footer">
                    <Button ref={appModalInitialFocusRef} disabled={busy} onClick={backupRecovery.actions.dismissDataRestore}>{t("Cancel")}</Button>
                    <Button variant="danger" disabled={busy} onClick={() => void backupRecovery.actions.applyDataRestore()}>{t("Restore data")}</Button>
                  </footer>
                </section>
              </div>
            ) : null}
          </section>
        ) : rollbackPreview ? (
          <PreviewDialog
            preview={rollbackPreview}
            targetNames={targetNames}
            title={t("Rollback preview")}
          />
        ) : (
          <div className="empty-state">
            <h2>{t("No Profile selected")}</h2>
          </div>
        )}
        {pendingSkillImport ? (
          <SkillImportConflictDialog
            key={pendingSkillImport.preview.incoming.contentHash}
            pending={pendingSkillImport}
            dialogRef={appModalDialogRef}
            initialFocusRef={appModalInitialFocusRef}
            onDismiss={dismissSkillImport}
            onConfirm={confirmSkillImport}
          />
        ) : null}
        {profileDialogMode === "create" && profileCreateSource === "target" ? (
          <TargetCaptureDialog
            target={targets.find((target) => target.id === profileForm.targetId)}
            targets={targets}
            name={profileForm.name}
            origin={profileCaptureOrigin}
            scope={profileCaptureScope}
            preview={targetCapturePreview}
            activity={profileCaptureActivity}
            nameError={profileFormError}
            flowError={profileCaptureError}
            decisions={targetCaptureDecisions}
            dialogRef={appModalDialogRef}
            initialFocusRef={appModalInitialFocusRef}
            onNameChange={(name) => {
              setProfileFormError("");
              setProfileCaptureError("");
              setProfileForm((current) => ({ ...current, name }));
            }}
            onTargetChange={(targetId) => {
              const target = targets.find((candidate) => candidate.id === targetId);
              setTargetCapturePreview(undefined);
              setTargetCaptureDecisions([]);
              setProfileCaptureError("");
              setProfileForm((current) => ({
                ...current,
                targetId,
                name: target?.name ?? current.name
              }));
            }}
            onBack={() => {
              setTargetCapturePreview(undefined);
              setTargetCaptureDecisions([]);
              setProfileCaptureError("");
            }}
            onCancel={closeProfileDialog}
            onReview={() => void reviewTargetCapture()}
            onCreate={() => void submitProfileDialog()}
            onRefreshReview={() => void reviewTargetCapture()}
            onDecisionChange={(decision) => {
              setProfileCaptureError("");
              setTargetCaptureDecisions((current) => [
                ...current.filter((item) => item.issueId !== decision.issueId),
                decision
              ]);
            }}
          />
        ) : null}
        <DiagnosticIssueDialog
          issue={diagnosticIssue}
          onDismiss={() => setDiagnosticIssue(undefined)}
        />
        <TelemetryConsentDialog
          busy={telemetryConsent.saving}
          open={telemetryConsent.open}
          preview={telemetryConsent.preview}
          onDismiss={telemetryConsent.dismiss}
          onDecide={telemetryConsent.decide}
        />
        <SkillManagementMigrationDialog
          busy={busy}
          {...skillManagementMigration}
          onReview={() => { skillManagementMigration.onReview(); void openSkillDiscoveries(); }}
        />
        <AgentDiscoveryDialog
          agents={visibleAgentSuggestions}
          allowSuggestionPreferences={allowSuggestionPreferences}
          busy={busy}
          open={agentDiscoveryDialogOpen}
          phase={agentDiscoveryDialogPhase}
          setupActions={agentSetupActions}
          onDismiss={dismissAgentSuggestions}
          onEnable={enableSuggestedAgents}
          onConfigure={(targetId) => {
            dismissAgentSuggestions();
            openAgentConfiguration(targetId);
          }}
          onSuppress={suppressAgentSuggestion}
        />
      </section>

    </main>
  );
};

export const App = () => {
  const [localePreference, setLocalePreference] = useState<AppLocale>("system");
  const updateLocalePreference = useCallback((locale: AppLocale) => {
    setLocalePreference(locale);
  }, []);

  return (
    <I18nProvider preference={localePreference}>
      <AppContent onLocalePreferenceChange={updateLocalePreference} />
    </I18nProvider>
  );
};
