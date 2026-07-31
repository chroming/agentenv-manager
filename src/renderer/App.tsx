import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction
} from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FolderOpen,
  GitFork,
  HardDrive,
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
  DataRestorePreview,
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
  BackupRetentionDays,
  GitHubAuthStatus,
  GitHubDeviceLogin,
  GitHubDeviceLoginResult,
  GitHubSkillImportInput,
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  RepositorySkillImportInput,
  RepositorySkillImportResult,
  RepositorySkillScanResult,
  RepositorySkillSourceInput,
  LibraryResourceVersions,
  ManageTargetSkillInput,
  ManagedBackupInventory,
  ManagedBackupItem,
  ManagedBackupPreview,
  NativeMcpConnection,
  NativeMcpInspectionIssue,
  RetireSharedSkillInput,
  SharedSkillRetentionInput,
  SkillInventoryEntry,
  SkillImportConflictResolution,
  SkillImportInput,
  SkillImportPreviewInput,
  SkillAvailabilityInput,
  SkillIconInput,
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
  SkillCollectionMemberDecisionUpdate,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdatePreviewBatchResult,
  SkillUpdateSettingsInput,
  TargetDescriptor,
  TargetInfo,
  TargetCapturePreview,
  TargetManagementState,
  UnmanagedSkillLocationUpdate
} from "../shared/types";
import { profileWithoutLocalSkillOverrides } from "../shared/effectiveProfile";
import { I18nProvider, useI18n } from "./i18n";
import { acceptAppliedProfileState } from "./appliedProfileState";
import { activationPreviewHasWork } from "./activationPreview";
import { formatDiagnosticIssue, parseDiagnosticErrorMessage } from "./diagnostics";
import { moveSharedSkillToAgents } from "./sharedSkillMigration";
import { runSkillCollectionMigration } from "./skillCollectionMigrationAction";
import type { SkillCollectionLinkGroup } from "../shared/skillCleanup";
import { collectLibraryResourceVersions, libraryResourceVersionsEqual } from "../shared/libraryVersions";
import { isTargetInstalled } from "../shared/targetHealth";
import { isExternalSkillImportable } from "../shared/skillIdentity";
import {
  setProfileResourceMode,
  type ManagedProfileResource
} from "../shared/profileResources";
import { AgentsEditor } from "./components/AgentsEditor";
import { AgentSettingsSection } from "./components/AgentSettingsSection";
import {
  AppFeedback,
  type AppFeedbackMessage
} from "./components/AppFeedback";
import { DiagnosticSettingsSection } from "./components/DiagnosticSettingsSection";
import {
  BackupManagerDialog,
  type BackupManagerNotice
} from "./components/BackupManagerDialog";
import { DataRootPath } from "./components/DataRootPath";
import { DiagnosticIssueDialog } from "./components/DiagnosticIssueDialog";
import { FreshnessStatus } from "./components/FreshnessStatus";
import { InfoTip } from "./components/InfoTip";
import {
  ConversationWorkspace,
  preloadConversationList,
  type ConversationWorkspaceViewState
} from "./components/ConversationWorkspace";
import { LibraryHeaderActions } from "./components/LibraryHeaderActions";
import { PreviewDialog } from "./components/PreviewDialog";
import { ProfileMcpEditor } from "./components/ProfileMcpEditor";
import { ProfileDeleteDialog } from "./components/ProfileDeleteDialog";
import { ProfileFormDialog } from "./components/ProfileFormDialog";
import { QuickOpen } from "./components/QuickOpen";
import { ProfileList } from "./components/ProfileList";
import { ProfileActionsMenu } from "./components/ProfileActionsMenu";
import { ProfileComposerSection } from "./components/ProfileComposerSection";
import { ResourceIconPicker } from "./components/ResourceIconPicker";
import { GeneralSettingsSection, SettingsCategoryTabs, type SettingsCategory } from "./components/SettingsCategoryTabs";
import {
  appShellClassName, ProfileSidebar, targetIconFor, type AppWorkspace
} from "./components/ProfileSidebar";
import {
  SkillLibraryPanel
} from "./components/SkillLibraryPanel";
import {
  repositoryImportProgressKey,
  type PreparedSkillTarget,
  type SkillImportQueueOptions,
  type SkillUpdateCheckStatus
} from "./skillLibraryContracts";
import { SkillUpdateDialog } from "./components/SkillUpdateDialog";
import {
  SkillImportConflictDialog,
  type PendingSkillImport
} from "./components/SkillImportConflictDialog";
import { SkillSettingsSection } from "./components/SkillSettingsSection";
import { SkillsEditor } from "./components/SkillsEditor";
import { TargetCaptureDialog } from "./components/TargetCaptureDialog";
import { TargetWorkspace } from "./components/TargetWorkspace";
import { WorkspaceSyncSettings } from "./components/WorkspaceSyncSettings";
import { createValidationRows } from "./profileValidationRows";
import { defaultProfileIconKey, ProductIcon } from "./productIcons";
import {
  updateAppliedTargetLibraryVersions,
  updateCopiedSkillInventory,
  updateProfileLibraryVersions
} from "./libraryUpdateState";
import { runSkillImportQueue } from "./skillImportQueue";
import { useSkillUpdateActivity, type SkillUpdateActivity } from "./skillUpdateActivity";
import {
  runSkillUpdateQueue,
  type SkillUpdateRun,
  type SkillUpdateRunItem
} from "./skillUpdateQueue";
import {
  ActionMenu,
  Button,
  ControlGroup,
  focusInitialActionMenuItem,
  PageHeader
} from "./components/ui";
import {
  deriveApplyActionLabel,
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
import { useAgentRefresh } from "./hooks/useAgentRefresh";
import { useWorkspaceFreshness } from "./hooks/useWorkspaceFreshness";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import { useSidebarState } from "./hooks/useSidebarState";
import { useConversationQuickOpen } from "./hooks/useConversationQuickOpen";
import { useProfileActionGuard } from "./hooks/useProfileActionGuard";
import { useProfileDraftController } from "./hooks/useProfileDraftController";
import { useProfileActivationController } from "./hooks/useProfileActivationController";
import {
  preferredTargetForProfile,
  summarizeProfile
} from "./profileSummary";
import { buildQuickOpenItems } from "./quickOpenItems";
import {
  reconcileImportedSkillUpdates,
  summarizeSkillUpdateChecks,
  summarizeSkillUpdateResult,
  updatesFromSourceGroups
} from "./skillUpdateSummary";
import { createTargetNameIndex } from "./targetPresentation";
import {
  monitoredSkillSourcesDue,
  oldestMonitoredSkillCheckAt
} from "./freshness";
import {
  deriveEnvironmentReview,
  type EnvironmentScanStatus
} from "./environmentReview";

const emptyProfileResources: ProfileResources = {
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

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
};

export { AppFeedback };

const isGitHubRateLimitError = (message: string) =>
  /github.*(?:rate limit|api limit)|(?:rate limit|api limit).*github/i.test(message);

const AppContent = ({
  onLocalePreferenceChange
}: {
  onLocalePreferenceChange(locale: AppLocale): void;
}) => {
  const { t, formatDate, formatNumber } = useI18n();
  const [supportedTargets, setSupportedTargets] = useState<TargetDescriptor[]>([]);
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const targetNames = useMemo(
    () => ({
      ...createTargetNameIndex(supportedTargets),
      "shared-compatibility": t("Shared Skills")
    }),
    [supportedTargets, t]
  );
  const [targetStates, setTargetStates] = useState<TargetManagementState[]>([]);
  const [nativeMcpConnections, setNativeMcpConnections] =
    useState<NativeMcpConnection[]>();
  const [nativeMcpIssues, setNativeMcpIssues] = useState<NativeMcpInspectionIssue[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [librarySkills, setLibrarySkills] = useState<SkillLibraryEntry[]>([]);
  const [skillSourceGroups, setSkillSourceGroups] = useState<SkillSourceGroupView[]>([]);
  const [skillLibraryMode, setSkillLibraryMode] = useState<"skills" | "sources">("skills");
  const [skillUpdates, setSkillUpdates] = useState<SkillUpdateInfo[]>([]);
  const [skillInventory, setSkillInventory] = useState<SkillInventoryEntry[]>([]);
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
  const [skillUpdateRun, setSkillUpdateRun] = useState<SkillUpdateRun>({});
  const [profileLibraryVersions, setProfileLibraryVersions] = useState<
    Record<string, LibraryResourceVersions>
  >({});
  const [skillSettings, setSkillSettings] = useState<AgentEnvSettings>({
    locale: "system",
    conversationTerminal: "default",
    skillSyncMethod: "auto",
    skillStorageLocation: "appData",
    skillAutoCheckEnabled: true,
    skillAutoCheckIntervalMinutes: 60,
    backupRetentionDays: null
  });
  const [githubAuthStatus, setGithubAuthStatus] = useState<GitHubAuthStatus>({
    state: "signed-out"
  });
  const [githubDeviceLogin, setGithubDeviceLogin] = useState<GitHubDeviceLogin>();
  const [githubLoginMessage, setGithubLoginMessage] = useState("");
  const [githubLoginChecking, setGithubLoginChecking] = useState(false);
  const [githubCodeCopied, setGithubCodeCopied] = useState(false);
  const githubLoginPollingRef = useRef(false);
  const githubCopyResetRef = useRef<number | undefined>(undefined);
  const [skillUsage, setSkillUsage] = useState<Record<string, string[]>>({});
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [profileTargetSelections, setProfileTargetSelections] = useState<Record<string, string>>({});
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview>();
  const [stopManagingPreview, setStopManagingPreview] = useState<StopManagingPreview>();
  const [rollbackError, setRollbackError] = useState<string>();
  const {
    activeWorkspace,
    initialWorkspacePreference,
    markWorkspacePreferenceReady,
    openWorkspaceNow
  } = useWorkspaceNavigation();
  const { sidebarCollapsed, toggleSidebar } = useSidebarState();
  const [conversationViewState, setConversationViewState] = useState<ConversationWorkspaceViewState>();

  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("general");
  const [quickOpen, setQuickOpen] = useState(false);
  const [skillLibraryViewState, setSkillLibraryViewState] = useState(
    defaultSkillLibraryViewState
  );
  const [skillLibraryTool, setSkillLibraryTool] = useState<"import" | "discoveries">();
  const [skillCleanupScope, setSkillCleanupScope] =
    useState<"all" | "shared">("all");
  const [skillCollectionFocusPath, setSkillCollectionFocusPath] = useState<string>();
  const [skillUpdateCheckStatus, setSkillUpdateCheckStatus] =
    useState<SkillUpdateCheckStatus>();
  const [skillUpdateFeedbackWorkspace, setSkillUpdateFeedbackWorkspace] =
    useState<"library" | "profiles" | "targets">("library");
  const [checkingProfileSkillUpdates, setCheckingProfileSkillUpdates] = useState(false);
  const [profileMetadataSavingId, setProfileMetadataSavingId] = useState<string>();
  const [settingsSaveStatus, setSettingsSaveStatus] = useState("");
  const [dataBackupStatus, setDataBackupStatus] = useState("");
  const [dataRestorePreview, setDataRestorePreview] = useState<DataRestorePreview>();
  const [managedBackups, setManagedBackups] = useState<ManagedBackupInventory>();
  const [managedBackupsLoading, setManagedBackupsLoading] = useState(false);
  const [backupManagerOpen, setBackupManagerOpen] = useState(false);
  const [backupPreviewCandidate, setBackupPreviewCandidate] = useState<ManagedBackupItem>();
  const [managedBackupPreview, setManagedBackupPreview] = useState<ManagedBackupPreview>();
  const [managedBackupPreviewLoading, setManagedBackupPreviewLoading] = useState(false);
  const [backupDeleteCandidate, setBackupDeleteCandidate] = useState<ManagedBackupItem>();
  const [backupCleanupConfirm, setBackupCleanupConfirm] = useState(false);
  const [backupManagerNotice, setBackupManagerNotice] = useState<BackupManagerNotice>();
  const [targetRefreshStatus, setTargetRefreshStatus] = useState<"refreshing" | "refreshed">();
  const [skillRefreshStatus, setSkillRefreshStatus] = useState<"refreshing" | "refreshed">();
  const [profileSearch, setProfileSearch] = useState("");
  const [activeComposerSection, setActiveComposerSection] =
    useState<ComposerSection>();
  const [isTargetMenuOpen, setIsTargetMenuOpen] = useState(false);
  const [isProfileActionsOpen, setIsProfileActionsOpen] = useState(false);
  const [profileDialogMode, setProfileDialogMode] = useState<ProfileDialogMode>();
  const [profileCreateSource, setProfileCreateSource] = useState<ProfileCreateSource>("blank");
  const [profileCaptureOrigin, setProfileCaptureOrigin] = useState<ProfileCaptureOrigin>("profiles");
  const [profileCaptureScope, setProfileCaptureScope] =
    useState<"all" | "skills">("all");
  const [profileCaptureActivity, setProfileCaptureActivity] = useState<ProfileCaptureActivity>("idle");
  const [targetCapturePreview, setTargetCapturePreview] = useState<TargetCapturePreview>();
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
  const profilePageActionsRef = useRef<HTMLDivElement>(null);
  const profileObjectActionsRef = useRef<HTMLDivElement>(null);
  const profileApplyControlRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const targetMenuButtonRef = useRef<HTMLButtonElement>(null);
  const targetMenuRef = useRef<HTMLDivElement>(null);
  const profileActionsButtonRef = useRef<HTMLButtonElement>(null);
  const profileActionsMenuRef = useRef<HTMLDivElement>(null);
  const profileSearchInputRef = useRef<HTMLInputElement>(null);
  const skillSearchInputRef = useRef<HTMLInputElement>(null);
  const dataRefreshRequestRef = useRef(0);
  const skillUpdateResultRevisionRef = useRef(0);
  const rollbackReturnFocusRef = useRef<HTMLElement | null>(null);
  const dataRestoreReturnFocusRef = useRef<HTMLElement | null>(null);
  const backupManagerReturnFocusRef = useRef<HTMLElement | null>(null);
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
    onDraftInvalidated: invalidateProfilePresentation
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
    onTargetStatesRefresh: setTargetStates,
    translate: t
  });
  resetProfileActivationRef.current = resetProfileActivation;
  const { activity: skillUpdateActivity, activityRef: skillUpdateActivityRef,
    begin: beginSkillUpdateActivity, finish: finishSkillUpdateActivity
  } = useSkillUpdateActivity(() => setSkillRefreshStatus(undefined));
  const {
    states: freshnessStates,
    markFresh,
    run: runFreshness
  } = useFreshnessCoordinator();
  const activeLibraryView =
    activeWorkspace === "library" && skillLibraryMode === "skills" ? "skills" : undefined;
  const refreshSkillSourceGroups = useCallback(async () => {
    try {
      setSkillSourceGroups(await window.agentEnv.listSkillSourceGroups());
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, []);
  const refreshManagedBackups = useCallback(async (
    reason: "page-entry" | "mutation" | "manual" = "manual"
  ) => {
    try {
      await runFreshness("backups", reason, async () => {
        setManagedBackupsLoading(true);
        try {
          const inventory = await window.agentEnv.listManagedBackups();
          setManagedBackups(inventory);
          return inventory;
        } finally {
          setManagedBackupsLoading(false);
        }
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error
        ? unknownError.message
        : String(unknownError);
      if (reason === "manual") setError(message);
      else console.warn(`[AgentEnv] Recovery storage refresh failed: ${message}`);
    }
  }, [runFreshness]);
  const refreshNativeMcpConnections = useCallback(async () => {
    try {
      const inspection = await window.agentEnv.listNativeMcpConnections();
      setNativeMcpConnections(inspection.connections);
      setNativeMcpIssues(inspection.issues);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : String(unknownError)
      );
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
    if (activeWorkspace !== "settings") return;
    void refreshManagedBackups("page-entry");
  }, [activeWorkspace, refreshManagedBackups]);

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
    if (settingsSaveStatus !== "Settings saved") {
      return undefined;
    }
    const timeout = window.setTimeout(() => setSettingsSaveStatus(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [settingsSaveStatus]);

  useEffect(() => {
    if (targetRefreshStatus !== "refreshed") {
      return undefined;
    }
    const timeout = window.setTimeout(() => setTargetRefreshStatus(undefined), 2400);
    return () => window.clearTimeout(timeout);
  }, [targetRefreshStatus]);

  useEffect(() => {
    if (skillRefreshStatus !== "refreshed") {
      return undefined;
    }
    const timeout = window.setTimeout(() => setSkillRefreshStatus(undefined), 5000);
    return () => window.clearTimeout(timeout);
  }, [skillRefreshStatus]);

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
    const skillItemsPromise = window.agentEnv.listSkillLibrary();
    const nativeMcpPromise = window.agentEnv.listNativeMcpConnections();
    void nativeMcpPromise
      .then((inspection) => {
        if (shouldApply()) {
          setNativeMcpConnections(inspection.connections);
          setNativeMcpIssues(inspection.issues);
        }
      })
      .catch((unknownError) => {
        if (shouldApply()) {
          setNativeMcpConnections(undefined);
          setNativeMcpIssues([]);
          console.warn(
            `[AgentEnv] Native MCP diagnostics are unavailable: ${
              unknownError instanceof Error ? unknownError.message : String(unknownError)
            }`
          );
        }
      });
    void loadSkillCleanupHistory(shouldApply);
    void loadTargetRecoveryHistory(shouldApply);
    const corePromise = Promise.all([
      window.agentEnv.listSupportedTargets(),
      window.agentEnv.listTargets(forceTargetRefresh),
      window.agentEnv.listTargetStates(),
      window.agentEnv.listProfiles(),
      skillItemsPromise,
      settingsOverride ?? window.agentEnv.readSettings()
    ]);

    const skillItems = await skillItemsPromise;
    if (shouldApply()) {
      setLibrarySkills(skillItems);
    }

    const [
      supportedTargetItems,
      targetItems,
      targetStateItems,
      profileItems,
      ,
      settings
    ] = await corePromise;

    if (!shouldApply()) {
      return {
        supportedTargetItems,
        targetItems,
        targetStateItems,
        profileItems,
        skillItems,
        settings
      };
    }

    setSupportedTargets(supportedTargetItems);
    setTargets(targetItems);
    setTargetStates(
      targetStateItems.map((targetState) => ({
        ...targetState,
        activeProfileName:
          profileItems.find((profile) => profile.id === targetState.activeProfileId)?.name ??
          targetState.activeProfileName
      }))
    );
    setProfiles(profileItems);
    setSkillSettings(settings);
    markFresh("agents");
    markFresh("skill-library");
    onLocalePreferenceChange(settings.locale);
    setSelectedTargetId((current) =>
      current && targetItems.some((target) => target.id === current)
        ? current
        : targetItems[0]?.id
    );

    return {
      supportedTargetItems,
      targetItems,
      targetStateItems,
      profileItems,
      skillItems,
      settings
    };
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
        ).then((outcome) => outcome.value ?? []),
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
      setSkillInventory(skillInventoryResult.value);
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
    setGithubAuthStatus(githubStatus);
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

  const refreshSkills = async (
    reason: "page-entry" | "focus" | "mutation" | "manual" = "manual"
  ) => {
    const announce = reason === "manual";
    if (announce) {
      setError(undefined);
      setSkillRefreshStatus("refreshing");
    }
    try {
      await runFreshness("skill-library", reason, async () => {
        setEnvironmentScanStatus("checking");
        const inventoryPromise = runFreshness(
          "local-skills",
          reason,
          () => window.agentEnv.scanSkillInventory()
        ).then((outcome) => outcome.value ?? skillInventory);
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
        setSkillInventory(inventoryItems);
        setEnvironmentScanStatus("ready");
        setSkillSourceGroups(sourceGroupItems);
        return skillItems;
      });
      if (announce) setSkillRefreshStatus("refreshed");
    } catch (unknownError) {
      if (announce) {
        setSkillRefreshStatus(undefined);
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

  const applyLibraryContentUpdatesLocally = (updatedSkills: SkillLibraryEntry[]) => {
    if (updatedSkills.length === 0) return;
    const updatesById = new Map(updatedSkills.map((skill) => [skill.id, skill]));
    setLibrarySkills((current) =>
      current.map((skill) => updatesById.get(skill.id) ?? skill)
    );
    setSkillInventory((current) => updateCopiedSkillInventory(current, updatedSkills));
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
      updateAppliedTargetLibraryVersions(current, updatedSkills));
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
    void preloadConversationList().catch(() => undefined);
    const requestId = ++dataRefreshRequestRef.current;
    const shouldApply = () => isMounted && dataRefreshRequestRef.current === requestId;

    loadProfileCore(undefined, shouldApply)
      .then(async (core) => {
        if (!shouldApply()) {
          return;
        }

        setIsLoading(false);
        void loadProfileEnrichment(core, true, shouldApply).catch((unknownError) => {
          if (shouldApply()) {
            setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
          }
        });

        const { profileItems, targetItems, targetStateItems } = core;
        const usableProfiles = profileItems.filter((profile) => !profile.loadError);
        if (!initialWorkspacePreference) {
          markWorkspacePreferenceReady();
        }
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
          usableProfiles.find((profile) => profile.id === activeProfileId) ??
          usableProfiles.find(
            (profile) => !initialTargetId || profile.preferredTargetId === initialTargetId
          ) ??
          usableProfiles[0];
        const initialProfileTargetId =
          initialTargetId ?? initialProfile.preferredTargetId ?? targetItems[0]?.id;
        setSelectedTargetId(initialProfileTargetId);
        setProfileTargetSelections({ [initialProfile.id]: initialProfileTargetId });
        setActiveComposerSection(activeProfileId === initialProfile.id ? "skills" : undefined);
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
    dirty: isProfileDirty,
    onBusyChange: setBusy,
    onDiscard: discardProfileDraft,
    onError: setError,
    onSave: saveDraft
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
    setActiveComposerSection(composerSection);
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

  const selectWorkspace = useCallback((workspace: AppWorkspace) => {
    if (workspace === activeWorkspace) {
      return;
    }
    const label = {
      library: "open Skills",
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
      setActiveComposerSection(composerSection);
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
    const activeProfileId = targetStates.find(
      (state) => state.targetId === targetId
    )?.activeProfileId;
    const capturedProfileId = profiles.find(
      (profile) =>
        !profile.loadError && profile.createdFromTargetId === targetId
    )?.id;
    const profileId = activeProfileId ?? capturedProfileId;

    if (profileId) {
      selectProfile(profileId, undefined, targetId);
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
    if (profileMetadataSavingId === profileId) {
      return;
    }
    setError(undefined);
    setProfileMetadataSavingId(profileId);
    if (draftProfile?.id === profileId) {
      setProfileSaveStatus("Saving profile details");
    }
    try {
      const previousName =
        profiles.find((profile) => profile.id === profileId)?.name ??
        draftProfile?.manifest.name ??
        profileId;
      const saved = await window.agentEnv.updateProfileMetadata({
        id: profileId,
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
    onSaveProfile: saveSelectedProfile,
    onRefreshSkills: refreshSkills,
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
    setProfileCaptureError("");
    setProfileFormError("");
    setProfileDialogMode("create");
    openWorkspaceNow("profiles");
    setIsProfileActionsOpen(false);
  };

  const openCreateProfileDialog = () => {
    guardProfileAction("create a new profile", openCreateProfileDialogNow);
  };

  const openCreateFromTargetDialogNow = (
    targetId: string,
    scope: "all" | "skills" = "all"
  ) => {
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
    setProfileCaptureError("");
    setProfileFormError("");
    setProfileDialogMode("create");
  };

  const openCreateFromTargetDialog = (
    targetId: string,
    scope: "all" | "skills" = "all"
  ) => {
    const targetName = targets.find((item) => item.id === targetId)?.name ?? "Agent";
    guardProfileAction(
      scope === "skills"
        ? `manage ${targetName} Skills`
        : `create a profile from ${targetName}`,
      () => openCreateFromTargetDialogNow(targetId, scope)
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
    setProfileCaptureActivity("reviewing");
    setBusy(true);
    try {
      const captured = await window.agentEnv.previewCreateProfileFromTarget(
        profileForm.targetId,
        profileCaptureScope
      );
      setTargetCapturePreview(captured);
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
              name
            })).profile
          : await window.agentEnv.createProfile({
              preferredTargetId: profileForm.targetId,
              name,
              description
            });
        await refreshProfiles();
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
        setProfileSaveStatus("Saving profile details");
        const saved = await window.agentEnv.updateProfileMetadata({
          id: draftProfile.id,
          name,
          description
        });
        acceptProfileMetadata(saved, draftProfile.manifest.name);
      }
      setActiveComposerSection(undefined);
      openWorkspaceNow(
        profileCaptureOrigin === "targets" && profileCaptureScope === "skills"
          ? "targets"
          : "profiles"
      );
      setProfileDialogMode(undefined);
      setTargetCapturePreview(undefined);
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
      await refreshProfiles();
      setSelectedTargetId(saved.manifest.preferredTargetId ?? selectedTargetId);
      setProfileTargetSelections((current) => ({
        ...current,
        ...(saved.manifest.preferredTargetId
          ? { [saved.id]: saved.manifest.preferredTargetId }
          : {})
      }));
      acceptSelectedProfile(saved);
      setActiveComposerSection(undefined);
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
    guardProfileAction("duplicate this profile", () => duplicateProfileNow(profileId));
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
      guardProfileAction("delete this profile", open);
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
    setProfileCaptureActivity("idle");
    setProfileCaptureError("");
    setProfileFormError("");
  };

  const appModalOpen = Boolean(
    pendingSkillImport || pendingProfileAction || profileDialogMode || deleteProfileCandidateId || dataRestorePreview || backupManagerOpen
  );
  const dismissAppModal = () => {
    if (pendingSkillImport) {
      dismissSkillImport();
    } else if (backupManagerOpen) {
      closeBackupManager();
    } else if (dataRestorePreview) {
      setDataRestorePreview(undefined);
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
    targetMenuButtonRef.current?.focus();
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
    const targetName = targets.find((target) => target.id === targetId)?.name ?? "Agent";
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
        setSkillCleanupScope("all");
        return;
      }
      if (isProfileActionsOpen) {
        setIsProfileActionsOpen(false);
        profileActionsButtonRef.current?.focus();
        return;
      }
      if (isTargetMenuOpen) {
        setIsTargetMenuOpen(false);
        targetMenuButtonRef.current?.focus();
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
    if (!isTargetMenuOpen && !isProfileActionsOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        profilePageActionsRef.current?.contains(target) ||
        profileObjectActionsRef.current?.contains(target) ||
        profileApplyControlRef.current?.contains(target)
      ) {
        return;
      }
      setIsTargetMenuOpen(false);
      setIsProfileActionsOpen(false);
      if (isTargetMenuOpen) {
        targetMenuButtonRef.current?.focus();
      } else if (isProfileActionsOpen) {
        profileActionsButtonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isProfileActionsOpen, isTargetMenuOpen]);

  useEffect(() => {
    if (!isTargetMenuOpen) return;
    window.requestAnimationFrame(() => focusInitialActionMenuItem(
      targetMenuRef.current,
      '[role="menuitemradio"][aria-checked="true"]'
    ));
  }, [isTargetMenuOpen]);

  useEffect(() => {
    if (!isProfileActionsOpen) return;
    window.requestAnimationFrame(() => focusInitialActionMenuItem(profileActionsMenuRef.current));
  }, [isProfileActionsOpen]);

  const selectedTarget = targets.find((target) => target.id === selectedTargetId);
  const loadingProfileSummary = profileLoadingId
    ? profiles.find((profile) => profile.id === profileLoadingId)
    : undefined;
  const installedTargets = targets.filter((target) => isTargetInstalled(target.health));
  const profileTarget = supportedTargets.find(
    (target) => target.id === selectedTargetId
  );
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
            targets.find((target) => target.id === state.targetId)?.name ?? state.targetId
        )
    : [];
  const validationRows = draftProfile
    ? createValidationRows(draftProfile, selectedTarget, preview)
    : [];
  const localValidationErrors = validationRows
    .filter((row) => row.level === "error" && row.source !== "access" && row.source !== "conflicts")
    .map((row) => row.detail ?? `${row.label} is invalid`);
  const resourceSummary =
    draftProfile && profileTarget
      ? summarizeProfile(draftProfile, profileTarget, librarySkills)
      : undefined;
  const updateSelectedResourceManagement = (
    resource: ManagedProfileResource,
    mode: ProfileResourceMode
  ) => {
    if (!draftProfile || !selectedTargetId) return;
    updateDraftProfile({
      ...draftProfile,
      resources: setProfileResourceMode(
        draftProfile.resources ?? emptyProfileResources,
        selectedTargetId,
        resource,
        mode
      )
    });
  };
  const selectedTargetProfileHash =
    selectedTarget && draftProfile
      ? draftProfile.targetContentHashes?.[selectedTarget.id]
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
                  selectedTarget?.id
                )
              : undefined
          )
        : undefined,
    isDirty: isProfileDirty,
    localValidationErrors,
    preview
  };
  const readiness = deriveProfileReadiness(readinessInput);
  const applyActionLabel = deriveApplyActionLabel(readinessInput);
  const ReadinessIcon =
    readiness.status === "ready" || readiness.status === "unmanaged" || readiness.status === "applied"
      ? CheckCircle2
      : readiness.status === "dirty" || readiness.status === "apply-pending"
        ? RefreshCw
        : TriangleAlert;
  const selectedTargetIcon = selectedTarget ? targetIconFor(selectedTarget) : undefined;
  const readinessTargetName = selectedTarget?.name ?? t("Agent");
  const readinessActionText =
    isProfilePreviewing
      ? t("Reviewing changes")
      : isProfileApplying
        ? t("Applying profile")
        : readiness.status === "applied"
          ? t("Up to date on {{name}}", { name: readinessTargetName })
          : readiness.status === "apply-pending"
            ? t("Apply pending on {{name}}", { name: readinessTargetName })
            : readiness.status === "unmanaged"
              ? t("Ready to take over {{name}}", { name: readinessTargetName })
              : readiness.status === "ready"
                ? t("Ready for {{name}}", { name: readinessTargetName })
                : readiness.status === "dirty"
                  ? t("Save changes to continue")
                  : readiness.status === "target-unavailable"
                    ? t("{{name}} unavailable", { name: readinessTargetName })
                    : readiness.status === "validation-error"
                      ? t("Profile configuration needs review")
                      : readiness.status === "review-required"
                        ? t("Review protected changes on {{name}}", {
                            name: readinessTargetName
                          })
                      : readiness.status === "preview-error"
                        ? readiness.remediationLabel === "Open Recovery"
                          ? t("Recovery required on {{name}}", { name: readinessTargetName })
                          : t("Changes need review on {{name}}", { name: readinessTargetName })
                        : readiness.status === "no-target"
                          ? t("Select an Agent")
                          : t(readiness.message);
  const applyDisabled =
    !draftProfile ||
    !selectedTarget ||
    busy ||
    profileMetadataSavingId === draftProfile.id ||
    isProfileDirty ||
    readiness.status === "applied";
  const isNewProfilePrimary =
    !draftProfile || readiness.status === "applied";
  const applyDescription = !draftProfile
    ? t("Select a profile before previewing changes")
    : !selectedTarget
      ? t("Select an Agent before previewing changes")
      : busy
        ? t("An action is in progress")
        : profileMetadataSavingId === draftProfile.id
          ? t("Saving profile details")
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

  const previewSelectedProfile = () =>
    runProfilePreview({
      profile: draftProfile,
      target: selectedTarget,
      dirty: isProfileDirty,
      localValidationErrors,
      onSaveRequired: () => {
        setSkillUpdateCheckStatus(undefined);
        saveButtonRef.current?.focus();
      }
    });

  const runReadinessRemediation = () => {
    if (readiness.remediationLabel === "Open Agents") {
      openWorkspaceNow("targets");
      return;
    }
    if (readiness.remediationLabel === "Save now") {
      void saveSelectedProfile();
      return;
    }
    if (readiness.remediationLabel === "Open Recovery") {
      setSettingsCategory("data");
      openWorkspaceNow("settings");
      setBackupManagerOpen(true);
    }
  };

  const toggleComposerSection = (section: ComposerSection) => {
    setActiveComposerSection((current) => current === section ? undefined : section);
  };

  const applySelectedProfile = () => applyProfileActivation(draftProfile);

  const leavePreviewSkillUnmanaged = async (
    issue: ApplyIssue,
    targetId: string,
    refreshPreview: () => Promise<void>
  ) => {
    if (!issue.path || !issue.resourceId) return;
    setError(undefined);
    try {
      await window.agentEnv.setUnmanagedSkillLocations({
        items: [{
          path: issue.path,
          targetId,
          coverage: "exact"
        }],
        unmanaged: true
      });
      setSkillInventory(await window.agentEnv.scanSkillInventory());
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

  const executeSkillUpdatePlans = (
    plans: SkillUpdatePlan[],
    preserveExistingProgress: boolean
  ) => {
    setSkillUpdateRun((current) => {
      const next = preserveExistingProgress ? { ...current } : {};
      for (const plan of plans) next[plan.id] = { status: "queued" };
      return next;
    });
    const updateProgress = (id: string, item: SkillUpdateRunItem) => {
      setSkillUpdateRun((current) => ({ ...current, [id]: item }));
    };
    return runSkillUpdateQueue(
      plans,
      (plan) =>
        window.agentEnv.updateLibrarySkill({
          id: plan.id,
          previewId: plan.previewId!
        }),
      updateProgress
    );
  };

  const updateLibrarySkill = async (plan: SkillUpdatePlan) => {
    if (!plan.previewId) {
      setError("Skill update preview is unavailable; review the update again");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await executeSkillUpdatePlans([plan], false);
      applyLibraryContentUpdatesLocally(result.updated);
      await refreshSkillSourceGroups();
      if (result.updated.length > 0) {
        setSkillUpdateCheckStatus(
          summarizeSkillUpdateResult(
            plan.id,
            skillUpdates.filter((item) => item.id !== plan.id),
            t
          )
        );
      }
      if (result.failed.length > 0) {
        setSkillUpdateCheckStatus({ state: "error", message: `Update ${plan.id} failed` });
        setError(result.failed[0]!.error);
      }
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

  const updateAllLibrarySkills = async (plans: SkillUpdatePlan[]) => {
    const applicablePlans = plans.filter((plan) => Boolean(plan.previewId));
    if (applicablePlans.length === 0) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const result = await executeSkillUpdatePlans(applicablePlans, true);
      const updatedSkills = result.updated;
      applyLibraryContentUpdatesLocally(updatedSkills);
      await refreshSkillSourceGroups();
      const updatedIds = new Set(updatedSkills.map((skill) => skill.id));
      const remainingUpdates = skillUpdates.filter(
        (update) =>
          !updatedIds.has(update.id) && update.updateAvailable && !update.error
      ).length;
      if (result.failed.length === 0) {
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
    setSkillUpdateRun({});
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

  const syncSkillInstalls = async (id: string) => {
    const staleCopies = skillInventory.filter(
      (item) =>
        item.libraryId === id &&
        item.installMethod === "copied" &&
        item.contentMatchesLibrary === false
    );
    if (staleCopies.length === 0) {
      return;
    }
    await consolidateSkillGroup({
      skillKey: staleCopies[0].skillKey,
      libraryId: id,
      canonicalPath: staleCopies[0].path,
      locations: staleCopies.map((item) => ({
        targetId: item.foundIn[0] ?? "",
        path: item.path,
        contentHash: item.contentHash
      }))
    });
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
    setSkillUpdateCheckStatus({ state: "checking", message: "Checking profile skills..." });
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
      setSkillUpdateCheckStatus({ state: "error", message: "Profile skill check failed" });
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
        if (announce) {
          setBusy(true);
          setSkillUpdateCheckStatus({
            state: "checking",
            message: "Refreshing local skills..."
          });
        }
        setSkillInventoryRefreshing(true);
        setEnvironmentScanStatus("checking");
        try {
          const inventory = await window.agentEnv.scanSkillInventory();
          setSkillInventory(inventory);
          setEnvironmentScanStatus("ready");
          return inventory;
        } finally {
          setSkillInventoryRefreshing(false);
          if (announce) setBusy(false);
        }
      });
      if (announce) {
        setSkillUpdateCheckStatus({
          state: "success",
          message: "Local skills refreshed"
        });
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setEnvironmentScanStatus("error");
      if (announce) {
        setError(message);
        setSkillUpdateCheckStatus({ state: "error", message: "Local skill refresh failed" });
      }
    }
  };

  const openSkillDiscoveries = async () => {
    setSkillCleanupScope("all");
    setSkillLibraryTool("discoveries");
    await refreshSkillDiscoveries(false, "manual");
  };

  const openEnvironmentReview = () => {
    guardProfileAction("review shared Skills", () => {
      libraryScroll.captureScroll();
      setSkillUpdateFeedbackWorkspace("library");
      setSkillLibraryMode("skills");
      setSkillCleanupScope("shared");
      setSkillLibraryTool("discoveries");
      openWorkspaceNow("library");
      void refreshSkillDiscoveries(false, "page-entry");
    });
  };

  const reviewPreviewSkillCollection = (issue: ApplyIssue) => {
    const collectionPath = issue.path ?? issue.resourceId;
    if (!collectionPath) return;
    clearProfilePreview();
    libraryScroll.captureScroll();
    setSkillUpdateFeedbackWorkspace("library");
    setSkillLibraryMode("skills");
    setSkillCleanupScope("shared");
    setSkillCollectionFocusPath(collectionPath);
    setSkillLibraryTool("discoveries");
    openWorkspaceNow("library");
    void refreshSkillDiscoveries(false, "page-entry");
  };

  const setUnmanagedSkillLocations = async (input: UnmanagedSkillLocationUpdate) => {
    setError(undefined);
    try {
      await window.agentEnv.setUnmanagedSkillLocations(input);
      setSkillInventory(await window.agentEnv.scanSkillInventory());
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    }
  };

  const setSkillCollectionDecision = async (
    input: SkillCollectionMemberDecisionUpdate
  ) => {
    setError(undefined);
    try {
      await window.agentEnv.setSkillCollectionDecision(input);
      setSkillInventory(await window.agentEnv.scanSkillInventory());
      return true;
    } catch (unknownError) {
      setError(
        unknownError instanceof Error ? unknownError.message : String(unknownError)
      );
      return false;
    }
  };

  const leaveSkillGroupUnmanaged = async (skillKey: string) => {
    setBusy(true);
    setError(undefined);
    setProfileSaveStatus("");
    setSkillUpdateCheckStatus({
      state: "checking",
      message: `Leaving ${skillKey} unmanaged...`
    });
    try {
      await window.agentEnv.setUnmanagedSkillLocations({
        items: skillInventory
          .filter(
            (item) =>
              item.skillKey === skillKey &&
              item.status !== "managed" &&
              item.status !== "left-unmanaged"
          )
          .flatMap((item) =>
            item.foundIn.length > 0
              ? item.foundIn.map((targetId) => ({
                  path: item.path,
                  targetId: item.sharedLocation ? undefined : targetId,
                  coverage: "exact" as const
                }))
              : [{ path: item.path, coverage: "exact" as const }]
          ),
        unmanaged: true
      });
      setSkillInventory(await window.agentEnv.scanSkillInventory());
      setSkillUpdateCheckStatus({
        state: "success",
        message: `${skillKey} is left unmanaged on this device`
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setSkillUpdateCheckStatus({
        state: "error",
        message: "Could not save local management boundary"
      });
    } finally {
      setBusy(false);
    }
  };

  const manageSkillGroupWithAgentEnv = async (skillKey: string) => {
    setBusy(true);
    setError(undefined);
    setProfileSaveStatus("");
    setSkillUpdateCheckStatus({
      state: "checking",
      message: `Reviewing ${skillKey} again...`
    });
    try {
      await window.agentEnv.setUnmanagedSkillLocations({
        items: skillInventory
          .filter(
            (item) =>
              item.skillKey === skillKey &&
              item.status === "left-unmanaged"
          )
          .flatMap((item) =>
            item.foundIn.length > 0
              ? item.foundIn.map((targetId) => ({
                  path: item.path,
                  targetId: item.sharedLocation ? undefined : targetId,
                  coverage: "exact" as const
                }))
              : [{ path: item.path, coverage: "exact" as const }]
          ),
        unmanaged: false
      });
      setSkillInventory(await window.agentEnv.scanSkillInventory());
      setSkillUpdateCheckStatus({
        state: "success",
        message: `${skillKey} is back in review`
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setSkillUpdateCheckStatus({
        state: "error",
        message: "Could not clear local management boundary"
      });
    } finally {
      setBusy(false);
    }
  };

  const setSharedSkillRetention = async (input: SharedSkillRetentionInput) => {
    setError(undefined);
    try {
      await window.agentEnv.setSharedSkillRetention(input);
      setSkillInventory(await window.agentEnv.scanSkillInventory());
      setSkillUpdateCheckStatus({
        state: "success",
        message: input.retained
          ? `${input.skillKey} will remain in the shared compatibility directory`
          : `${input.skillKey} is back in migration review`
      });
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    }
  };

  const retireSharedSkill = async (input: RetireSharedSkillInput) => {
    setError(undefined);
    try {
      const result = await window.agentEnv.retireSharedSkill(input);
      setSkillCleanupResult(result);
      await refreshProfiles({ checkSkillUpdates: false });
      setSkillUpdateCheckStatus({
        state: "success",
        message: `Completed shared migration for ${input.skillKey}`
      });
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    }
  };

  const moveSharedSkillToAgentDirectories = async (
    input: RetireSharedSkillInput,
    targetIds: string[]
  ) => {
    const activeProfileIds = new Set(
      targetStates
        .filter((state) => targetIds.includes(state.targetId))
        .map((state) => state.activeProfileId)
        .filter((id): id is string => Boolean(id))
    );
    if (isProfileDirty && draftProfile && activeProfileIds.has(draftProfile.id)) {
      setError("Save or discard the open Profile changes before moving this shared Skill.");
      return false;
    }

    setError(undefined);
    setBusy(true);
    try {
      const result = await moveSharedSkillToAgents({
        api: window.agentEnv,
        migration: input,
        targetIds,
        targetNames
      });
      setSkillCleanupResult(result);
      await refreshProfiles({ checkSkillUpdates: false });
      setSkillUpdateCheckStatus({
        state: "success",
        message: `Moved ${input.skillKey} to ${targetIds.length} ${
          targetIds.length === 1 ? "Agent" : "Agents"
        }`
      });
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      await refreshProfiles({ checkSkillUpdates: false }).catch(() => undefined);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const moveSkillCollectionToAgentDirectories = (collection: SkillCollectionLinkGroup) => runSkillCollectionMigration({
    api: window.agentEnv, collection, targetStates,
    dirtyProfileId: isProfileDirty ? draftProfile?.id : undefined,
    targetNames, setBusy, setError,
    setResult: setSkillCleanupResult,
    setSuccess: (message) => setSkillUpdateCheckStatus({ state: "success", message }),
    refresh: () => refreshProfiles({ checkSkillUpdates: false }).then(() => undefined)
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

  const autoConsolidateSkillGroups = async (inputs: SkillCleanupRequest[]) => {
    if (inputs.length === 0) {
      return [];
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
    const failures: string[] = [];
    for (const input of inputs) {
      try {
        completed.push(await window.agentEnv.consolidateSkillGroup(input));
        completedSkillKeys.push(input.skillKey);
      } catch (unknownError) {
        failures.push(
          `${input.skillKey}: ${unknownError instanceof Error ? unknownError.message : String(unknownError)}`
        );
      }
    }
    try {
      await refreshProfiles({ checkSkillUpdates: false });
      if (failures.length === 0) {
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
          message: `${plural(completed.length, "skill")} managed · ${plural(failures.length, "skill")} need review`
        });
        setError(failures.join("\n"));
      }
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSkillUpdateCheckStatus({ state: "error", message: "Skill cleanup refresh failed" });
    } finally {
      setBusy(false);
    }
    return completedSkillKeys;
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

  const previewLibrarySkillUpdate = async (id: string) => {
    const activity: SkillUpdateActivity = { kind: "preview-skill", skillId: id };
    if (!beginSkillUpdateActivity(activity)) return;
    setError(undefined);
    setProfileSaveStatus("");
    setSelectedSkillUpdatePlan(undefined);
    setSkillUpdateRun({});
    setSkillUpdateFeedbackWorkspace("library");
    setSkillUpdateCheckStatus({ state: "checking", message: `Checking ${id}...` });
    try {
      const updatePlan = await window.agentEnv.previewLibrarySkillUpdate(id);
      if (updatePlan.errors.length > 0) {
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

  const updateSkillSettings = async (input: Partial<AgentEnvSettings>) => {
    setBusy(true);
    setError(undefined);
    setSettingsSaveStatus("Saving settings");
    try {
      const nextSettings = await window.agentEnv.updateSettings(input);
      setSkillSettings(nextSettings);
      onLocalePreferenceChange(nextSettings.locale);
      if ("backupRetentionDays" in input) await refreshManagedBackups("mutation");
      if ("enabledTargetIds" in input || "targetConfigRoots" in input) {
        clearProfilePreview();
        setRollbackPreview(undefined);
        await refreshProfiles({
          checkSkillUpdates: false,
          forceTargetRefresh: true,
          settingsOverride: nextSettings
        });
      }
      setSettingsSaveStatus("Settings saved");
      return nextSettings;
    } catch (unknownError) {
      setSettingsSaveStatus("");
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const setAgentEnabled = async (targetId: string, enabled: boolean) => {
    const currentIds =
      skillSettings.enabledTargetIds ?? supportedTargets.map((target) => target.id);
    const nextIds = enabled
      ? [...new Set([...currentIds, targetId])]
      : currentIds.filter((id) => id !== targetId);
    await updateSkillSettings({ enabledTargetIds: nextIds });
  };

  const chooseTargetConfigRoot = async (targetId: string) => {
    const selected = await window.agentEnv.selectTargetConfigRoot(targetId);
    if (!selected) return;
    await updateSkillSettings({
      targetConfigRoots: { ...(skillSettings.targetConfigRoots ?? {}), [targetId]: selected }
    });
  };

  const resetTargetConfigRoot = async (targetId: string) => {
    const nextRoots = { ...(skillSettings.targetConfigRoots ?? {}) };
    delete nextRoots[targetId];
    await updateSkillSettings({ targetConfigRoots: nextRoots });
  };

  const openBackupManager = () => {
    backupManagerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBackupDeleteCandidate(undefined);
    setBackupPreviewCandidate(undefined);
    setManagedBackupPreview(undefined);
    setManagedBackupPreviewLoading(false);
    setBackupCleanupConfirm(false);
    setBackupManagerNotice(undefined);
    setBackupManagerOpen(true);
    void refreshManagedBackups("manual");
  };

  const closeBackupManager = () => {
    if (backupPreviewCandidate) {
      setBackupPreviewCandidate(undefined);
      setManagedBackupPreview(undefined);
      setManagedBackupPreviewLoading(false);
      return;
    }
    if (backupDeleteCandidate) {
      setBackupDeleteCandidate(undefined);
      return;
    }
    if (backupCleanupConfirm) {
      setBackupCleanupConfirm(false);
      return;
    }
    setBackupManagerOpen(false);
    setBackupManagerNotice(undefined);
  };

  const previewManagedBackup = async (item: ManagedBackupItem) => {
    setBackupPreviewCandidate(item);
    setManagedBackupPreview(undefined);
    setManagedBackupPreviewLoading(true);
    setBackupManagerNotice(undefined);
    try {
      const previewResult = await window.agentEnv.previewManagedBackup({
        id: item.id,
        kind: item.kind
      });
      setManagedBackupPreview(previewResult);
    } catch (unknownError) {
      setBackupPreviewCandidate(undefined);
      setBackupManagerNotice({
        kind: "error",
        message: unknownError instanceof Error ? unknownError.message : String(unknownError)
      });
    } finally {
      setManagedBackupPreviewLoading(false);
    }
  };

  const deleteSelectedManagedBackup = async () => {
    if (!backupDeleteCandidate) return;
    setBusy(true);
    setBackupManagerNotice(undefined);
    try {
      const result = await window.agentEnv.deleteManagedBackup({
        id: backupDeleteCandidate.id,
        kind: backupDeleteCandidate.kind
      });
      setBackupDeleteCandidate(undefined);
      setBackupManagerNotice({
        kind: "success",
        message: t("Deleted {{count}} backup · Freed {{size}}", {
          count: result.deletedCount,
          size: formatBytes(result.freedBytes)
        })
      });
      await refreshManagedBackups("mutation");
    } catch (unknownError) {
      setBackupManagerNotice({
        kind: "error",
        message: unknownError instanceof Error ? unknownError.message : String(unknownError)
      });
    } finally {
      setBusy(false);
    }
  };

  const cleanupManagedBackups = async () => {
    setBusy(true);
    setBackupManagerNotice(undefined);
    try {
      const result = await window.agentEnv.cleanupManagedBackups();
      setBackupCleanupConfirm(false);
      setBackupManagerNotice({
        kind: result.failures.length > 0 ? "error" : "success",
        message: result.failures.length > 0
          ? t(result.deletedCount === 1 ? "Deleted 1 backup; {{failed}} failed" : "Deleted {{count}} backups; {{failed}} failed", {
              count: result.deletedCount,
              failed: result.failures.length
            })
          : t(result.deletedCount === 1 ? "Deleted 1 backup · Freed {{size}}" : "Deleted {{count}} backups · Freed {{size}}", {
              count: result.deletedCount,
              size: formatBytes(result.freedBytes)
            })
      });
      await refreshManagedBackups("mutation");
    } catch (unknownError) {
      setBackupManagerNotice({
        kind: "error",
        message: unknownError instanceof Error ? unknownError.message : String(unknownError)
      });
    } finally {
      setBusy(false);
    }
  };

  const createAgentEnvDataBackup = async () => {
    setBusy(true);
    setError(undefined);
    setDataBackupStatus("Creating data export");
    try {
      const result = await window.agentEnv.createDataBackup();
      setDataBackupStatus(result ? t("Data export created at {{path}}", { path: result.path }) : "");
    } catch (unknownError) {
      setDataBackupStatus("");
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const selectAgentEnvDataRestore = async () => {
    dataRestoreReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setError(undefined);
    try {
      setDataRestorePreview(await window.agentEnv.selectDataRestore());
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const restoreAgentEnvData = async () => {
    if (!dataRestorePreview) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await window.agentEnv.restoreDataBackup(dataRestorePreview.path);
      setDataRestorePreview(undefined);
      clearSelectedProfile();
      const refreshed = await refreshProfiles();
      const firstProfile = refreshed.profileItems.find((profile) => !profile.loadError);
      if (firstProfile) {
        setSelectedTargetId(firstProfile.preferredTargetId ?? targets[0]?.id);
        acceptSelectedProfile(await window.agentEnv.readProfile(firstProfile.id));
      }
      setDataBackupStatus(`AgentEnv data restored; safety backup created at ${result.safetyBackupPath}`);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const refreshTargets = useAgentRefresh({
    loadRecoveryHistory: loadTargetRecoveryHistory,
    profiles,
    runFreshness,
    setBusy,
    setError,
    setMcpConnections: setNativeMcpConnections,
    setMcpIssues: setNativeMcpIssues,
    setSelectedTargetId,
    setSupportedTargets,
    setTargetRefreshStatus,
    setTargetStates,
    setTargets
  });

  useWorkspaceFreshness({
    activeWorkspace,
    isLoading,
    refreshSkills,
    refreshSkillDiscoveries,
    refreshTargets
  });

  const startGitHubLogin = async () => {
    setGithubLoginChecking(true);
    setError(undefined);
    setSettingsSaveStatus("");
    setDataBackupStatus("");
    setGithubLoginMessage("Opening GitHub authorization...");
    setGithubCodeCopied(false);
    try {
      const login = await window.agentEnv.startGitHubDeviceLogin();
      setGithubDeviceLogin(login);
      setGithubAuthStatus(await window.agentEnv.readGitHubAuthStatus());
      setGithubLoginMessage("Waiting for authorization. This page updates automatically.");
      await window.agentEnv.openGitHubDevicePage(login.verificationUri);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setGithubLoginMessage("");
    } finally {
      setGithubLoginChecking(false);
    }
  };

  const pollGitHubLogin = async (
    login = githubDeviceLogin,
    showProgress = true
  ): Promise<GitHubDeviceLoginResult | undefined> => {
    if (!login || githubLoginPollingRef.current) {
      return undefined;
    }
    githubLoginPollingRef.current = true;
    setGithubLoginChecking(true);
    setError(undefined);
    setSettingsSaveStatus("");
    if (showProgress) {
      setGithubLoginMessage("Checking GitHub authorization...");
    }
    try {
      const result = await window.agentEnv.pollGitHubDeviceLogin(login.id);
      if (result.state === "signed-in") {
        const status = result.status ?? (await window.agentEnv.readGitHubAuthStatus());
        setGithubAuthStatus(status);
        setGithubDeviceLogin(undefined);
        setGithubCodeCopied(false);
        setGithubLoginMessage(
          status.user?.login ? `Signed in as ${status.user.login}` : "Signed in with GitHub"
        );
        await refreshProfiles();
        return result;
      }
      if (result.state === "expired" || result.state === "denied") {
        setGithubDeviceLogin(undefined);
      }
      setGithubLoginMessage(
        result.state === "pending"
          ? "Waiting for authorization. This page updates automatically."
          : result.message ?? "GitHub authorization is still pending"
      );
      return result;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return undefined;
    } finally {
      githubLoginPollingRef.current = false;
      setGithubLoginChecking(false);
    }
  };

  const copyGitHubDeviceCode = async () => {
    if (!githubDeviceLogin) {
      return;
    }
    try {
      await window.agentEnv.copyText(githubDeviceLogin.userCode);
      setGithubCodeCopied(true);
      if (githubCopyResetRef.current) {
        window.clearTimeout(githubCopyResetRef.current);
      }
      githubCopyResetRef.current = window.setTimeout(() => setGithubCodeCopied(false), 1800);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  useEffect(() => {
    const login = githubDeviceLogin;
    if (!login) {
      return undefined;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    let delayMs = Math.max(login.intervalSeconds * 1000, 1000);
    const schedule = () => {
      timeoutId = window.setTimeout(async () => {
        const result = await pollGitHubLogin(login, false);
        if (
          cancelled ||
          result?.state === "signed-in" ||
          result?.state === "expired" ||
          result?.state === "denied"
        ) {
          return;
        }
        delayMs = Math.max((result?.retryAfterSeconds ?? login.intervalSeconds) * 1000, 1000);
        schedule();
      }, delayMs);
    };
    const handleFocus = () => {
      void pollGitHubLogin(login, false);
    };

    schedule();
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("focus", handleFocus);
    };
  }, [githubDeviceLogin?.id]);

  useEffect(
    () => () => {
      if (githubCopyResetRef.current) {
        window.clearTimeout(githubCopyResetRef.current);
      }
    },
    []
  );

  const signOutGitHub = async () => {
    setGithubLoginChecking(true);
    setError(undefined);
    setSettingsSaveStatus("");
    try {
      const status = await window.agentEnv.signOutGitHub();
      setGithubAuthStatus(status);
      setGithubDeviceLogin(undefined);
      setGithubLoginMessage("Signed out of GitHub");
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setGithubLoginChecking(false);
    }
  };

  const dismissAppFeedback = () => {
    setError(undefined);
    setSkillUpdateCheckStatus(undefined);
    setProfileSaveStatus("");
    clearProfileApplyRefreshDetail();
    setSettingsSaveStatus("");
    setTargetRefreshStatus(undefined);
    setSkillRefreshStatus(undefined);
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
        setSettingsSaveStatus("No diagnostic issues recorded");
        return;
      }
      await window.agentEnv.copyText(formatDiagnosticIssue(issue));
      setSettingsSaveStatus("Latest diagnostic issue copied");
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };
  const exportDiagnosticReport = async () => {
    setError(undefined);
    setSettingsSaveStatus("");
    try {
      const path = await window.agentEnv.exportDiagnostics();
      if (path) {
        setSettingsSaveStatus(t("Diagnostic report exported to {{path}}", { path }));
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
                ? t("Updated {{profiles}} profiles and {{installs}} managed installs. A restorable backup is available in History.", {
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
    : skillRefreshStatus && activeWorkspace === "library"
      ? {
          kind: skillRefreshStatus === "refreshing" ? "loading" : "success",
          title: skillRefreshStatus === "refreshing" ? "Refreshing skills" : "Skills refreshed"
        }
    : targetRefreshStatus && activeWorkspace === "targets"
      ? {
          kind: targetRefreshStatus === "refreshing" ? "loading" : "success",
          title: targetRefreshStatus === "refreshing" ? "Refreshing Agents" : "Agents refreshed"
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
      : profileSaveStatus && activeWorkspace === "profiles"
        ? {
            kind:
              profileSaveStatus === "Profile saved" ||
              profileSaveStatus === "Profile details saved"
                ? "success"
                : profileSaveStatus === "Saving profile" ||
                    profileSaveStatus === "Saving profile details"
                  ? "loading"
                  : "info",
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
  const profileApplyControl = targets.length > 0 ? (
    <div className="profile-apply-control" ref={profileApplyControlRef}>
      <button
        className="profile-apply-button"
        type="button"
        aria-describedby="profile-apply-description"
        title={t(applyActionLabel)}
        disabled={applyDisabled}
        aria-busy={isProfilePreviewing}
        onClick={previewSelectedProfile}
      >
        {isProfilePreviewing ? (
          <LoaderCircle
            className="is-spinning"
            size={17}
            strokeWidth={2.2}
            aria-hidden="true"
          />
        ) : (
          <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
        )}
        <strong>
          {t("Apply")}
        </strong>
      </button>
      <span id="profile-apply-description" hidden>{applyDescription}</span>
    </div>
  ) : null;
  const targetWorkspaceControl = targets.length === 0 ? null : installedTargets.length === 1 && selectedTarget ? (
    <div
      className="profile-target-workspace-button is-static"
      aria-label={t("Current Agent {{name}}", { name: selectedTarget.name })}
    >
      {selectedTargetIcon?.assetUrl ? (
        <img
          className={`profile-target-logo profile-target-logo--${selectedTargetIcon.flavor}`}
          src={selectedTargetIcon.assetUrl}
          alt=""
        />
      ) : (
        <Monitor size={16} aria-hidden="true" />
      )}
      <span>{selectedTarget.name}</span>
    </div>
  ) : (
    <div className="profile-target-workspace-control">
      <button
        ref={targetMenuButtonRef}
        className="profile-target-workspace-button"
        type="button"
        aria-expanded={isTargetMenuOpen}
        aria-haspopup="menu"
        aria-label={t("Select apply Agent")}
        title={t("Select apply Agent")}
        onClick={() => {
          setIsProfileActionsOpen(false);
          setIsTargetMenuOpen((current) => !current);
        }}
      >
        {selectedTargetIcon?.assetUrl ? <img className={`profile-target-logo profile-target-logo--${selectedTargetIcon.flavor}`} src={selectedTargetIcon.assetUrl} alt="" /> : <Monitor size={16} aria-hidden="true" />}
        <span>{selectedTarget?.name ?? t("Select")}</span>
        <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {isTargetMenuOpen ? (
        <ActionMenu
          ariaLabel={t("Apply Agents")}
          className="profile-target-menu"
          menuRef={targetMenuRef}
        >
          {targets.map((target) => {
            const targetIcon = targetIconFor(target);
            return (
              <button
                className={target.id === selectedTargetId ? "is-selected" : ""}
                type="button"
                role="menuitemradio"
                aria-checked={target.id === selectedTargetId}
                key={target.id}
                onClick={() => selectTarget(target.id)}
              >
                {targetIcon.assetUrl ? (
                  <img
                    className={`profile-target-logo profile-target-logo--${targetIcon.flavor}`}
                    src={targetIcon.assetUrl}
                    alt=""
                  />
                ) : (
                  <Monitor size={16} strokeWidth={2.2} aria-hidden="true" />
                )}
                <span>{target.name}</span>
                {target.id === selectedTargetId ? (
                  <CheckCircle2 size={15} strokeWidth={2.2} aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </ActionMenu>
      ) : null}
    </div>
  );

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
    onRefreshSkills: refreshSkills,
    onRefreshTargets: refreshTargets
  });

  return (
    <main
      className={appShellClassName(activeWorkspace, sidebarCollapsed)}
    >
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
        onToggleCollapsed={toggleSidebar}
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
            : activeWorkspace === "profiles"
              ? t("Profile editor")
              : activeWorkspace === "conversations"
                ? t("Conversation workspace")
              : t("{{name}} workspace", { name: activeWorkspace })
        }
      >
        <div className="window-drag-strip" aria-hidden="true" />
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
                  refreshing={
                    skillRefreshStatus === "refreshing" ||
                    freshnessStates["skill-library"].status === "refreshing"
                  }
                  freshness={(
                    <FreshnessStatus
                      state={
                        skillLibraryMode === "sources"
                          ? freshnessStates["skill-upstreams"]
                          : freshnessStates["skill-library"]
                      }
                      verb={skillLibraryMode === "sources" ? "Checked" : "Refreshed"}
                    />
                  )}
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
                isLoading={isLoading}
                isBusy={busy}
                librarySkills={librarySkills}
                sourceGroups={skillSourceGroups}
                sourceGroupsLoading={false}
                libraryMode={skillLibraryMode}
                skillUpdates={skillUpdates}
                skillInventory={skillInventory}
                cleanupBackups={skillCleanupBackups}
                selectedUpdatePlan={selectedSkillUpdatePlan}
                bulkUpdatePlans={bulkSkillUpdatePlans}
                bulkUpdateFailures={bulkSkillUpdateFailures}
                updateRun={skillUpdateRun}
                skillUsage={skillUsage}
                installedTargetIds={targets
                  .filter((target) => isTargetInstalled(target.health))
                  .map((target) => target.id)}
                targetNames={targetNames}
                preparedTargetsBySkill={preparedSkillTargetsBySkill}
                activeTool={skillLibraryTool}
                cleanupScope={skillCleanupScope}
                focusCollectionPath={skillCollectionFocusPath}
                isRefreshingInventory={skillInventoryRefreshing}
                onCloseTool={() => {
                  setSkillLibraryTool(undefined);
                  setSkillCleanupScope("all");
                  setSkillCollectionFocusPath(undefined);
                }}
                onFocusCollectionHandled={() => setSkillCollectionFocusPath(undefined)}
                onRefreshInventory={refreshSkillDiscoveries}
                onSelectLocalSkillSource={() => window.agentEnv.selectLocalSkillSource()}
                onReleaseSkillArchive={(token) => window.agentEnv.releaseSkillArchive(token)}
                onScanLocalSkillSource={(rootPath) => window.agentEnv.scanLocalSkillSource(rootPath)}
                onImportUnmanaged={(sourcePath, sourceHandling, deferFullRefresh) =>
                  importUnmanagedSkill(sourcePath, sourceHandling,
                    deferFullRefresh ? "batch" : "global").then((outcome) => outcome.ok)}
                onResolveCollectionConflict={async (item, strategy, deferFullRefresh) => {
                  const preferredResolution =
                    strategy === "use-collection" && item.libraryId
                      ? {
                          action: "replace" as const,
                          existingId: item.libraryId
                        }
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
                    return setSkillCollectionDecision({
                      path: item.path,
                      useLibrary: false
                    });
                  }
                  return true;
                }}
                onImportLocalSourceSkill={(sourcePath, sourceCollection, upstream) =>
                  importUnmanagedSkill(
                    sourcePath,
                    "copy-only",
                    "caller",
                    sourceCollection,
                    upstream
                  ).then((outcome) => outcome.ok)}
                onListSkillFiles={(id) => window.agentEnv.listSkillFiles(id)}
                onReadSkillFile={(id, path) => window.agentEnv.readSkillFile({ id, path })}
                onImportExternal={importExternalSkill}
                onScanGitHubSkills={scanGitHubSkills}
                onImportGitHubSkills={importGitHubSkills}
                onScanRepositorySkills={scanRepositorySkills}
                onImportRepositorySkills={importRepositorySkills}
                onLibraryModeChange={setSkillLibraryMode}
                onCheckSourceGroup={checkSkillSourceGroup}
                onCheckMonitoredSourceGroups={checkMonitoredSkillSourceGroups}
                onSetSourceName={setSkillSourceName}
                onSetSourceMonitored={setSkillSourceMonitored}
                onSetSourceCandidateIgnored={setSkillSourceCandidateIgnored}
                onPreviewSourceMerge={previewSkillSourceMerge}
                onMergeSources={mergeSkillSources}
                onCancelRepositoryOperations={() => window.agentEnv.cancelRepositoryOperations()}
                onManageTargetSkill={manageTargetSkill}
                onConsolidateSkillGroup={consolidateSkillGroup}
                onAutoConsolidateSkillGroups={autoConsolidateSkillGroups}
                onSaveUpdateSettings={saveSkillUpdateSettings}
                onSetAvailability={setSkillAvailability}
                onSetIcon={(input) => void setSkillIcon(input)}
                onPreviewLibrarySkillUpdate={previewLibrarySkillUpdate}
                onCloseUpdatePreview={() => {
                  setSelectedSkillUpdatePlan(undefined);
                  setSkillUpdateRun({});
                }}
                onUpdateLibrarySkill={updateLibrarySkill}
                onUpdateAllLibrarySkills={updateAllLibrarySkills}
                onPreviewAllLibrarySkillUpdates={previewAllLibrarySkillUpdates}
                onCloseBulkUpdatePreview={() => {
                  setBulkSkillUpdatePlans(undefined);
                  setBulkSkillUpdateFailures([]);
                  setSkillUpdateRun({});
                }}
                onSyncSkillInstalls={(id) => void syncSkillInstalls(id)}
                onRemoveLibrarySkill={removeLibrarySkill}
                onPreviewSkillMerge={previewSkillMerge}
                onMergeLibrarySkills={mergeLibrarySkills}
                onReviewSkillUsage={reviewSkillUsage}
                onCheckUpdates={checkSkillUpdates}
                onOpenSource={(url) => {
                  void window.agentEnv.openExternalUrl(url).catch((unknownError) => {
                    setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
                  });
                }}
                onCopySource={(source) => {
                  void window.agentEnv.copyText(source).then(() => {
                    setSkillUpdateCheckStatus({ state: "success", message: t("Repository address copied") });
                  }).catch((unknownError) => {
                    setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
                  });
                }}
                onCopyCleanupDetails={async (details) => {
                  try {
                    await window.agentEnv.copyText(details);
                    return true;
                  } catch (unknownError) {
                    setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
                    return false;
                  }
                }}
                onLeaveSkillGroupUnmanaged={(skillKey) => {
                  void leaveSkillGroupUnmanaged(skillKey);
                }}
                onManageSkillGroupWithAgentEnv={(skillKey) => {
                  void manageSkillGroupWithAgentEnv(skillKey);
                }}
                onSetUnmanagedSkillLocations={setUnmanagedSkillLocations}
                onSetSkillCollectionDecision={setSkillCollectionDecision}
                onSetSharedSkillRetention={setSharedSkillRetention}
                onRetireSharedSkill={retireSharedSkill}
                onMoveSharedSkillToAgents={moveSharedSkillToAgentDirectories}
                onMoveSkillCollection={moveSkillCollectionToAgentDirectories}
                importConflictOpen={Boolean(pendingSkillImport)}
                onRestoreCleanup={(backupId) => void undoSkillCleanup(backupId)}
                updateActivity={skillUpdateActivity}
                viewState={skillLibraryViewState}
                onViewStateChange={(next) => {
                  libraryScroll.resetScrollNow();
                  setSkillLibraryViewState(next);
                }}
                searchInputRef={skillSearchInputRef}
                scrollOwnerRef={libraryScroll.setScrollOwner}
            />
          </>
        ) : activeWorkspace === "profiles" ? (
          <>
            <PageHeader
              className="page-header profile-page-header"
              title={t("Profiles")}
              help={
                <InfoTip
                  label={t("Compose reusable resources, then preview and apply them to an Agent.")}
                />
              }
              actions={(
                <div className="profile-page-actions" ref={profilePageActionsRef}>
                  <Button
                    className={`profile-new-button${isNewProfilePrimary ? " is-primary" : ""}`}
                    variant={isNewProfilePrimary ? "primary" : "secondary"}
                    icon={<Plus size={15} strokeWidth={2.3} />}
                    onClick={openCreateProfileDialog}
                  >
                    {t("New Profile")}
                  </Button>
                </div>
              )}
            />
            <section className="profile-workbench ui-surface-frame" aria-label={t("Profiles")}>
              <ProfileList
                isLoading={isLoading}
                profiles={profiles}
                search={profileSearch}
                searchInputRef={profileSearchInputRef}
                selectedProfileId={profileLoadingId ?? selectedProfileId}
                draftProfile={draftProfile}
                isProfileDirty={isProfileDirty}
                targets={targets}
                targetStates={targetStates}
                actionsDisabled={busy}
                onDelete={openDeleteProfileDialog}
                onDuplicate={duplicateProfile}
                onSearchChange={setProfileSearch}
                onSelect={selectProfile}
              />
              <div className="profile-editor-surface">
                {profileLoadingId ? (
                  <div
                    className="profile-loading-surface"
                    role="status"
                    aria-live="polite"
                    aria-label={t("Loading profile {{name}}", {
                      name: loadingProfileSummary?.name ?? t("Profile")
                    })}
                  >
                    <header className="profile-hero profile-hero--loading">
                      <span className="profile-hero__icon" aria-hidden="true">
                        <ProductIcon name="profiles" size={19} strokeWidth={2.1} />
                      </span>
                      <div className="profile-hero__body">
                        <div className="profile-hero__title">
                          <h2>{loadingProfileSummary?.name ?? t("Profile")}</h2>
                        </div>
                        <p className="profile-description">{t("Loading profile...")}</p>
                      </div>
                      <LoaderCircle
                        className="is-spinning profile-loading-indicator"
                        size={18}
                        strokeWidth={2.2}
                        aria-hidden="true"
                      />
                    </header>
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
                    <header className="profile-hero">
                      <ResourceIconPicker
                        className="profile-hero__icon"
                        iconKey={draftProfile.manifest.iconKey ?? defaultProfileIconKey}
                        label={draftProfile.manifest.name}
                        showAgentIcons
                        triggerLabel={t("Change icon for profile {{id}}", { id: draftProfile.id })}
                        onChange={(iconKey) => {
                          if (iconKey) changeProfileIcon(draftProfile.id, iconKey);
                        }}
                      />
                      <div className="profile-hero__body">
                        <div className="profile-hero__title">
                          <h2
                            data-ui-overflow-detail="true"
                            title={draftProfile.manifest.name}
                          >
                            {draftProfile.manifest.name}
                          </h2>
                          <button
                            className="icon-action"
                            type="button"
                            aria-label={t("Edit profile")}
                            title={t("Edit profile")}
                            onClick={openEditProfileDialog}
                          >
                            <Pencil size={15} strokeWidth={2.2} />
                          </button>
                        </div>
                        <p className="profile-description">
                          {draftProfile.manifest.description || t("No description")}
                        </p>
                        <div
                          className={`profile-action-status profile-action-status--${readiness.status}`}
                        >
                          <span
                            className="profile-action-status__copy"
                            role="status"
                            aria-label={t("Profile readiness")}
                            title={t(readiness.message)}
                          >
                            <ReadinessIcon size={13} strokeWidth={2.3} aria-hidden="true" />
                            <span>{t(readinessActionText)}</span>
                          </span>
                          {readiness.remediationLabel && readiness.remediationLabel !== "Save now" ? (
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
                        </div>
                      </div>
                      <div className="profile-action-stack">
                        <div
                          className="profile-commit-actions"
                          ref={profileObjectActionsRef}
                          role="group"
                          aria-label={t("Selected profile actions")}
                        >
                          <div className="profile-save-control">
                            <button
                              ref={saveButtonRef}
                              className={`save-button${isProfileDirty ? " is-primary" : ""}`}
                              type="button"
                              aria-busy={isProfileSaving}
                              disabled={
                                busy ||
                                isProfileSaving ||
                                profileMetadataSavingId === draftProfile.id ||
                                !isProfileDirty
                              }
                              onClick={saveSelectedProfile}
                            >
                              {isProfileSaving ? (
                                <LoaderCircle
                                  className="is-spinning"
                                  size={15}
                                  strokeWidth={2.2}
                                  aria-hidden="true"
                                />
                              ) : null}
                              {t(isProfileSaving ? "Saving..." : "Save")}
                            </button>
                          </div>
                          {targetWorkspaceControl}
                          {profileApplyControl}
                          <button
                            ref={profileActionsButtonRef}
                            className="icon-action"
                            type="button"
                            aria-expanded={isProfileActionsOpen}
                            aria-haspopup="menu"
                            aria-label={t("More profile actions")}
                            title={t("More profile actions")}
                            disabled={busy || !draftProfile || draftProfile.id !== selectedProfileId}
                            onClick={() => {
                              setIsTargetMenuOpen(false);
                              setIsProfileActionsOpen((current) => !current);
                            }}
                          >
                            <MoreHorizontal size={16} strokeWidth={2.2} />
                          </button>
                          {isProfileActionsOpen ? (
                            <ProfileActionsMenu
                              disabled={busy}
                              menuRef={profileActionsMenuRef}
                              onDuplicate={() => duplicateProfile()}
                              onDelete={() => {
                                setIsProfileActionsOpen(false);
                                openDeleteProfileDialog();
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                    </header>
                    <section
                      className="profile-composer"
                      aria-label={t("Profile composer")}
                    >
                      <ProfileComposerSection
                        id="instructions"
                        icon={<ProductIcon name="instructions" size={18} />}
                        title={t("Instructions")}
                        description={t("Agent instructions and rule files")}
                        count={resourceSummary?.instructions.total ?? 0}
                        enabledCount={resourceSummary?.instructions.count ?? 0}
                        chipNames={
                          resourceSummary?.instructions.count
                            ? [
                                profileTarget?.instructionsLabel ??
                                  t("Instructions")
                              ]
                            : []
                        }
                        policy={resourceSummary?.instructions.mode ?? "manage"}
                        policyDisabled={!profileTarget?.capabilities.instructions}
                        policyLabel={t("Instructions application policy for {{name}}", {
                          name: activeTargetName
                        })}
                        policyStatus={
                          profileTarget?.capabilities.instructions
                            ? undefined
                            : t("Agent controlled")
                        }
                        targetName={activeTargetName}
                        expanded={activeComposerSection === "instructions"}
                        onToggle={() => toggleComposerSection("instructions")}
                        onPolicyChange={(policy) =>
                          updateSelectedResourceManagement("instructions", policy)
                        }
                      >
                        <AgentsEditor
                          label={
                            profileTarget?.instructionsLabel ??
                            t("Instructions")
                          }
                          path={selectedTarget?.paths.instructionsPath}
                          policy={resourceSummary?.instructions.mode ?? "manage"}
                          targetName={activeTargetName}
                          value={draftProfile.instructions}
                          onChange={(instructions) => {
                            updateDraftProfile({
                              ...draftProfile,
                              instructions
                            });
                          }}
                        />
                      </ProfileComposerSection>
                      <ProfileComposerSection
                        id="skills"
                        icon={<ProductIcon name="skills" size={18} />}
                        title={t("Skills")}
                        description={t("Reusable skills and workflows")}
                        count={resourceSummary?.skills.total ?? 0}
                        enabledCount={resourceSummary?.skills.count ?? 0}
                        chipNames={resourceSummary?.skills.names ?? []}
                        policy={resourceSummary?.skills.mode ?? "manage"}
                        policyDisabled={!profileTarget?.capabilities.skills}
                        policyLabel={t("Skills application policy for {{name}}", {
                          name: activeTargetName
                        })}
                        policyStatus={
                          profileTarget?.capabilities.skills
                            ? undefined
                            : t("Agent controlled")
                        }
                        targetName={activeTargetName}
                        expanded={activeComposerSection === "skills"}
                        onToggle={() => toggleComposerSection("skills")}
                        onPolicyChange={(policy) =>
                          updateSelectedResourceManagement("skills", policy)
                        }
                      >
                        <SkillsEditor
                          value={draftProfile.resources ?? emptyProfileResources}
                          librarySkills={librarySkills}
                          skillUpdates={skillUpdates}
                          checkingSkillUpdates={checkingProfileSkillUpdates}
                          appliedSkillVersions={
                            selectedTargetState?.activeProfileId ===
                            draftProfile.id
                              ? selectedTargetState.appliedLibraryVersions
                                  ?.skills
                              : undefined
                          }
                          skillReceipts={
                            selectedTargetState?.activeProfileId ===
                            draftProfile.id
                              ? selectedTargetState.skillReceipts
                              : undefined
                          }
                          selectedTargetName={selectedTarget?.name}
                          onCheckSkillUpdates={(ids) =>
                            void checkProfileSkillUpdates(ids)
                          }
                          onPreviewSkillUpdate={(id) =>
                            void previewLibrarySkillUpdate(id)
                          }
                          onChange={(resources) => {
                            updateDraftProfile({
                              ...draftProfile,
                              resources
                            });
                          }}
                        />
                      </ProfileComposerSection>
                      <ProfileComposerSection
                        id="mcp"
                        icon={<ProductIcon name="mcps" size={18} />}
                        title={t("MCPs")}
                        description={t(
                          "External tools and service connections"
                        )}
                        count={resourceSummary?.mcp.total ?? 0}
                        enabledCount={resourceSummary?.mcp.count ?? 0}
                        countSummary={t("Profile {{profile}} · Agent {{agent}}", {
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
                          profileTarget?.capabilities.mcpActivation
                            ? undefined
                            : t("Agent controlled")
                        }
                        targetName={activeTargetName}
                        expanded={activeComposerSection === "mcp"}
                        onToggle={() => toggleComposerSection("mcp")}
                        onPolicyChange={(policy) =>
                          updateSelectedResourceManagement("mcp", policy)
                        }
                      >
                        <ProfileMcpEditor
                          target={selectedTarget}
                          connections={nativeMcpConnections}
                          issues={nativeMcpIssues}
                          value={draftProfile.resources ?? emptyProfileResources}
                          onChange={(resources) =>
                            updateDraftProfile({ ...draftProfile, resources })
                          }
                          onRefresh={refreshNativeMcpConnections}
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
                        onOpenRecovery={() => {
          clearProfilePreview();
                          setSettingsCategory("data");
                          openWorkspaceNow("settings");
                          setBackupManagerOpen(true);
                        }}
                        onAdoptTargetChanges={adoptCompatibleTargetChanges}
                        onLeaveSkillUnmanaged={(issue) =>
                          leavePreviewSkillUnmanaged(issue, preview.targetId, async () => {
                            if (!draftProfile) return;
                            await refreshProfilePreview(
                              draftProfile.id,
                              preview.targetId
                            );
                          })}
                        onReviewSkillCollection={reviewPreviewSkillCollection}
                        onCancel={clearProfilePreview}
                        onConfirm={applySelectedProfile}
                      />
                    ) : null}
                      <SkillUpdateDialog
                        plan={selectedSkillUpdatePlan}
                        busy={busy}
                        progress={selectedSkillUpdatePlan
                          ? skillUpdateRun[selectedSkillUpdatePlan.id]
                          : undefined}
                        onClose={() => {
                          setSelectedSkillUpdatePlan(undefined);
                          setSkillUpdateRun({});
                        }}
                        onConfirm={(plan) => void updateLibrarySkill(plan)}
                      />
                  </>
                ) : (
                  <div className="profile-empty-surface">
                    <div className="empty-state">
                      <h2>{t("No profile selected")}</h2>
                      <p className="muted">{t("Choose a profile or create one.")}</p>
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
                    aria-label={t("Unsaved profile changes")}
                    aria-modal="true"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <header className="profile-dialog-header">
                      <div className="ui-dialog-header__copy">
                        <div className="section-title ui-dialog-title">{t("Save profile changes?")}</div>
                        <p className="muted ui-dialog-description">
                          {t("Save before you {{action}}, or discard the current draft.", { action: t(pendingProfileAction.label) })}
                        </p>
                      </div>
                    </header>
                    <footer className="preview-actions profile-dirty-actions">
                      <button ref={appModalInitialFocusRef} className="secondary-action" type="button" disabled={busy} onClick={cancelPendingProfileAction}>
                        {t("Cancel")}
                      </button>
                      <button className="secondary-action" type="button" disabled={busy} onClick={() => void continuePendingProfileAction(false)}>
                        {t("Discard changes")}
                      </button>
                      <button className="primary-action" type="button" disabled={busy} onClick={() => void continuePendingProfileAction(true)}>
                        {t("Save and continue")}
                      </button>
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
            </section>
          </>
        ) : activeWorkspace === "conversations" ? (
          <ConversationWorkspace
            targets={targets}
            initialViewState={conversationViewState}
            onViewStateChange={setConversationViewState}
            openRequest={conversationQuickOpen.openRequest}
            onOpenRequestHandled={conversationQuickOpen.handleOpenRequest}
          />
        ) : activeWorkspace === "targets" ? (
            <TargetWorkspace
              targets={targets}
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
              onRefresh={refreshTargets}
              onConfigure={openAgentConfiguration}
              onReviewEnvironment={openEnvironmentReview}
              onCreateProfileFromTarget={(targetId) =>
                openCreateFromTargetDialog(targetId, "all")}
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
              className="settings-category-panel ui-surface-frame"
              id="settings-category-panel"
              role="tabpanel"
              aria-labelledby={`settings-tab-${settingsCategory}`}
            >
            {settingsCategory === "general" ? (
              <GeneralSettingsSection
                locale={skillSettings.locale}
                onLocaleChange={(locale) => updateSkillSettings({ locale })}
                conversationTerminal={skillSettings.conversationTerminal}
                onConversationTerminalChange={(conversationTerminal) =>
                  updateSkillSettings({ conversationTerminal })}
              />
            ) : null}
            {settingsCategory === "agents" ? (
            <AgentSettingsSection
              supportedAgents={supportedTargets}
              enabledAgentIds={
                skillSettings.enabledTargetIds ?? supportedTargets.map((target) => target.id)
              }
              agents={targets}
              agentStates={targetStates}
              busy={busy}
              onSetEnabled={setAgentEnabled}
              onOpenRecovery={() => openWorkspaceNow("targets")}
              configRoots={skillSettings.targetConfigRoots ?? {}}
              onChooseConfigRoot={chooseTargetConfigRoot}
              onResetConfigRoot={resetTargetConfigRoot}
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
                <WorkspaceSyncSettings />
                <section
                  className="resource-section github-settings-section"
                  id="github-connection-settings"
                  tabIndex={-1}
                  aria-label={t("GitHub OAuth settings")}
                >
                  <div className="settings-section-header github-account-header">
                    <div className="github-account-identity">
                      <span className="settings-service-icon" aria-hidden="true">
                        <GitFork size={20} strokeWidth={2} />
                      </span>
                      <div>
                        <div className="resource-heading">GitHub</div>
                        <p className="settings-muted">
                          {githubAuthStatus.state === "signed-in"
                            ? githubAuthStatus.user
                              ? t("Connected as {{login}}", { login: githubAuthStatus.user.login })
                              : t("Connected; GitHub status is temporarily unavailable")
                            : githubDeviceLogin ? t("Authorize AgentEnv Manager in your browser")
                            : t("Connect for reliable GitHub imports and update checks")}
                        </p>
                      </div>
                    </div>
                    <div className="github-settings-actions">
                      {githubAuthStatus.state === "signed-in" ? (
                        <button disabled={busy || githubLoginChecking} onClick={signOutGitHub} type="button">
                          {t("Sign out")}
                        </button>
                      ) : !githubDeviceLogin ? (
                        <button
                          className="secondary-action"
                          disabled={busy || githubLoginChecking}
                          onClick={startGitHubLogin}
                          type="button"
                        >
                          <GitFork size={15} strokeWidth={2.2} aria-hidden="true" />
                          {githubLoginChecking ? t("Connecting...") : t("Sign in with GitHub")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {githubDeviceLogin ? (
                    <div className="github-device-card">
                      <button
                        className={`github-device-code${githubCodeCopied ? " is-copied" : ""}`}
                        type="button"
                        aria-label={t("Copy GitHub device code {{code}}", { code: githubDeviceLogin.userCode })}
                        onClick={copyGitHubDeviceCode}
                      >
                        <span>{t("Device code")}</span>
                        <strong>{githubDeviceLogin.userCode}</strong>
                        <span className="github-device-copy-state">
                          {githubCodeCopied ? <CheckCircle2 size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                          {githubCodeCopied ? t("Copied") : t("Copy")}
                        </span>
                      </button>
                      <div className="github-device-status" role="status" aria-live="polite">
                        <RefreshCw className={githubLoginChecking ? "is-spinning" : ""} size={15} aria-hidden="true" />
                        <span>{githubLoginMessage || t("Waiting for authorization. This page updates automatically.")}</span>
                      </div>
                      <div className="github-device-actions">
                        <button
                          className="primary-button"
                          onClick={() => window.agentEnv.openGitHubDevicePage(githubDeviceLogin.verificationUri)}
                          type="button"
                        >
                          <ExternalLink size={15} aria-hidden="true" />
                          {t("Open GitHub")}
                        </button>
                        <button disabled={githubLoginChecking} onClick={() => void pollGitHubLogin()} type="button">
                          {t("Check now")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {githubAuthStatus.state === "signed-in" ? (
                    <div className="github-connected-row" role="status">
                      <span className="github-connected-indicator" aria-hidden="true" />
                      <strong>{t("Connected")}</strong>
                      {githubAuthStatus.rateLimit ? (
                        <span>
                          {t("{{remaining}} of {{limit}} API requests remaining · resets {{time}}", {
                            remaining: formatNumber(githubAuthStatus.rateLimit.remaining),
                            limit: formatNumber(githubAuthStatus.rateLimit.limit),
                            time: formatDate(githubAuthStatus.rateLimit.resetAt)
                          })}
                        </span>
                      ) : null}
                    </div>
                  ) : githubLoginMessage && !githubDeviceLogin ? (
                    <div className="github-login-result" role="status">{githubLoginMessage}</div>
                  ) : null}
                  {githubAuthStatus.error ? (
                    <div className={`github-login-result${githubAuthStatus.verification === "unavailable" ? "" : " github-login-result--error"}`}
                      role={githubAuthStatus.verification === "unavailable" ? "status" : "alert"}>
                      {githubAuthStatus.error}
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}
            {settingsCategory === "data" ? (
            <>
            <section className="resource-section settings-section" aria-labelledby="agentenv-data-heading">
              <div className="settings-section-header settings-data-header">
                <div>
                  <div className="resource-heading" id="agentenv-data-heading">{t("Data & Backups")}</div>
                  <p className="settings-muted">{t("AgentEnv data and the recovery points created before local changes.")}</p>
                </div>
                <div className="settings-data-actions">
                  <button className="secondary-action" type="button" disabled={busy} onClick={() => void window.agentEnv.openDataFolder()}>
                    <FolderOpen size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t("Open folder")}
                  </button>
                </div>
              </div>
              <DataRootPath />
              <div className="backup-settings-list">
                <div className="backup-settings-row">
                  <span className="backup-settings-icon" aria-hidden="true">
                    <History size={18} strokeWidth={2} />
                  </span>
                  <span className="backup-settings-copy">
                    <strong>{t("Recovery storage")}</strong>
                    <small>
                      {managedBackupsLoading && !managedBackups
                        ? t("Calculating storage...")
                        : t((managedBackups?.items.length ?? 0) === 1 ? "{{count}} backup · {{size}}" : "{{count}} backups · {{size}}", {
                            count: managedBackups?.items.length ?? 0,
                            size: formatBytes(managedBackups?.totalBytes ?? 0)
                          })}
                    </small>
                  </span>
                  <span className="backup-settings-row-actions">
                    <FreshnessStatus
                      state={freshnessStates.backups}
                      verb="Refreshed"
                    />
                    <button type="button" className="secondary-action" disabled={busy} onClick={openBackupManager}>
                      {t("Manage")}
                    </button>
                  </span>
                </div>
                <label className="backup-settings-row" htmlFor="backup-retention-days">
                  <span className="backup-settings-icon" aria-hidden="true">
                    <Clock3 size={18} strokeWidth={2} />
                  </span>
                  <span className="backup-settings-copy">
                    <strong>{t("Automatic cleanup")}</strong>
                    <small>{t("Applies only to managed recovery backups.")}</small>
                  </span>
                  <select
                    id="backup-retention-days"
                    aria-label={t("Backup retention")}
                    disabled={busy}
                    value={skillSettings.backupRetentionDays ?? "never"}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      void updateSkillSettings({
                        backupRetentionDays: value === "never" ? null : Number(value) as BackupRetentionDays
                      });
                    }}
                  >
                    <option value="never">{t("Never")}</option>
                    <option value="7">{t("Keep for 7 days")}</option>
                    <option value="30">{t("Keep for 30 days")}</option>
                    <option value="90">{t("Keep for 90 days")}</option>
                  </select>
                </label>
              </div>
              <div className="settings-data-footer">
                <span className="settings-field-note">{t("Data exports are stored outside AgentEnv and are never cleaned automatically.")}</span>
                <div className="settings-data-actions">
                  <button className="secondary-action" type="button" disabled={busy} onClick={() => void createAgentEnvDataBackup()}>
                    <HardDrive size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t("Export data")}
                  </button>
                  <button className="secondary-action" type="button" disabled={busy} onClick={() => void selectAgentEnvDataRestore()}>
                    <RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t("Restore data")}
                  </button>
                </div>
              </div>
            </section>
            <DiagnosticSettingsSection
              busy={busy}
              onCopyLatest={copyLatestDiagnosticIssue}
              onExport={exportDiagnosticReport}
              onOpenLogs={openDiagnosticLogFolder}
            />
            </>
            ) : null}
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
                onBackOrClose={closeBackupManager}
                onCancelCleanup={() => setBackupCleanupConfirm(false)}
                onCancelDelete={() => setBackupDeleteCandidate(undefined)}
                onCleanup={() => void cleanupManagedBackups()}
                onDelete={() => void deleteSelectedManagedBackup()}
                onOpenCleanupConfirm={() => setBackupCleanupConfirm(true)}
                onOpenDelete={setBackupDeleteCandidate}
                onPreview={(item) => void previewManagedBackup(item)}
              />
            ) : null}
            {dataRestorePreview ? (
              <div
                className="preview-modal-backdrop"
                data-dismiss-policy="standard"
                onClick={() => {
                  if (!busy) setDataRestorePreview(undefined);
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
                    <button ref={appModalInitialFocusRef} className="secondary-action" type="button" disabled={busy} onClick={() => setDataRestorePreview(undefined)}>{t("Cancel")}</button>
                    <button className="danger-action" type="button" disabled={busy} onClick={() => void restoreAgentEnvData()}>{t("Restore data")}</button>
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
            <h2>{t("No profile selected")}</h2>
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
              setProfileCaptureError("");
              setProfileForm((current) => ({
                ...current,
                targetId,
                name: target?.name ?? current.name
              }));
            }}
            onBack={() => {
              setTargetCapturePreview(undefined);
              setProfileCaptureError("");
            }}
            onCancel={closeProfileDialog}
            onReview={() => void reviewTargetCapture()}
            onCreate={() => void submitProfileDialog()}
            onRefreshReview={() => void reviewTargetCapture()}
          />
        ) : null}
        <DiagnosticIssueDialog
          issue={diagnosticIssue}
          onDismiss={() => setDiagnosticIssue(undefined)}
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
