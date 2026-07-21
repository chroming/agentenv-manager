import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  BookOpenText,
  ExternalLink,
  FolderKanban,
  GitFork,
  HardDrive,
  History,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Settings2,
  TriangleAlert,
  Trash2,
  X
} from "lucide-react";
import type {
  ApplyIssue,
  ActivationPreview,
  BackupSummary,
  DataRestorePreview,
  ProfileDetail,
  ProfileResources,
  ProfileSummary,
  ResourceIconKey,
  RollbackPreview,
  StopManagingMode,
  StopManagingPreview,
  SaveProfileInput,
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
  NativeMcpConnection,
  NativeMcpInspectionIssue,
  RetireSharedSkillInput,
  SharedSkillRetentionInput,
  SkillInventoryEntry,
  SkillImportConflictResolution,
  SkillImportInput,
  SkillImportPreview,
  SkillImportPreviewInput,
  SkillAvailabilityInput,
  SkillIconInput,
  SkillCleanupRequest,
  SkillCleanupBackupSummary,
  SkillCleanupResult,
  SkillLibraryEntry,
  SkillSourceGroupView,
  SkillSourceNameInput,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult,
  SkillMergeInput,
  SkillMergePreview,
  SkillUpdatePolicyInput,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdateSourceInput,
  TargetDescriptor,
  TargetInfo,
  TargetCapturePreview,
  TargetManagementState
} from "../shared/types";
import { I18nProvider, useI18n, type TranslationValues } from "./i18n";
import {
  collectLibraryResourceVersions,
  libraryResourceVersionsEqual
} from "../shared/libraryVersions";
import { isTargetInstalled } from "../shared/targetHealth";
import { isExternalSkillImportable } from "../shared/skillIdentity";
import {
  setProfileResourceMode,
  type ManagedProfileResource
} from "../shared/profileResources";
import { AgentsEditor } from "./components/AgentsEditor";
import { AgentSettingsSection } from "./components/AgentSettingsSection";
import { DiffViewer } from "./components/DiffViewer";
import { InfoTip } from "./components/InfoTip";
import { PreviewDialog } from "./components/PreviewDialog";
import { ProfileMcpEditor } from "./components/ProfileMcpEditor";
import { ProfileList } from "./components/ProfileList";
import { ProfileActionsMenu } from "./components/ProfileActionsMenu";
import { ProfileComposerSection } from "./components/ProfileComposerSection";
import { ResourceIconPicker } from "./components/ResourceIconPicker";
import {
  ProfileSidebar,
  targetIconFor,
  type AppWorkspace
} from "./components/ProfileSidebar";
import {
  type GitHubSkillImportProgress,
  repositoryImportProgressKey,
  SkillLibraryPanel,
  type PreparedSkillTarget,
  type SkillUpdateCheckStatus
} from "./components/SkillLibraryPanel";
import { SkillUpdateDialog } from "./components/SkillUpdateDialog";
import { SkillsEditor } from "./components/SkillsEditor";
import { TargetCaptureDialog } from "./components/TargetCaptureDialog";
import { TargetWorkspace } from "./components/TargetWorkspace";
import { Button, ControlGroup, PageHeader, Switch } from "./components/ui";
import {
  deriveApplyActionLabel,
  deriveProfileReadiness
} from "./profileReadiness";
import { defaultSkillLibraryViewState, updateLibraryScroll } from "./libraryViewState";
import { useLibraryScrollRestoration } from "./hooks/useLibraryScrollRestoration";
import { useModalDialog } from "./hooks/useModalDialog";
import { useDesktopShortcuts } from "./hooks/useDesktopShortcuts";
import {
  preferredTargetForProfile,
  summarizeProfile,
  type ProfileResourceSummary
} from "./profileSummary";
import { createTargetNameIndex } from "./targetPresentation";
const emptyProfileResources: ProfileResources = {
  skills: [],
  managementByTarget: {},
  mcpByTarget: {}
};

const reconcileProfileUsage = (
  current: Record<string, string[]>,
  previousReferencedIds: readonly string[],
  nextReferencedIds: readonly string[],
  previousName: string,
  nextName: string
) => {
  const next = Object.fromEntries(
    Object.entries(current).map(([id, names]) => [id, [...names]])
  );
  const previousIds = previousReferencedIds.length > 0
    ? previousReferencedIds
    : Object.entries(current)
        .filter(([, names]) => names.includes(previousName))
        .map(([id]) => id);
  for (const id of new Set(previousIds)) {
    const names = next[id] ?? [];
    const previousIndex = names.indexOf(previousName);
    if (previousIndex >= 0) names.splice(previousIndex, 1);
    if (names.length === 0) delete next[id];
  }
  for (const id of new Set(nextReferencedIds)) {
    next[id] = [...(next[id] ?? []), nextName];
  }
  return next;
};

type ComposerSection = "instructions" | "skills" | "mcp";
type ProfileDialogMode = "create" | "edit";
type ProfileCreateSource = "blank" | "target";
type ProfileCaptureOrigin = "profiles" | "targets";
type ProfileCaptureActivity = "idle" | "reviewing" | "creating";

interface PendingProfileAction {
  label: string;
}

interface PendingSkillImport {
  preview: SkillImportPreview;
  resolve: (resolution: SkillImportConflictResolution | undefined) => void;
  committing?: boolean;
}

interface BackupManagerNotice {
  kind: "success" | "error";
  message: string;
}

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

const managedBackupTitle = (item: ManagedBackupItem, t: Translate): string =>
  item.kind === "skill-cleanup"
    ? t(item.restored ? "Restored skill cleanup · {{name}}" : "Skill cleanup · {{name}}", {
        name: item.libraryId ?? item.id
      })
    : item.profileName
      ? t("{{profile}} · {{target}}", {
          profile: item.profileName,
          target: item.targetId ?? t("Agent")
        })
      : t("Agent recovery · {{target}}", { target: item.targetId ?? t("Unknown Agent") });

const managedBackupStatusLabel = (item: ManagedBackupItem, t: Translate): string => {
  if (item.requiredReason === "recovery-required") return t("Required for recovery");
  if (item.requiredReason === "takeover-baseline") return t("Takeover baseline");
  if (item.cleanupStatus === "retained") return t("Latest recovery point");
  if (item.cleanupStatus === "eligible") return t("Ready to clean");
  return t("Kept by policy");
};

type Translate = (message: string, values?: TranslationValues) => string;

const summarizeSkillUpdateChecks = (
  skillUpdateItems: SkillUpdateInfo[],
  t: Translate
): SkillUpdateCheckStatus => {
  const failedChecks = skillUpdateItems.filter((update) => update.error).length;
  const availableUpdates = skillUpdateItems.filter(
    (update) => update.updateAvailable && !update.error
  ).length;

  if (failedChecks > 0) {
    return {
      state: "error",
      message: t(failedChecks === 1 ? "{{count}} check failed" : "{{count}} checks failed", {
        count: failedChecks
      })
    };
  }

  if (skillUpdateItems.length === 0) {
    return {
      state: "info",
      message: t("No skills have update checks enabled")
    };
  }

  return {
    state: "success",
    message:
      availableUpdates > 0
        ? t(availableUpdates === 1 ? "{{count}} update available" : "{{count}} updates available", {
            count: availableUpdates
          })
        : t("All tracked skills are up to date")
  };
};

const summarizeSkillUpdateResult = (
  skillId: string,
  skillUpdateItems: SkillUpdateInfo[],
  t: Translate
): SkillUpdateCheckStatus => {
  const remainingUpdates = skillUpdateItems.filter(
    (update) => update.updateAvailable && !update.error
  ).length;

  return {
    state: "success",
    message:
      remainingUpdates > 0
        ? t("Updated {{id}} · {{count}} updates remain", {
            id: skillId,
            count: remainingUpdates
          })
        : t("Updated {{id}} · All tracked skills are up to date", { id: skillId })
  };
};

const toSaveInput = (profile: ProfileDetail): SaveProfileInput => ({
  manifest: profile.manifest,
  instructions: profile.instructions,
  resources: profile.resources
});

type AppFeedbackKind = "loading" | "success" | "error" | "info";

interface AppFeedbackMessage {
  kind: AppFeedbackKind;
  title: string;
  message?: string;
  action?: {
    label: string;
    onClick(): void;
  };
}

export const AppFeedback = ({
  feedback,
  onDismiss
}: {
  feedback?: AppFeedbackMessage;
  onDismiss(): void;
}) => {
  const { t } = useI18n();
  const onDismissRef = useRef(onDismiss);
  const [copied, setCopied] = useState(false);
  onDismissRef.current = onDismiss;
  const feedbackKey = feedback
    ? `${feedback.kind}\u0000${feedback.title}\u0000${feedback.message ?? ""}`
    : "";

  useEffect(() => {
    if (!feedback || (feedback.kind !== "success" && feedback.kind !== "info")) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => onDismissRef.current(), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [feedbackKey, feedback?.kind]);

  useEffect(() => {
    setCopied(false);
  }, [feedbackKey]);

  if (!feedback) {
    return null;
  }

  const Icon =
    feedback.kind === "error"
      ? TriangleAlert
      : feedback.kind === "loading"
        ? RefreshCw
        : feedback.kind === "success"
          ? CheckCircle2
          : Settings2;
  const copyFeedback = async () => {
    const text = [feedback.title, feedback.message].filter(Boolean).join("\n");
    await window.agentEnv.copyText(text);
    setCopied(true);
  };

  return (
    <div
      className={`app-feedback app-feedback--${feedback.kind}${
        feedback.kind === "error" ? " app-feedback--dismissible" : ""
      }`}
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
      <div>
          <strong>{t(feedback.title)}</strong>
          {feedback.message ? <span>{t(feedback.message)}</span> : null}
        {feedback.action ? (
          <button className="app-feedback__action" type="button" onClick={feedback.action.onClick}>
            {t(feedback.action.label)}
          </button>
        ) : null}
      </div>
      <div className="app-feedback__controls">
        <button
          type="button"
          aria-label={t(copied ? "Message copied" : "Copy message")}
          title={t(copied ? "Copied" : "Copy message")}
          onClick={() => void copyFeedback()}
        >
          {copied ? (
            <CheckCircle2 size={14} strokeWidth={2.2} aria-hidden="true" />
          ) : (
            <Copy size={14} strokeWidth={2.2} aria-hidden="true" />
          )}
        </button>
        {feedback.kind === "error" ? (
          <button type="button" aria-label={t("Dismiss message")} onClick={onDismiss}>
            <X size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
};

const isGitHubRateLimitError = (message: string) =>
  /github.*(?:rate limit|api limit)|(?:rate limit|api limit).*github/i.test(message);

type ValidationLevel = "ok" | "warning" | "error" | "pending";

interface ValidationRow {
  source: "access" | "instructions" | "skills" | "conflicts";
  label: string;
  value: string;
  detail?: string;
  level: ValidationLevel;
}

const createValidationRows = (
  profile: ProfileDetail,
  target?: TargetInfo,
  preview?: ActivationPreview
): ValidationRow[] => {
  const targetLevel: ValidationLevel =
    target?.health.status === "ready"
      ? "ok"
      : target?.health.status === "missing"
        ? "error"
        : target
          ? "warning"
          : "pending";

  const blockingIssues = preview?.issues.filter((issue) => issue.disposition === "block") ?? [];

  return [
    {
      source: "access",
      label: `${target?.name ?? "Agent"} access`,
      value:
        target?.health.status === "ready"
          ? "OK"
          : target?.health.status === "missing"
            ? "Blocked"
            : target?.health.status === "guarded"
              ? "Guarded"
              : target
                ? "Needs setup"
                : "Pending",
      detail: target?.health.summary,
      level: targetLevel
    },
    {
      source: "instructions",
      label: target?.instructionsLabel ?? "Instructions",
      value: profile.instructions.trim().length > 0 ? "OK" : "Empty",
      detail:
        profile.instructions.trim().length === 0
          ? "Applying this Profile clears managed instructions"
          : undefined,
      level:
        profile.instructions.trim().length === 0
          ? "warning"
          : "ok"
    },
    {
      source: "skills",
      label: "Skills",
      value: `${profile.resources.skills.length}`,
      detail: "Preview verifies Library availability and Agent ownership",
      level: "pending"
    },
    {
      source: "conflicts",
      label: "Live conflicts",
      value: preview ? (blockingIssues.length > 0 ? "Blocked" : "OK") : "Pending",
      detail: preview
        ? blockingIssues.length > 0
          ? `${blockingIssues.length} issue${blockingIssues.length === 1 ? "" : "s"} found`
          : "Preview checks passed"
        : "Run preview to check live files",
      level: preview ? (blockingIssues.length > 0 ? "error" : "ok") : "pending"
    }
  ];
};

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
  const [skillSourceGroupsLoading, setSkillSourceGroupsLoading] = useState(false);
  const [skillLibraryMode, setSkillLibraryMode] = useState<"skills" | "sources">("skills");
  const [skillUpdates, setSkillUpdates] = useState<SkillUpdateInfo[]>([]);
  const [skillInventory, setSkillInventory] = useState<SkillInventoryEntry[]>([]);
  const [skillInventoryRefreshing, setSkillInventoryRefreshing] = useState(false);
  const [skillCleanupBackups, setSkillCleanupBackups] = useState<SkillCleanupBackupSummary[]>([]);
  const [skillCleanupResult, setSkillCleanupResult] = useState<SkillCleanupResult>();
  const [pendingSkillImport, setPendingSkillImport] = useState<PendingSkillImport>();
  const [selectedSkillConflictId, setSelectedSkillConflictId] = useState("");
  const [skillImportAlternateId, setSkillImportAlternateId] = useState("");
  const [skillImportDecision, setSkillImportDecision] = useState<"replace" | "keep-both">("replace");
  const [selectedSkillUpdatePlan, setSelectedSkillUpdatePlan] = useState<SkillUpdatePlan>();
  const [bulkSkillUpdatePlans, setBulkSkillUpdatePlans] = useState<SkillUpdatePlan[]>();
  const [profileResourceCounts, setProfileResourceCounts] = useState<
    Record<string, ProfileResourceSummary>
  >({});
  const [profileLibraryVersions, setProfileLibraryVersions] = useState<
    Record<string, LibraryResourceVersions>
  >({});
  const [skillSettings, setSkillSettings] = useState<AgentEnvSettings>({
    locale: "system",
    skillSyncMethod: "symlink",
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
  const pendingProfileActionRef = useRef<(() => void | Promise<void>) | null>(null);
  const pendingWindowCloseRef = useRef(false);
  const isProfileDirtyRef = useRef(false);
  const [pendingProfileAction, setPendingProfileAction] = useState<PendingProfileAction>();
  const [skillUsage, setSkillUsage] = useState<Record<string, string[]>>({});
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [profileTargetSelections, setProfileTargetSelections] = useState<Record<string, string>>({});
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [profileLoadingId, setProfileLoadingId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [preview, setPreview] = useState<ActivationPreview>();
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview>();
  const [stopManagingPreview, setStopManagingPreview] = useState<StopManagingPreview>();
  const [rollbackError, setRollbackError] = useState<string>();
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>("library");
  const [skillLibraryViewState, setSkillLibraryViewState] = useState(
    defaultSkillLibraryViewState
  );
  const [skillLibraryTool, setSkillLibraryTool] = useState<"import" | "discoveries">();
  const [skillUpdateCheckStatus, setSkillUpdateCheckStatus] =
    useState<SkillUpdateCheckStatus>();
  const [skillUpdateFeedbackWorkspace, setSkillUpdateFeedbackWorkspace] =
    useState<"library" | "profiles">("library");
  const [checkingProfileSkillUpdates, setCheckingProfileSkillUpdates] = useState(false);
  const [isProfileDirty, setIsProfileDirty] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [profileMetadataSavingId, setProfileMetadataSavingId] = useState<string>();
  const [isProfilePreviewing, setIsProfilePreviewing] = useState(false);
  const [isProfileApplying, setIsProfileApplying] = useState(false);
  const [profileSaveStatus, setProfileSaveStatus] = useState("");
  const [settingsSaveStatus, setSettingsSaveStatus] = useState("");
  const [dataBackupStatus, setDataBackupStatus] = useState("");
  const [dataRestorePreview, setDataRestorePreview] = useState<DataRestorePreview>();
  const [managedBackups, setManagedBackups] = useState<ManagedBackupInventory>();
  const [managedBackupsLoading, setManagedBackupsLoading] = useState(false);
  const [backupManagerOpen, setBackupManagerOpen] = useState(false);
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
  const profilePageActionsRef = useRef<HTMLDivElement>(null);
  const profileObjectActionsRef = useRef<HTMLDivElement>(null);
  const profileApplyControlRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const targetMenuButtonRef = useRef<HTMLButtonElement>(null);
  const profileActionsButtonRef = useRef<HTMLButtonElement>(null);
  const profileSearchInputRef = useRef<HTMLInputElement>(null);
  const skillSearchInputRef = useRef<HTMLInputElement>(null);
  const dataRefreshRequestRef = useRef(0);
  const profileFlowRequestRef = useRef(0);
  const activeProfileFlowRequestRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
  const rollbackReturnFocusRef = useRef<HTMLElement | null>(null);
  const dataRestoreReturnFocusRef = useRef<HTMLElement | null>(null);
  const backupManagerReturnFocusRef = useRef<HTMLElement | null>(null);
  const appModalDialogRef = useRef<HTMLElement>(null);
  const appModalInitialFocusRef = useRef<HTMLButtonElement>(null);
  const appModalFallbackFocusRef = useRef<HTMLElement>(null);
  const activeLibraryView =
    activeWorkspace === "library" && skillLibraryMode === "skills" ? "skills" : undefined;
  const refreshSkillSourceGroups = useCallback(async () => {
    setSkillSourceGroupsLoading(true);
    try {
      setSkillSourceGroups(await window.agentEnv.listSkillSourceGroups());
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setSkillSourceGroupsLoading(false);
    }
  }, []);
  const refreshManagedBackups = useCallback(async () => {
    setManagedBackupsLoading(true);
    try {
      setManagedBackups(await window.agentEnv.listManagedBackups());
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setManagedBackupsLoading(false);
    }
  }, []);
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
    void refreshManagedBackups();
  }, [activeWorkspace, refreshManagedBackups]);

  useEffect(() => {
    if (activeWorkspace === "library" && skillLibraryMode === "sources") {
      void refreshSkillSourceGroups();
    }
  }, [activeWorkspace, refreshSkillSourceGroups, skillLibraryMode]);

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
    if (
      profileSaveStatus !== "Profile saved" &&
      profileSaveStatus !== "Profile details saved"
    ) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setProfileSaveStatus(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [profileSaveStatus]);

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

  const invalidateProfileFlow = () => {
    profileFlowRequestRef.current += 1;
    if (activeProfileFlowRequestRef.current !== undefined) {
      activeProfileFlowRequestRef.current = undefined;
      setIsProfilePreviewing(false);
      setBusy(false);
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
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        }
      });
    const corePromise = Promise.all([
      window.agentEnv.listSupportedTargets(),
      window.agentEnv.listTargets(forceTargetRefresh),
      window.agentEnv.listTargetStates(),
      window.agentEnv.listProfiles(),
      window.agentEnv.listBackups(),
      skillItemsPromise,
      window.agentEnv.listSkillCleanupBackups(),
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
      backupItems,
      ,
      cleanupBackupItems,
      settings
    ] = await corePromise;

    if (!shouldApply()) {
      return {
        supportedTargetItems,
        targetItems,
        targetStateItems,
        profileItems,
        backupItems,
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
    setBackups(backupItems);
    setSkillCleanupBackups(cleanupBackupItems);
    setSkillSettings(settings);
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
      backupItems,
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
    const {
      supportedTargetItems,
      targetItems,
      profileItems,
      skillItems,
      settings
    } = core;
    const [skillUpdatesResult, skillInventoryResult, githubStatusResult] =
      await Promise.allSettled([
        checkSkillUpdates && (forceSkillUpdateCheck || settings.skillAutoCheckEnabled)
          ? window.agentEnv.checkSkillLibraryUpdates()
          : Promise.resolve(skillUpdates),
        window.agentEnv.scanSkillInventory(),
        window.agentEnv.readGitHubAuthStatus()
      ]);
    const skillUpdateItems =
      skillUpdatesResult.status === "fulfilled" ? skillUpdatesResult.value : skillUpdates;
    const skillInventoryItems =
      skillInventoryResult.status === "fulfilled" ? skillInventoryResult.value : skillInventory;
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
    const nextProfileResourceCounts: Record<string, ProfileResourceSummary> = {};
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
      if (profileTarget) {
        nextProfileResourceCounts[profile.id] = summarizeProfile(
          profile,
          profileTarget,
          skillItems
        );
      }
      for (const skillRef of profile.resources.skills) {
        usage[skillRef.libraryId] = (usage[skillRef.libraryId] ?? []).concat(
          profile.manifest.name
        );
      }
    }
    if (!shouldApply()) {
      return { skillUpdateItems };
    }
    setSkillUpdates(skillUpdateItems);
    setSkillInventory(skillInventoryItems);
    setGithubAuthStatus(githubStatus);
    setSkillUsage(usage);
    setProfileResourceCounts(nextProfileResourceCounts);
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

  const refreshSkills = async () => {
    if (skillRefreshStatus === "refreshing") {
      return;
    }
    setError(undefined);
    setSkillRefreshStatus("refreshing");
    try {
      await refreshProfiles({ checkSkillUpdates: false });
      setSkillRefreshStatus("refreshed");
    } catch (unknownError) {
      setSkillRefreshStatus(undefined);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
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
      setSkillUpdates((current) => current.filter((item) => item.id !== updated.id));
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
    setSkillUpdates((current) => [
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
      Object.fromEntries(
        Object.entries(current).map(([profileId, versions]) => {
          const skills = { ...versions.skills };
          for (const skill of updatedSkills) {
            if (Object.prototype.hasOwnProperty.call(skills, skill.id)) {
              skills[skill.id] = skill.contentHash;
            }
          }
          return [profileId, { ...versions, skills }];
        })
      )
    );
    setTargetStates((current) =>
      current.map((state) => {
        const appliedSkills = state.appliedLibraryVersions?.skills ?? {};
        const changedDeployment = updatedSkills.some(
          (skill) =>
            Object.prototype.hasOwnProperty.call(
              appliedSkills,
              skill.id
            ) && appliedSkills[skill.id] !== skill.contentHash
        );
        if (
          !changedDeployment ||
          state.lifecycleStatus === "drifted" ||
          state.lifecycleStatus === "recovery-required"
        ) {
          return state;
        }
        return {
          ...state,
          lifecycleStatus: "pending" as const,
          lifecycleReason: "Library resources changed after the last Apply"
        };
      })
    );
  };

  const refreshTrackedSkillUpdateLocally = (skill: SkillLibraryEntry) => {
    if (skill.updatePolicy !== "tracked") return;
    void window.agentEnv
      .checkSkillLibraryUpdates([skill.id])
      .then((updates) => {
        setSkillUpdates((current) => [
          ...current.filter((item) => item.id !== skill.id),
          ...updates
        ]);
      })
      .catch((unknownError) => {
        setSkillUpdates((current) => [
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
        void loadProfileEnrichment(core, true, shouldApply).catch((unknownError) => {
          if (shouldApply()) {
            setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
          }
        });

        const { profileItems, targetItems, targetStateItems } = core;
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
          usableProfiles.find((profile) => profile.id === activeProfileId) ??
          usableProfiles.find(
            (profile) => !initialTargetId || profile.preferredTargetId === initialTargetId
          ) ??
          usableProfiles[0];
        const initialProfileTargetId =
          initialTargetId ?? initialProfile.preferredTargetId ?? targetItems[0]?.id;
        setSelectedTargetId(initialProfileTargetId);
        setProfileTargetSelections({ [initialProfile.id]: initialProfileTargetId });
        setSelectedProfileId(initialProfile.id);
        setActiveComposerSection(activeProfileId === initialProfile.id ? "skills" : undefined);
        const requestId = ++profileFlowRequestRef.current;
        const profile = await window.agentEnv.readProfile(initialProfile.id);
        if (isMounted && requestId === profileFlowRequestRef.current) {
          setDraftProfile(profile);
          setIsProfileDirty(false);
          setProfileSaveStatus("");
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

  useEffect(() => {
    if (isLoading || !skillSettings.skillAutoCheckEnabled) {
      return undefined;
    }

    const intervalMs =
      Math.max(5, skillSettings.skillAutoCheckIntervalMinutes) * 60 * 1000;
    const timer = window.setInterval(() => {
      refreshProfiles({ checkSkillUpdates: true }).catch((unknownError) => {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isLoading, skillSettings.skillAutoCheckEnabled, skillSettings.skillAutoCheckIntervalMinutes]);

  const selectProfileNow = async (
    profileId: string,
    composerSection?: ComposerSection
  ) => {
    const requestId = ++profileFlowRequestRef.current;
    activeProfileFlowRequestRef.current = requestId;
    const isDifferentProfile = profileId !== selectedProfileId;
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    setRollbackPreview(undefined);
    if (isDifferentProfile) {
      setProfileLoadingId(profileId);
      setProfileSaveStatus("");
    }
    setActiveComposerSection(composerSection);
    setActiveWorkspace("profiles");
    try {
      const profile = await window.agentEnv.readProfile(profileId);
      if (requestId !== profileFlowRequestRef.current) {
        return;
      }
      const profileTargetId = preferredTargetForProfile(
        profile.id,
        profile.manifest.preferredTargetId,
        targetStates,
        targets,
        profileTargetSelections[profile.id]
      );
      setSelectedTargetId(profileTargetId);
      setSelectedProfileId(profileId);
      if (profileTargetId) {
        setProfileTargetSelections((current) => ({
          ...current,
          [profile.id]: profileTargetId
        }));
      }
      setDraftProfile(profile);
      setIsProfileDirty(false);
      setProfileSaveStatus("");
    } catch (unknownError) {
      if (requestId === profileFlowRequestRef.current) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    } finally {
      if (requestId === profileFlowRequestRef.current) {
        activeProfileFlowRequestRef.current = undefined;
        setProfileLoadingId(undefined);
        setBusy(false);
      }
    }
  };

  const guardProfileAction = (
    label: string,
    action: () => void | Promise<void>
  ) => {
    if (!isProfileDirty) {
      void action();
      return;
    }
    pendingProfileActionRef.current = action;
    setPendingProfileAction({ label });
  };

  const selectWorkspace = (workspace: AppWorkspace) => {
    if (workspace === activeWorkspace) {
      return;
    }
    const label = {
      library: "open Skills",
      profiles: "open Profiles",
      targets: "open Agents",
      settings: "open Settings"
    }[workspace];
    guardProfileAction(label, () => {
      libraryScroll.captureScroll();
      if (workspace === "library") {
        setSkillUpdateFeedbackWorkspace("library");
      }
      setActiveWorkspace(workspace);
    });
  };

  const selectProfile = (
    profileId: string,
    composerSection?: ComposerSection
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
      setActiveWorkspace("profiles");
      setActiveComposerSection(composerSection);
      return;
    }
    const profileName = profiles.find((profile) => profile.id === profileId)?.name ?? "profile";
    guardProfileAction(`switch to ${profileName}`, () =>
      selectProfileNow(profileId, composerSection)
    );
  };

  const updateDraftProfile = (profile: ProfileDetail) => {
    invalidateProfileFlow();
    setDraftProfile(profile);
    setIsProfileDirty(true);
    setProfileSaveStatus("Unsaved changes");
    setSkillUpdateCheckStatus(undefined);
    setPreview(undefined);
    setRollbackPreview(undefined);
  };

  const prepareSkillImport = async (
    source: SkillImportPreviewInput
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

    const preferredConflict =
      preview.conflicts.find((conflict) => conflict.sourceUpdateAvailable) ??
      preview.conflicts.find((conflict) => conflict.identical) ??
      preview.conflicts[0];
    setSelectedSkillConflictId(preferredConflict.existing.id);
    setSkillImportAlternateId(preview.suggestedId);
    setSkillImportDecision(preferredConflict.contentIdentical ? "keep-both" : "replace");
    const resolution = await new Promise<SkillImportConflictResolution | undefined>((resolve) => {
      setPendingSkillImport({ preview, resolve });
    });
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

  const acceptProfileMetadata = (saved: ProfileDetail, previousName: string) => {
    const summary: ProfileSummary = {
      id: saved.id,
      preferredTargetId: saved.manifest.preferredTargetId,
      createdFromTargetId: saved.manifest.createdFromTargetId,
      name: saved.manifest.name,
      description: saved.manifest.description,
      createdAt: saved.manifest.createdAt,
      iconKey: saved.manifest.iconKey,
      contentHash: saved.contentHash,
      targetContentHashes: saved.targetContentHashes
    };
    setProfiles((current) =>
      current.map((profile) => profile.id === saved.id ? summary : profile)
    );
    const versions = profileLibraryVersions[saved.id];
    setSkillUsage((current) => reconcileProfileUsage(
      current,
      Object.keys(versions?.skills ?? {}),
      Object.keys(versions?.skills ?? {}),
      previousName,
      saved.manifest.name
    ));
    setTargetStates((current) =>
      current.map((state) =>
        state.activeProfileId === saved.id
          ? { ...state, activeProfileName: saved.manifest.name }
          : state
      )
    );
    setDraftProfile((current) =>
      current?.id === saved.id
        ? {
            ...current,
            manifest: {
              ...current.manifest,
              name: saved.manifest.name,
              description: saved.manifest.description,
              iconKey: saved.manifest.iconKey
            },
            contentHash: saved.contentHash,
            targetContentHashes: saved.targetContentHashes
          }
        : current
    );
    setProfileSaveStatus("Profile details saved");
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

  const saveDraft = async () => {
    if (!draftProfile) {
      return undefined;
    }

    const previousName =
      profiles.find((profile) => profile.id === draftProfile.id)?.name ??
      draftProfile.manifest.name;
    const previousLibraryVersions = profileLibraryVersions[draftProfile.id];
    setIsProfileSaving(true);
    setProfileSaveStatus("Saving profile");
    try {
      const saved = await window.agentEnv.saveProfile(toSaveInput(draftProfile));
      const summary: ProfileSummary = {
        id: saved.id,
        preferredTargetId: saved.manifest.preferredTargetId,
        createdFromTargetId: saved.manifest.createdFromTargetId,
        name: saved.manifest.name,
        description: saved.manifest.description,
        createdAt: saved.manifest.createdAt,
        iconKey: saved.manifest.iconKey,
        contentHash: saved.contentHash,
        targetContentHashes: saved.targetContentHashes
      };
      setProfiles((current) =>
        current.some((profile) => profile.id === saved.id)
          ? current.map((profile) => profile.id === saved.id ? summary : profile)
          : current.concat(summary)
      );
      const preferredTarget = targets.find(
        (target) => target.id === saved.manifest.preferredTargetId
      ) ?? targets[0];
      if (preferredTarget) {
        setProfileResourceCounts((current) => ({
          ...current,
          [saved.id]: summarizeProfile(saved, preferredTarget, librarySkills)
        }));
      }
      setProfileLibraryVersions((current) => ({
        ...current,
        [saved.id]: collectLibraryResourceVersions(
          saved,
          librarySkills,
          preferredTarget?.id
        )
      }));
      setSkillUsage((current) => reconcileProfileUsage(
        current,
        Object.keys(previousLibraryVersions?.skills ?? {}),
        saved.resources.skills.map((reference) => reference.libraryId),
        previousName,
        saved.manifest.name
      ));
      setTargetStates((current) =>
        current.map((state) => {
          if (state.activeProfileId !== saved.id) return state;
          const expectedHash =
            saved.targetContentHashes?.[state.targetId];
          const contentChanged =
            !expectedHash || expectedHash !== state.appliedProfileHash;
          return {
            ...state,
            activeProfileName: saved.manifest.name,
            ...(contentChanged &&
            state.lifecycleStatus !== "drifted" &&
            state.lifecycleStatus !== "recovery-required"
              ? {
                  lifecycleStatus: "pending" as const,
                  lifecycleReason: "Saved Profile changed after the last Apply"
                }
              : {})
          };
        })
      );
      setDraftProfile(saved);
      setIsProfileDirty(false);
      setProfileSaveStatus("Profile saved");
      setSkillUpdateCheckStatus(undefined);
      return saved;
    } catch (error) {
      setProfileSaveStatus("");
      throw error;
    } finally {
      setIsProfileSaving(false);
    }
  };

  const saveSelectedProfile = async () => {
    if (saveInFlightRef.current) {
      return;
    }
    saveInFlightRef.current = true;
    setError(undefined);
    try {
      await saveDraft();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      saveInFlightRef.current = false;
    }
  };

  useDesktopShortcuts({
    activeWorkspace,
    isProfileSaving,
    onSaveProfile: saveSelectedProfile,
    onRefreshSkills: refreshSkills,
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
    setProfileCaptureActivity("idle");
    setTargetCapturePreview(undefined);
    setProfileCaptureError("");
    setProfileFormError("");
    setProfileDialogMode("create");
    setActiveWorkspace("profiles");
    setIsProfileActionsOpen(false);
  };

  const openCreateProfileDialog = () => {
    guardProfileAction("create a new profile", openCreateProfileDialogNow);
  };

  const openCreateFromTargetDialogNow = (targetId: string) => {
    const target = targets.find((item) => item.id === targetId);
    setProfileForm({
      targetId,
      name: target ? `${target.name} Current` : "Current Environment",
      description: ""
    });
    setProfileCreateSource("target");
    setProfileCaptureOrigin("targets");
    setProfileCaptureActivity("idle");
    setTargetCapturePreview(undefined);
    setProfileCaptureError("");
    setProfileFormError("");
    setProfileDialogMode("create");
  };

  const openCreateFromTargetDialog = (targetId: string) => {
    const targetName = targets.find((item) => item.id === targetId)?.name ?? "Agent";
    guardProfileAction(`create a profile from ${targetName}`, () => openCreateFromTargetDialogNow(targetId));
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
      const captured = await window.agentEnv.previewCreateProfileFromTarget(profileForm.targetId);
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
        setSelectedProfileId(saved.id);
        setDraftProfile(saved);
        if (profileCreateSource === "target") {
          setProfileCaptureStatus(t("{{name}} created. Agent unchanged.", { name: saved.manifest.name }));
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
      setActiveWorkspace("profiles");
      setProfileDialogMode(undefined);
      setTargetCapturePreview(undefined);
      setPreview(undefined);
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
      setSelectedProfileId(saved.id);
      setDraftProfile(saved);
      setActiveComposerSection(undefined);
      setPreview(undefined);
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
          setSelectedProfileId(nextProfile.id);
          setSelectedTargetId(nextProfile.preferredTargetId ?? deletedTargetId);
          setProfileTargetSelections((current) => ({
            ...current,
            ...(nextProfile.preferredTargetId
              ? { [nextProfile.id]: nextProfile.preferredTargetId }
              : {})
          }));
          setDraftProfile(nextDetail);
        } else {
          setSelectedProfileId(undefined);
          setDraftProfile(undefined);
        }
      }
      setDeleteProfileCandidateId(undefined);
      setIsProfileActionsOpen(false);
      setPreview(undefined);
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

  const cancelPendingProfileAction = () => {
    if (pendingWindowCloseRef.current) {
      pendingWindowCloseRef.current = false;
      window.agentEnv.cancelWindowClose();
    }
    pendingProfileActionRef.current = null;
    setPendingProfileAction(undefined);
  };

  const closeProfileDialog = () => {
    setProfileDialogMode(undefined);
    setDeleteProfileCandidateId(undefined);
    setPreview(undefined);
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
      Boolean(pendingSkillImport?.committing) || (busy && !pendingSkillImport),
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
    setPreview(undefined);
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

  const openProfilesForSharedSkill = () => {
    guardProfileAction("open Profiles", () => {
      setSkillLibraryTool(undefined);
      setActiveComposerSection("skills");
      setActiveWorkspace("profiles");
    });
  };

  const continuePendingProfileAction = async (saveFirst: boolean) => {
    const action = pendingProfileActionRef.current;
    if (!action) {
      setPendingProfileAction(undefined);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      if (saveFirst) {
        await saveDraft();
      } else {
        setIsProfileDirty(false);
        setProfileSaveStatus("");
      }
      pendingProfileActionRef.current = null;
      pendingWindowCloseRef.current = false;
      setPendingProfileAction(undefined);
      await action();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    isProfileDirtyRef.current = isProfileDirty;
    window.agentEnv.setWindowCloseGuard(isProfileDirty);
  }, [isProfileDirty]);

  useEffect(
    () =>
      window.agentEnv.onWindowCloseRequested(() => {
        if (!isProfileDirtyRef.current) {
          window.agentEnv.confirmWindowClose();
          return;
        }
        pendingWindowCloseRef.current = true;
        pendingProfileActionRef.current = () => window.agentEnv.confirmWindowClose();
        setPendingProfileAction({ label: "close AgentEnv Manager" });
      }),
    []
  );

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
        .filter((target) => target.lifecycleStatus === "applied")
        .reduce<Record<string, PreparedSkillTarget[]>>((bySkill, target) => {
          for (const preparation of target.sharedSkillPreparations ?? []) {
            bySkill[preparation.skillKey] = [
              ...(bySkill[preparation.skillKey] ?? []),
              {
                targetId: target.targetId,
                targetName: preparation.targetName,
                disposition: preparation.disposition
              }
            ];
          }
          return bySkill;
        }, {}),
    [targetStates]
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
    managed: boolean
  ) => {
    if (!draftProfile || !selectedTargetId) return;
    updateDraftProfile({
      ...draftProfile,
      resources: setProfileResourceMode(
        draftProfile.resources ?? emptyProfileResources,
        selectedTargetId,
        resource,
        managed ? "manage" : "ignore"
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
                  draftProfile,
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
  const previewRequiresBackupReview =
    preview?.issues.some((issue) => issue.disposition === "review") === true;
  const canApply = Boolean(
    preview &&
      (preview.changes.length > 0 ||
        preview.resourceChanges.length > 0 ||
        preview.sharedSkillPreparationChanged ||
        preview.targetStateChanged) &&
      !previewHasBlockingIssues &&
      localValidationErrors.length === 0 &&
      !rollbackPreview &&
      (selectedTarget?.health.canWrite ?? false)
  );

  const previewSelectedProfile = async () => {
    setError(undefined);
    setRollbackPreview(undefined);
    if (!draftProfile) {
      return;
    }
    if (isProfileDirty) {
      setProfileSaveStatus("Save this profile before previewing changes");
      setSkillUpdateCheckStatus(undefined);
      saveButtonRef.current?.focus();
      return;
    }

    const requestId = ++profileFlowRequestRef.current;
    activeProfileFlowRequestRef.current = requestId;
    setIsProfilePreviewing(true);
    setBusy(true);
    try {
      const nextPreview = await window.agentEnv.previewApply(
        draftProfile.id,
        selectedTarget?.id
      );
      if (requestId !== profileFlowRequestRef.current) {
        return;
      }
      const rendererBlockers: ApplyIssue[] = [
        ...(!selectedTarget?.health.canWrite
          ? [{
              id: `target-unavailable:${selectedTarget?.id ?? "unknown"}`,
              code: "target-unavailable" as const,
              disposition: "block" as const,
              resolution: "external-action" as const,
              resourceKind: "target" as const,
              resourceId: selectedTarget?.id,
              message:
                selectedTarget?.health.summary || `${selectedTarget?.name ?? "Agent"} is unavailable`
            }]
          : []),
        ...localValidationErrors.map((message, index) => ({
          id: `profile-validation:${index}`,
          code: "profile-validation" as const,
          disposition: "block" as const,
          resolution: "edit-profile" as const,
          resourceKind: "profile" as const,
          message
        }))
      ];
      setPreview({
        ...nextPreview,
        issues: [...rendererBlockers, ...nextPreview.issues]
      });
    } catch (unknownError) {
      if (requestId === profileFlowRequestRef.current) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    } finally {
      if (requestId === profileFlowRequestRef.current) {
        activeProfileFlowRequestRef.current = undefined;
        setIsProfilePreviewing(false);
        setBusy(false);
      }
    }
  };

  const runReadinessRemediation = () => {
    if (readiness.remediationLabel === "Open Agents") {
      setActiveWorkspace("targets");
      return;
    }
    if (readiness.remediationLabel === "Save now") {
      void saveSelectedProfile();
      return;
    }
    if (readiness.remediationLabel === "Open Recovery") {
      setActiveWorkspace("settings");
      setBackupManagerOpen(true);
    }
  };

  const toggleComposerSection = (section: ComposerSection) => {
    setActiveComposerSection((current) => current === section ? undefined : section);
  };

  const applySelectedProfile = async () => {
    if (!draftProfile || !preview) {
      return;
    }

    setBusy(true);
    setIsProfileApplying(true);
    setError(undefined);
    setProfileSaveStatus("");
    try {
      const result = await window.agentEnv.applyProfile(draftProfile.id, preview.id);
      if (!result.ok) {
        if (result.kind === "stale") {
          setProfileSaveStatus("The Agent changed while Preview was open. Preview refreshed.");
          const refreshedPreview = await window.agentEnv.previewApply(
            draftProfile.id,
            preview.targetId
          );
          setPreview(refreshedPreview);
          return;
        }
        if (result.kind === "busy") {
          setProfileSaveStatus("Another AgentEnv operation is still running. Try Apply again shortly.");
          return;
        }
        if (result.kind === "no-op") {
          setPreview(undefined);
          setProfileSaveStatus("This Agent already matches the Profile.");
          return;
        }
        setError(result.errors.join("\n"));
        return;
      }
      const appliedAt = new Date().toISOString();
      setTargetStates((current) => {
        const appliedState: TargetManagementState = {
          targetId: preview.targetId,
          activeProfileId: draftProfile.id,
          activeProfileName: draftProfile.manifest.name,
          appliedProfileHash: preview.profileContentHash,
          appliedLibraryVersions: preview.libraryVersions,
          status: "managed",
          lifecycleStatus: "applied",
          lastAppliedAt: appliedAt,
          managedResourceCount: preview.effectivePayload?.total ??
            preview.changes.length + preview.resourceChanges.length,
          sharedSkillPreparations: preview.sharedSkillPreparations ?? [],
          warningCount: preview.issues.filter((issue) => issue.disposition === "notice").length,
          errorCount: 0
        };
        return current.some((state) => state.targetId === preview.targetId)
          ? current.map((state) => state.targetId === preview.targetId ? appliedState : state)
          : current.concat(appliedState);
      });
      setPreview(undefined);
      setRollbackPreview(undefined);
      void window.agentEnv.listBackups().then(setBackups).catch(() => undefined);
      const appliedProfileHash = preview.profileContentHash;
      void window.agentEnv
        .listTargetStates()
        .then((refreshedStates) => {
          setTargetStates((current) =>
            current.find((state) => state.targetId === preview.targetId)?.appliedProfileHash ===
            appliedProfileHash
              ? refreshedStates
              : current
          );
        })
        .catch(() => undefined);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setIsProfileApplying(false);
      setBusy(false);
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
      setDraftProfile(result.profile);
      setIsProfileDirty(false);
      setPreview(undefined);
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
    setPreview(undefined);
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

  const importUnmanagedSkill = async (sourcePath: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const prepared = await prepareSkillImport({ kind: "local", input: { sourcePath } });
      if (!prepared || prepared.kind !== "local") return false;
      const result = await window.agentEnv.importSkillToLibrary(prepared.input);
      setPendingSkillImport(undefined);
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles();
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
      return true;
    } catch (unknownError) {
      setPendingSkillImport(undefined);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const importExternalSkill = async (skill: SkillInventoryEntry) => {
    if (
      !isExternalSkillImportable(skill.externalOwnership)
    ) {
      setError(`${skill.name} is managed by ${skill.externalOwnership?.displayName ?? "another tool"} and cannot be imported from this runtime copy.`);
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
          upstream: skill.externalOwnership?.upstream,
          provenance: {
            importedVia: "local-scan",
            externalManager: "skills-cli",
            externalLockPath: skill.externalOwnership?.lockPath
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

  const updateLibrarySkill = async (plan: SkillUpdatePlan) => {
    if (!plan.previewId) {
      setError("Skill update preview is unavailable; review the update again");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const updated = await window.agentEnv.updateLibrarySkill({
        id: plan.id,
        previewId: plan.previewId
      });
      setSelectedSkillUpdatePlan(undefined);
      applyLibraryContentUpdatesLocally([updated]);
      await refreshSkillSourceGroups();
      setSkillUpdateCheckStatus(
        summarizeSkillUpdateResult(
          plan.id,
          skillUpdates.filter((item) => item.id !== plan.id),
          t
        )
      );
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
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
      setActiveWorkspace("profiles");
    }
  };

  const updateAllLibrarySkills = async (plans: SkillUpdatePlan[]) => {
    const applicablePlans = plans.filter((plan) => Boolean(plan.previewId));
    if (applicablePlans.length === 0) {
      return;
    }

    setBusy(true);
    setError(undefined);
    setBulkSkillUpdatePlans(undefined);
    try {
      const results: PromiseSettledResult<SkillLibraryEntry>[] = [];
      for (const plan of applicablePlans) {
        try {
          results.push({
            status: "fulfilled",
            value: await window.agentEnv.updateLibrarySkill({
              id: plan.id,
              previewId: plan.previewId!
            })
          });
        } catch (reason) {
          results.push({ status: "rejected", reason });
        }
      }
      const failures = results.filter((result): result is PromiseRejectedResult =>
        result.status === "rejected"
      );
      const updatedSkills = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      setSelectedSkillUpdatePlan(undefined);
      applyLibraryContentUpdatesLocally(updatedSkills);
      await refreshSkillSourceGroups();
      const updatedIds = new Set(updatedSkills.map((skill) => skill.id));
      const remainingUpdates = skillUpdates.filter(
        (update) =>
          !updatedIds.has(update.id) && update.updateAvailable && !update.error
      ).length;
      if (failures.length === 0) {
        setSkillUpdateCheckStatus({
          state: "success",
          message:
            remainingUpdates > 0
              ? `Updated ${plural(applicablePlans.length, "skill")} · More updates remain`
              : `Updated ${plural(applicablePlans.length, "skill")} · All tracked skills are up to date`
        });
      }
      if (failures.length > 0) {
        setSkillUpdateCheckStatus({
          state: "error",
          message: `${plural(failures.length, "update")} failed`
        });
        setError(
          failures
            .map((failure) =>
              failure.reason instanceof Error ? failure.reason.message : String(failure.reason)
            )
            .join("\n")
        );
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
    setBusy(true);
    setError(undefined);
    setSkillUpdateCheckStatus({ state: "checking", message: "Preparing update review..." });
    try {
      const plans = await Promise.all(
        ids.map((id) => window.agentEnv.previewLibrarySkillUpdate(id))
      );
      setBulkSkillUpdatePlans(plans);
      setSkillUpdateCheckStatus(undefined);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSkillUpdateCheckStatus(undefined);
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError(undefined);
    setProfileSaveStatus("");
    setSkillUpdateCheckStatus({ state: "checking", message: "Checking library updates..." });
    try {
      const { skillUpdateItems } = await refreshProfiles({ forceSkillUpdateCheck: true });
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
      setBusy(false);
    }
  };

  const checkProfileSkillUpdates = async (ids: string[]) => {
    if (checkingProfileSkillUpdates || ids.length === 0) {
      return;
    }
    setCheckingProfileSkillUpdates(true);
    setError(undefined);
    setSkillUpdateFeedbackWorkspace("profiles");
    setSkillUpdateCheckStatus({ state: "checking", message: "Checking profile skills..." });
    try {
      const updates = await window.agentEnv.checkSkillLibraryUpdates(ids);
      const selectedIds = new Set(ids);
      setSkillUpdates((current) => [
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

  const refreshSkillDiscoveries = async (announce = true) => {
    setBusy(true);
    setSkillInventoryRefreshing(true);
    setError(undefined);
    if (announce) {
      setSkillUpdateCheckStatus({ state: "checking", message: "Refreshing local skills..." });
    }
    try {
      const inventory = await window.agentEnv.scanSkillInventory();
      setSkillInventory(inventory);
      if (announce) {
        setSkillUpdateCheckStatus({ state: "success", message: "Local skills refreshed" });
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      if (announce) {
        setSkillUpdateCheckStatus({ state: "error", message: "Local skill refresh failed" });
      }
    } finally {
      setSkillInventoryRefreshing(false);
      setBusy(false);
    }
  };

  const openSkillDiscoveries = async () => {
    setSkillLibraryTool("discoveries");
    await refreshSkillDiscoveries(false);
  };

  const ignoreSkillGroup = async (skillKey: string) => {
    setBusy(true);
    setError(undefined);
    setProfileSaveStatus("");
    setSkillUpdateCheckStatus({
      state: "checking",
      message: `Ignoring ${skillKey}...`
    });
    try {
      await window.agentEnv.ignoreSkillGroup(skillKey);
      setSkillInventory(await window.agentEnv.scanSkillInventory());
      setSkillUpdateCheckStatus({
        state: "success",
        message: `Ignored ${skillKey}`
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setSkillUpdateCheckStatus({ state: "error", message: "Ignore failed" });
    } finally {
      setBusy(false);
    }
  };

  const unignoreSkillGroup = async (skillKey: string) => {
    setBusy(true);
    setError(undefined);
    setProfileSaveStatus("");
    setSkillUpdateCheckStatus({
      state: "checking",
      message: `Restoring ${skillKey}...`
    });
    try {
      await window.agentEnv.unignoreSkillGroup(skillKey);
      setSkillInventory(await window.agentEnv.scanSkillInventory());
      setSkillUpdateCheckStatus({
        state: "success",
        message: `Restored ${skillKey}`
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setSkillUpdateCheckStatus({ state: "error", message: "Restore failed" });
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

  const scanGitHubSkills = (url: string): Promise<GitHubSkillScanResult> =>
    window.agentEnv.scanGitHubSkills(url);

  const scanRepositorySkills = (
    input: RepositorySkillSourceInput
  ): Promise<RepositorySkillScanResult> => window.agentEnv.scanRepositorySkills(input);

  const syncSkillUpdatesFromSourceGroups = (groups: SkillSourceGroupView[]) => {
    const skillsById = new Map(librarySkills.map((skill) => [skill.id, skill]));
    const sourceUpdates = new Map<string, SkillUpdateInfo>();
    for (const candidate of groups.flatMap((group) => group.candidates)) {
      if (!candidate.libraryId || candidate.state === "unchecked") continue;
      const skill = skillsById.get(candidate.libraryId);
      if (!skill || skill.globallyEnabled === false || skill.updatePolicy !== "tracked") continue;
      const fallbackError = candidate.state === "removed"
        ? t("Removed upstream")
        : t("Source check failed");
      const error = ["invalid", "removed", "conflict", "missing"].includes(candidate.state)
        ? candidate.detail ?? fallbackError
        : undefined;
      sourceUpdates.set(skill.id, {
        id: skill.id,
        name: skill.name,
        sourceType: skill.sourceType,
        currentRevision: skill.remoteRevision ?? skill.contentHash,
        latestRevision: candidate.contentRevision,
        latestUpdatedAt: candidate.upstreamUpdatedAt,
        updateAvailable: candidate.state === "update",
        error
      });
    }
    if (sourceUpdates.size === 0) return;
    setSkillUpdates((current) => [
      ...current.filter((update) => !sourceUpdates.has(update.id)),
      ...sourceUpdates.values()
    ]);
  };

  const checkSkillSourceGroup = async (sourceId: string) => {
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
    }
  };

  const checkAllSkillSourceGroups = async () => {
    setError(undefined);
    setSkillUpdateFeedbackWorkspace("library");
    setSkillUpdateCheckStatus({ state: "checking", message: t("Checking all sources...") });
    try {
      const result = await window.agentEnv.checkAllSkillSourceGroups();
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
      const changes = result.groups.reduce(
        (count, group) => count + group.counts.updates + group.counts.new + group.counts.removed,
        0
      );
      setSkillUpdateCheckStatus({
        state: "success",
        message: changes > 0
          ? t("Checked {{sources}} sources · {{changes}} changes", {
              sources: result.checked,
              changes
            })
          : t("All sources are current")
      });
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setSkillUpdateCheckStatus({ state: "error", message: t("Source checks failed") });
      setError(message);
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
    onProgress?: (progress: GitHubSkillImportProgress) => void
  ): Promise<GitHubSkillImportResult> => {
    setBusy(true);
    setError(undefined);
    try {
      const result: GitHubSkillImportResult = { imported: [], failed: [] };
      let updatedSourceCount = 0;
      for (const input of inputs) {
        try {
          onProgress?.({ sourceUrl: input.url, status: "reviewing" });
          const prepared = await prepareSkillImport({ kind: "github", input });
          if (!prepared || prepared.kind !== "github") {
            onProgress?.({ sourceUrl: input.url, status: "skipped" });
            continue;
          }
          if (prepared.input.conflictResolution?.action === "update-source") {
            updatedSourceCount += 1;
          }
          onProgress?.({ sourceUrl: input.url, status: "importing" });
          const imported = await window.agentEnv.importGitHubSkillToLibrary(prepared.input);
          result.imported.push(imported);
          onProgress?.({ sourceUrl: input.url, status: "imported" });
          setPendingSkillImport(undefined);
        } catch (importError) {
          setPendingSkillImport(undefined);
          const message = importError instanceof Error ? importError.message : String(importError);
          result.failed.push({
            id: input.id ?? "skill",
            sourceUrl: input.url,
            error: message
          });
          onProgress?.({ sourceUrl: input.url, status: "failed", error: message });
        }
      }
      setSelectedSkillUpdatePlan(undefined);
      try {
        await refreshProfiles({ checkSkillUpdates: false });
        await refreshSkillSourceGroups();
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
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
    onProgress?: (progress: GitHubSkillImportProgress) => void
  ): Promise<RepositorySkillImportResult> => {
    setBusy(true);
    setError(undefined);
    try {
      const result: RepositorySkillImportResult = { imported: [], failed: [] };
      let updatedSourceCount = 0;
      for (const input of inputs) {
        const sourceUrl = repositoryImportProgressKey(input);
        try {
          onProgress?.({ sourceUrl, status: "reviewing" });
          const prepared = await prepareSkillImport({ kind: "repository", input });
          if (!prepared || prepared.kind !== "repository") {
            onProgress?.({ sourceUrl, status: "skipped" });
            continue;
          }
          if (prepared.input.conflictResolution?.action === "update-source") {
            updatedSourceCount += 1;
          }
          onProgress?.({ sourceUrl, status: "importing" });
          const imported = await window.agentEnv.importRepositorySkillToLibrary(prepared.input);
          result.imported.push(imported);
          onProgress?.({ sourceUrl, status: "imported" });
          setPendingSkillImport(undefined);
        } catch (importError) {
          setPendingSkillImport(undefined);
          const message = importError instanceof Error ? importError.message : String(importError);
          result.failed.push({
            id: input.id ?? "skill",
            repository: input.repository,
            ref: input.ref,
            directory: input.directory,
            error: message
          });
          onProgress?.({ sourceUrl, status: "failed", error: message });
        }
      }
      setSelectedSkillUpdatePlan(undefined);
      try {
        await refreshProfiles({ checkSkillUpdates: false });
        await refreshSkillSourceGroups();
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
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
      return;
    }
    setBusy(true);
    setError(undefined);
    setSkillCleanupResult(undefined);
    setSkillUpdateCheckStatus({
      state: "checking",
      message: `Managing ${plural(inputs.length, "skill")}...`
    });
    const completed: SkillCleanupResult[] = [];
    const failures: string[] = [];
    for (const input of inputs) {
      try {
        completed.push(await window.agentEnv.consolidateSkillGroup(input));
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

  const setSkillUpdateSource = async (input: SkillUpdateSourceInput) => {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await window.agentEnv.setSkillUpdateSource(input);
      replaceLibrarySkillLocally(updated, { invalidateUpdateCheck: true });
      refreshTrackedSkillUpdateLocally(updated);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const setSkillUpdatePolicy = async (input: SkillUpdatePolicyInput) => {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await window.agentEnv.setSkillUpdatePolicy(input);
      replaceLibrarySkillLocally(updated, { invalidateUpdateCheck: true });
      refreshTrackedSkillUpdateLocally(updated);
      setSkillUpdateCheckStatus({
        state: "success",
        message:
          input.policy === "tracked"
            ? `Tracking updates for ${input.id}`
            : `Update tracking disabled for ${input.id}`
      });
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
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
    setBusy(true);
    setError(undefined);
    setProfileSaveStatus("");
    setSelectedSkillUpdatePlan(undefined);
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
      setBusy(false);
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
      if ("backupRetentionDays" in input) await refreshManagedBackups();
      if ("enabledTargetIds" in input) {
        setPreview(undefined);
        setRollbackPreview(undefined);
        await refreshProfiles({
          checkSkillUpdates: false,
          forceTargetRefresh: true,
          settingsOverride: nextSettings
        });
      }
      setSettingsSaveStatus("Settings saved");
    } catch (unknownError) {
      setSettingsSaveStatus("");
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
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

  const openBackupManager = () => {
    backupManagerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBackupDeleteCandidate(undefined);
    setBackupCleanupConfirm(false);
    setBackupManagerNotice(undefined);
    setBackupManagerOpen(true);
    void refreshManagedBackups();
  };

  const closeBackupManager = () => {
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
      await refreshManagedBackups();
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
      await refreshManagedBackups();
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
      setSelectedProfileId(undefined);
      setDraftProfile(undefined);
      const refreshed = await refreshProfiles();
      const firstProfile = refreshed.profileItems.find((profile) => !profile.loadError);
      if (firstProfile) {
        setSelectedProfileId(firstProfile.id);
        setSelectedTargetId(firstProfile.preferredTargetId ?? targets[0]?.id);
        setDraftProfile(await window.agentEnv.readProfile(firstProfile.id));
      }
      setDataBackupStatus(`AgentEnv data restored; safety backup created at ${result.safetyBackupPath}`);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const refreshTargets = async () => {
    setBusy(true);
    setError(undefined);
    setTargetRefreshStatus("refreshing");
    try {
      await refreshProfiles({ forceTargetRefresh: true });
      setTargetRefreshStatus("refreshed");
    } catch (unknownError) {
      setTargetRefreshStatus(undefined);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

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
    setSettingsSaveStatus("");
    setTargetRefreshStatus(undefined);
    setSkillRefreshStatus(undefined);
    setSkillCleanupResult(undefined);
    setProfileCaptureStatus("");
  };
  const openGitHubConnectionSettings = () => {
    setError(undefined);
    setSkillUpdateCheckStatus(undefined);
    setActiveWorkspace("settings");
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
          : error,
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
                ? t("Replaced shared copy for {{id}}", { id: skillCleanupResult.libraryId })
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
            title: profileSaveStatus
          }
        : dataBackupStatus && activeWorkspace === "settings"
          ? {
              kind: dataBackupStatus === "Creating data export" ? "loading" : "success",
              title: dataBackupStatus
            }
        : settingsSaveStatus && activeWorkspace === "settings"
          ? {
              kind: settingsSaveStatus === "Settings saved" ? "success" : "loading",
              title: settingsSaveStatus
            }
        : undefined;
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
        <div className="profile-target-menu ui-action-menu" role="menu" aria-label={t("Apply Agents")}>
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
        </div>
      ) : null}
    </div>
  );

  const selectedSkillImportConflict = pendingSkillImport?.preview.conflicts.find(
    (conflict) => conflict.existing.id === selectedSkillConflictId
  ) ?? pendingSkillImport?.preview.conflicts[0];
  const alternateSkillIdValid = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(skillImportAlternateId) &&
    !pendingSkillImport?.preview.conflicts.some(
      (conflict) => conflict.existing.id === skillImportAlternateId
    );

  return (
    <main
      className={`app-shell${activeWorkspace === "library" ? " app-shell--library" : ""}${
        activeWorkspace === "profiles" ? " app-shell--profiles" : ""
      }`}
    >
      <ProfileSidebar
        targets={targets}
        profiles={profiles}
        isLoading={isLoading}
        activeWorkspace={activeWorkspace}
        onWorkspaceSelect={selectWorkspace}
      />

      <section
        className="editor-panel"
        aria-label={
          activeWorkspace === "library"
            ? t("Library workspace")
            : activeWorkspace === "profiles"
              ? t("Profile editor")
              : t("{{name}} workspace", { name: activeWorkspace })
        }
      >
        <div className="window-drag-strip" aria-hidden="true" />
        <AppFeedback feedback={appFeedback} onDismiss={dismissAppFeedback} />
        {activeWorkspace === "library" ? (
          <>
            <PageHeader
              className="page-header library-page-header"
              title={t("Skills")}
              help={
                <InfoTip
                  label={t(
                    "Library stores canonical Skills that Profiles can reuse without duplicating files."
                  )}
                />
              }
              actions={
                <ControlGroup
                  className="page-actions"
                  aria-label={t("Library actions")}
                >
                  <Button
                    className="primary-inline-action"
                    size="prominent"
                    variant="primary"
                    aria-label={t("Import skills")}
                    icon={<Plus size={16} strokeWidth={2.4} />}
                    onClick={() => setSkillLibraryTool("import")}
                  >
                    {t("Import")}
                  </Button>
                  <Button
                    className="secondary-action"
                    size="prominent"
                    icon={<ScanLine size={15} strokeWidth={2.2} />}
                    onClick={() => {
                      void openSkillDiscoveries();
                    }}
                  >
                    {t("Scan local")}
                  </Button>
                  <Button
                    className="secondary-action"
                    size="prominent"
                    aria-label={t(skillLibraryMode === "sources" ? "Refresh sources" : "Refresh skills")}
                    disabled={skillRefreshStatus === "refreshing" || skillSourceGroupsLoading}
                    icon={(
                      <RefreshCw
                        className={
                          skillRefreshStatus === "refreshing" || skillSourceGroupsLoading
                            ? "is-spinning"
                            : ""
                        }
                        size={15}
                        strokeWidth={2.2}
                      />
                    )}
                    onClick={() => {
                      if (skillLibraryMode === "sources") {
                        void refreshSkillSourceGroups();
                      } else {
                        void refreshSkills();
                      }
                    }}
                  >
                    {t("Refresh")}
                  </Button>
                </ControlGroup>
              }
            />
            <SkillLibraryPanel
                isLoading={isLoading}
                isBusy={busy}
                librarySkills={librarySkills}
                sourceGroups={skillSourceGroups}
                sourceGroupsLoading={skillSourceGroupsLoading}
                libraryMode={skillLibraryMode}
                skillUpdates={skillUpdates}
                skillInventory={skillInventory}
                cleanupBackups={skillCleanupBackups}
                selectedUpdatePlan={selectedSkillUpdatePlan}
                bulkUpdatePlans={bulkSkillUpdatePlans}
                skillUsage={skillUsage}
                installedTargetIds={targets
                  .filter((target) => isTargetInstalled(target.health))
                  .map((target) => target.id)}
                targetNames={targetNames}
                preparedTargetsBySkill={preparedSkillTargetsBySkill}
                activeTool={skillLibraryTool}
                isRefreshingInventory={skillInventoryRefreshing}
                onCloseTool={() => setSkillLibraryTool(undefined)}
                onRefreshInventory={refreshSkillDiscoveries}
                onSelectLocalSkillFolder={() => window.agentEnv.selectSkillFolder()}
                onImportUnmanaged={importUnmanagedSkill}
                onImportExternal={importExternalSkill}
                onScanGitHubSkills={scanGitHubSkills}
                onImportGitHubSkills={importGitHubSkills}
                onScanRepositorySkills={scanRepositorySkills}
                onImportRepositorySkills={importRepositorySkills}
                onLibraryModeChange={setSkillLibraryMode}
                onCheckSourceGroup={checkSkillSourceGroup}
                onCheckAllSourceGroups={checkAllSkillSourceGroups}
                onSetSourceName={setSkillSourceName}
                onPreviewSourceMerge={previewSkillSourceMerge}
                onMergeSources={mergeSkillSources}
                onCancelRepositoryOperations={() => window.agentEnv.cancelRepositoryOperations()}
                onManageTargetSkill={manageTargetSkill}
                onConsolidateSkillGroup={consolidateSkillGroup}
                onAutoConsolidateSkillGroups={autoConsolidateSkillGroups}
                onSetUpdateSource={setSkillUpdateSource}
                onSetUpdatePolicy={(input) => void setSkillUpdatePolicy(input)}
                onSetAvailability={setSkillAvailability}
                onSetIcon={(input) => void setSkillIcon(input)}
                onPreviewLibrarySkillUpdate={previewLibrarySkillUpdate}
                onCloseUpdatePreview={() => setSelectedSkillUpdatePlan(undefined)}
                onUpdateLibrarySkill={updateLibrarySkill}
                onUpdateAllLibrarySkills={updateAllLibrarySkills}
                onPreviewAllLibrarySkillUpdates={(ids) => void previewAllLibrarySkillUpdates(ids)}
                onCloseBulkUpdatePreview={() => setBulkSkillUpdatePlans(undefined)}
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
                onIgnoreSkillGroup={(skillKey) => {
                  void ignoreSkillGroup(skillKey);
                }}
                onUnignoreSkillGroup={(skillKey) => {
                  void unignoreSkillGroup(skillKey);
                }}
                onSetSharedSkillRetention={setSharedSkillRetention}
                onRetireSharedSkill={retireSharedSkill}
                onOpenProfiles={openProfilesForSharedSkill}
                importConflictOpen={Boolean(pendingSkillImport)}
                onRestoreCleanup={(backupId) => void undoSkillCleanup(backupId)}
                updateCheckStatus={skillUpdateCheckStatus}
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
              description={t("Compose reusable environments and apply them safely to local Agents.")}
              actions={(
                <div className="profile-page-actions" ref={profilePageActionsRef}>
                  <Button
                    className={`profile-new-button${profiles.length === 0 ? " is-primary" : ""}`}
                    size="prominent"
                    variant={profiles.length === 0 ? "primary" : "secondary"}
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
                profileResourceCounts={profileResourceCounts}
                profileLibraryVersions={profileLibraryVersions}
                targets={targets}
                targetStates={targetStates}
                actionsDisabled={busy}
                onDelete={openDeleteProfileDialog}
                onDuplicate={duplicateProfile}
                onSearchChange={setProfileSearch}
                onSelect={selectProfile}
                onIconChange={changeProfileIcon}
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
                        <FolderKanban size={19} strokeWidth={2.1} />
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
                        iconKey={draftProfile.manifest.iconKey ?? "folder"}
                        label={draftProfile.manifest.name}
                        triggerLabel={t("Change icon for profile {{id}}", { id: draftProfile.id })}
                        onChange={(iconKey) => {
                          if (iconKey) changeProfileIcon(draftProfile.id, iconKey);
                        }}
                      />
                      <div className="profile-hero__body">
                        <div className="profile-hero__title">
                          <h2 title={draftProfile.manifest.name}>{draftProfile.manifest.name}</h2>
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
                        <div className="profile-hero__meta">
                          {draftProfile.manifest.preferredTargetId ? (
                            <span className="native-target-pill">
                              {t("Preferred: {{name}}", {
                                name: targets.find(
                                  (target) => target.id === draftProfile.manifest.preferredTargetId
                                )?.name ?? draftProfile.manifest.preferredTargetId
                              })}
                            </span>
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
                              onDuplicate={() => duplicateProfile()}
                              onDelete={() => {
                                setIsProfileActionsOpen(false);
                                openDeleteProfileDialog();
                              }}
                            />
                          ) : null}
                        </div>
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
                    </header>
                    <section
                      className="profile-composer"
                      aria-label={t("Profile composer")}
                    >
                      <ProfileComposerSection
                        id="instructions"
                        icon={<BookOpenText size={18} strokeWidth={2.2} />}
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
                        managed={Boolean(
                          profileTarget?.capabilities.instructions &&
                          resourceSummary?.instructions.managed
                        )}
                        managementDisabled={!profileTarget?.capabilities.instructions}
                        managementLabel={t("Manage Instructions for {{name}}", {
                          name: activeTargetName
                        })}
                        managementStatus={
                          profileTarget?.capabilities.instructions
                            ? undefined
                            : t("Agent controlled")
                        }
                        expanded={activeComposerSection === "instructions"}
                        onToggle={() => toggleComposerSection("instructions")}
                        onManagementChange={(managed) =>
                          updateSelectedResourceManagement("instructions", managed)
                        }
                      >
                        <AgentsEditor
                          label={
                            profileTarget?.instructionsLabel ??
                            t("Instructions")
                          }
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
                        icon={<Database size={18} strokeWidth={2.2} />}
                        title={t("Skills")}
                        description={t("Reusable skills and workflows")}
                        count={resourceSummary?.skills.total ?? 0}
                        enabledCount={resourceSummary?.skills.count ?? 0}
                        chipNames={resourceSummary?.skills.names ?? []}
                        managed={Boolean(
                          profileTarget?.capabilities.skills && resourceSummary?.skills.managed
                        )}
                        managementDisabled={!profileTarget?.capabilities.skills}
                        managementLabel={t("Manage Skills for {{name}}", {
                          name: activeTargetName
                        })}
                        managementStatus={
                          profileTarget?.capabilities.skills
                            ? undefined
                            : t("Agent controlled")
                        }
                        expanded={activeComposerSection === "skills"}
                        onToggle={() => toggleComposerSection("skills")}
                        onManagementChange={(managed) =>
                          updateSelectedResourceManagement("skills", managed)
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
                        icon={<Network size={18} strokeWidth={2.2} />}
                        title={t("MCPs")}
                        description={t(
                          "External tools and service connections"
                        )}
                        count={resourceSummary?.mcp.total ?? 0}
                        enabledCount={resourceSummary?.mcp.count ?? 0}
                        chipNames={resourceSummary?.mcp.names ?? []}
                        managed={Boolean(
                          profileTarget?.capabilities.mcpActivation && resourceSummary?.mcp.managed
                        )}
                        managementDisabled={!profileTarget?.capabilities.mcpActivation}
                        managementLabel={t("Manage MCPs for {{name}}", {
                          name: activeTargetName
                        })}
                        managementStatus={
                          profileTarget?.capabilities.mcpActivation
                            ? undefined
                            : t("Agent controlled")
                        }
                        expanded={activeComposerSection === "mcp"}
                        onToggle={() => toggleComposerSection("mcp")}
                        onManagementChange={(managed) =>
                          updateSelectedResourceManagement("mcp", managed)
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
                        confirmLabel={t(
                          previewRequiresBackupReview
                            ? "Apply with backup"
                            : "Apply"
                        )}
                        confirmDisabled={!canApply || busy}
                        confirmBusy={isProfileApplying}
                        onOpenRecovery={() => {
                          setPreview(undefined);
                          setActiveWorkspace("settings");
                          setBackupManagerOpen(true);
                        }}
                        onAdoptTargetChanges={adoptCompatibleTargetChanges}
                        onCancel={() => setPreview(undefined)}
                        onConfirm={applySelectedProfile}
                      />
                    ) : null}
                      <SkillUpdateDialog
                        plan={selectedSkillUpdatePlan}
                        busy={busy}
                        onClose={() => setSelectedSkillUpdatePlan(undefined)}
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
                <div className="preview-modal-backdrop" onClick={busy ? undefined : cancelPendingProfileAction}>
                  <section
                    ref={appModalDialogRef}
                    className="profile-form-dialog profile-form-dialog--compact"
                    role="dialog"
                    aria-label={t("Unsaved profile changes")}
                    aria-modal="true"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <header className="profile-dialog-header">
                      <div>
                        <div className="section-title">{t("Save profile changes?")}</div>
                        <p className="muted">
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
              {profileDialogMode && !(profileDialogMode === "create" && profileCreateSource === "target") ? (
                <div className="preview-modal-backdrop" onClick={busy ? undefined : closeProfileDialog}>
                  <section
                    ref={appModalDialogRef}
                    className="profile-form-dialog"
                    role="dialog"
                    aria-label={t(profileDialogMode === "create" ? "New profile" : "Edit profile")}
                    aria-modal="true"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <header className="profile-dialog-header">
                      <div>
                        <div className="section-title">
                          {t(profileDialogMode === "create" ? "New profile" : "Edit profile")}
                        </div>
                        <p className="muted">
                          {profileDialogMode === "create"
                            ? t("Start blank or capture an existing local agent environment.")
                            : t("Update the profile name and description.")}
                        </p>
                      </div>
                    </header>
                    <div className="profile-form-grid">
                      {profileDialogMode === "create" ? (
                        <>
                          {!targetCapturePreview ? (
                            <div className="profile-source-choice" role="group" aria-label={t("Profile source")}>
                              <button
                                className={profileCreateSource === "blank" ? "is-selected" : ""}
                                type="button"
                                onClick={() => setProfileCreateSource("blank")}
                              >
                                {t("Blank")}
                              </button>
                              <button
                                className={profileCreateSource === "target" ? "is-selected" : ""}
                                type="button"
                                onClick={() => {
                                  setProfileCreateSource("target");
                                  setProfileCaptureOrigin("profiles");
                                  setProfileCaptureError("");
                                  const currentTarget = targets.find((target) => target.id === profileForm.targetId);
                                  const nextTarget = currentTarget && isTargetInstalled(currentTarget.health)
                                    ? currentTarget
                                    : targets.find((target) => isTargetInstalled(target.health));
                                  if (nextTarget) {
                                    setProfileForm((current) => ({
                                      ...current,
                                      targetId: nextTarget.id,
                                      name: current.name.trim() || `${nextTarget.name} Current`
                                    }));
                                  }
                                }}
                              >
                                {t("From Agent")}
                              </button>
                            </div>
                          ) : null}
                          <label>
                            <span>
                              {profileCreateSource === "target"
                                ? t("Source Agent")
                                : t("Preferred Agent")}
                            </span>
                            <select
                              aria-label={
                                profileCreateSource === "target"
                                  ? t("Source Agent")
                                  : t("Preferred Agent")
                              }
                              value={profileForm.targetId}
                              onChange={(event) => {
                                setProfileForm({ ...profileForm, targetId: event.currentTarget.value });
                              }}
                            >
                              {targets.map((target) => (
                                <option value={target.id} key={target.id}>{target.name}</option>
                              ))}
                            </select>
                          </label>
                        </>
                      ) : null}
                      <label>
                        <span>{t("Profile name")}</span>
                        <input
                          aria-label={t("Profile name")}
                          aria-invalid={Boolean(profileFormError)}
                          aria-describedby={profileFormError ? "profile-name-error" : undefined}
                          value={profileForm.name}
                          onChange={(event) => {
                            setProfileFormError("");
                            setProfileForm({ ...profileForm, name: event.currentTarget.value });
                          }}
                        />
                        {profileFormError ? (
                          <small className="field-error" id="profile-name-error">
                            {profileFormError}
                          </small>
                        ) : null}
                      </label>
                      {profileDialogMode === "edit" || profileCreateSource === "blank" ? (
                        <label>
                          <span>{t("Description")}</span>
                          <textarea
                            aria-label={t("Description")}
                            rows={3}
                            value={profileForm.description}
                            onChange={(event) =>
                              setProfileForm({ ...profileForm, description: event.currentTarget.value })
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                    <footer className="preview-actions">
                      <button ref={appModalInitialFocusRef} className="secondary-action" type="button" disabled={busy} onClick={closeProfileDialog}>
                        {t("Cancel")}
                      </button>
                      <button
                        className="primary-action"
                        type="button"
                        disabled={
                          busy ||
                          profileForm.name.trim().length === 0
                        }
                        onClick={submitProfileDialog}
                      >
                        {t(profileDialogMode === "edit" ? "Done" : "Create")}
                      </button>
                    </footer>
                  </section>
                </div>
              ) : null}
              {deleteProfileCandidateId ? (
                <div className="preview-modal-backdrop" onClick={busy ? undefined : closeProfileDialog}>
                  <section
                    ref={appModalDialogRef}
                    className="profile-form-dialog profile-form-dialog--compact"
                    role="dialog"
                    aria-label={t("Delete profile")}
                    aria-modal="true"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <header className="profile-dialog-header">
                      <div>
                        <div className="section-title">{t("Delete profile")}</div>
                        <p className="muted">
                          {isDeleteProfileCandidateActive
                            ? t("{{name}} is active on {{targets}}. Apply another profile or stop managing each Agent before removing it.", { name: deleteProfileCandidateName, targets: deleteProfileCandidateActiveTargets.join(", ") })
                            : t("Remove {{name}}? Applied Agent files and backups are not removed.", { name: deleteProfileCandidateName })}
                        </p>
                      </div>
                    </header>
                    <footer className="preview-actions">
                      <button ref={appModalInitialFocusRef} className="secondary-action" type="button" disabled={busy} onClick={closeProfileDialog}>
                        {t("Cancel")}
                      </button>
                      {!isDeleteProfileCandidateActive ? (
                        <button className="danger-action" type="button" disabled={busy} onClick={deleteProfile}>
                          {t("Remove profile")}
                        </button>
                      ) : (
                        <button
                          className="primary-action"
                          type="button"
                          onClick={() => {
                            closeProfileDialog();
                            setActiveWorkspace("targets");
                          }}
                        >
                          {t("Open Agents")}
                        </button>
                      )}
                    </footer>
                  </section>
                </div>
              ) : null}
            </section>
          </>
        ) : activeWorkspace === "targets" ? (
          <TargetWorkspace
            targets={targets}
            targetStates={targetStates}
            mcpConnections={nativeMcpConnections ?? []}
            backups={backups}
            rollbackPreview={rollbackPreview}
            rollbackError={rollbackError}
            stopManagingPreview={stopManagingPreview}
            busy={busy}
            onRefresh={refreshTargets}
            onManageTarget={(targetId) => {
              selectTarget(targetId);
              setActiveWorkspace("profiles");
            }}
            onCreateProfileFromTarget={openCreateFromTargetDialog}
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
              description={t("Local defaults and connected services.")}
            />
            <section className="resource-section settings-section" aria-labelledby="appearance-heading">
              <div className="settings-section-title">
                <div>
                  <div className="resource-heading" id="appearance-heading">{t("Appearance")}</div>
                  <p className="settings-muted">{t("Choose how AgentEnv Manager displays its interface.")}</p>
                </div>
              </div>
              <div className="settings-preference-list">
                <label className="settings-preference-row">
                  <span className="settings-preference-copy">
                    <strong>{t("Language")}</strong>
                    <small>{t("Uses your system language until you choose another language.")}</small>
                  </span>
                  <select
                    data-testid="locale-select"
                    aria-label={t("Interface language")}
                    value={skillSettings.locale}
                    onChange={(event) =>
                      updateSkillSettings({ locale: event.currentTarget.value as AppLocale })
                    }
                  >
                    <option value="system">{t("System default")}</option>
                    <option value="en">{t("English")}</option>
                    <option value="zh_CN">{t("Simplified Chinese")}</option>
                    <option value="zh_TW">{t("Traditional Chinese")}</option>
                  </select>
                </label>
              </div>
            </section>
            <AgentSettingsSection
              supportedAgents={supportedTargets}
              enabledAgentIds={
                skillSettings.enabledTargetIds ?? supportedTargets.map((target) => target.id)
              }
              agents={targets}
              agentStates={targetStates}
              busy={busy}
              onSetEnabled={setAgentEnabled}
              onOpenRecovery={() => setActiveWorkspace("targets")}
            />
            <section className="resource-section settings-section" aria-labelledby="library-defaults-heading">
              <div className="settings-section-title">
                <div>
                  <div className="resource-heading" id="library-defaults-heading">{t("Skills library")}</div>
                  <p className="settings-muted">{t("Defaults used when installing managed skills.")}</p>
                </div>
              </div>
              <div className="settings-preference-list">
                <label className="settings-preference-row">
                  <span className="settings-preference-copy">
                    <strong>{t("Sync")}</strong>
                    <small>
                      {skillSettings.skillSyncMethod === "copy"
                        ? t("Library updates stay pending until installs are explicitly synchronized.")
                        : skillSettings.skillSyncMethod === "auto"
                          ? t("Uses live links when supported and falls back to copied installs.")
                          : t("Library updates immediately change linked Agent Skills without another Apply preview.")}
                    </small>
                  </span>
                  <select
                    aria-label={t("Global skill sync method")}
                    value={skillSettings.skillSyncMethod}
                    onChange={(event) =>
                      updateSkillSettings({
                        skillSyncMethod: event.currentTarget.value as AgentEnvSettings["skillSyncMethod"]
                      })
                    }
                  >
                    <option value="symlink">{t("Live link (recommended)")}</option>
                    <option value="copy">{t("Copy (apply-gated updates)")}</option>
                    <option value="auto">{t("Auto (live link when possible)")}</option>
                  </select>
                </label>
                <div className="settings-preference-row">
                  <span className="settings-preference-copy">
                    <strong>{t("Storage")}</strong>
                    <small>~/.config/agentenv-manager</small>
                  </span>
                  <div className="settings-readonly-value" aria-label={t("Global skill storage location")}>
                    {t("AgentEnv data")}
                  </div>
                </div>
                <div className="settings-preference-row">
                  <span className="settings-preference-copy">
                    <strong>{t("Auto-check")}</strong>
                    <small>{t("Checks only skills that have per-skill update checks enabled.")}</small>
                  </span>
                  <Switch
                    checked={skillSettings.skillAutoCheckEnabled}
                    label={t("Skill auto update check")}
                    disabled={busy}
                    onClick={() =>
                      updateSkillSettings({
                        skillAutoCheckEnabled: !skillSettings.skillAutoCheckEnabled
                      })
                    }
                  />
                </div>
                <label className="settings-preference-row">
                  <span className="settings-preference-copy">
                    <strong>{t("Check interval")}</strong>
                  </span>
                  <span className="settings-interval-control">
                    <input
                      aria-label={t("Skill auto check interval minutes")}
                      min={5}
                      max={1440}
                      step={5}
                      type="number"
                      disabled={!skillSettings.skillAutoCheckEnabled || busy}
                      value={skillSettings.skillAutoCheckIntervalMinutes}
                      onChange={(event) =>
                        updateSkillSettings({
                          skillAutoCheckIntervalMinutes: Number(event.currentTarget.value)
                        })
                      }
                    />
                    <span aria-hidden="true">{t("min")}</span>
                  </span>
                </label>
              </div>
            </section>
            <section className="resource-section settings-section" aria-labelledby="agentenv-data-heading">
              <div className="settings-section-header settings-data-header">
                <div>
                  <div className="resource-heading" id="agentenv-data-heading">{t("Data & Backups")}</div>
                  <p className="settings-muted">{t("AgentEnv data and the recovery points created before local changes.")}</p>
                </div>
                <div className="settings-data-actions">
                  <button className="secondary-action" type="button" disabled={busy} onClick={() => void window.agentEnv.openDataFolder()}>
                    <FolderKanban size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t("Open folder")}
                  </button>
                </div>
              </div>
              <code className="settings-data-path">~/.config/agentenv-manager</code>
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
                  <button type="button" className="secondary-action" disabled={busy} onClick={openBackupManager}>
                    {t("Manage")}
                  </button>
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
                      {githubAuthStatus.state === "signed-in" && githubAuthStatus.user
                        ? t("Connected as {{login}}", { login: githubAuthStatus.user.login })
                        : githubDeviceLogin
                          ? t("Authorize AgentEnv Manager in your browser")
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
                      className="primary-button"
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
                <div className="github-login-result github-login-result--error" role="alert">
                  {githubAuthStatus.error}
                </div>
              ) : null}
            </section>
            {backupManagerOpen ? (
              <div className="preview-modal-backdrop" onClick={busy ? undefined : closeBackupManager}>
                <section
                  ref={appModalDialogRef}
                  className="profile-form-dialog backup-manager-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("Manage Backups")}
                  onClick={(event) => event.stopPropagation()}
                >
                  {backupDeleteCandidate ? (
                    <>
                      <header className="profile-dialog-header">
                        <div>
                          <div className="section-title">{t("Delete backup?")}</div>
                          <p className="muted">{managedBackupTitle(backupDeleteCandidate, t)}</p>
                        </div>
                      </header>
                      <div className="backup-confirm-summary">
                        <strong>{formatBytes(backupDeleteCandidate.sizeBytes)}</strong>
                        <p>{t("This recovery point cannot be restored after deletion. Profiles, Library resources, and current Agent files are unchanged.")}</p>
                      </div>
                      <footer className="preview-actions">
                        <button ref={appModalInitialFocusRef} className="secondary-action" type="button" disabled={busy} onClick={() => setBackupDeleteCandidate(undefined)}>
                          {t("Cancel")}
                        </button>
                        <button className="danger-action" type="button" disabled={busy} onClick={() => void deleteSelectedManagedBackup()}>
                          {t("Delete backup")}
                        </button>
                      </footer>
                    </>
                  ) : backupCleanupConfirm ? (
                    <>
                      <header className="profile-dialog-header">
                        <div>
                          <div className="section-title">{t("Clean up backups?")}</div>
                          <p className="muted">
                            {t((managedBackups?.eligibleCount ?? 0) === 1 ? "Delete 1 backup and free approximately {{size}}." : "Delete {{count}} backups and free approximately {{size}}.", {
                              count: managedBackups?.eligibleCount ?? 0,
                              size: formatBytes(managedBackups?.eligibleBytes ?? 0)
                            })}
                          </p>
                        </div>
                      </header>
                      <div className="backup-confirm-summary">
                        <p>{t("Only recovery points outside the retention period are removed. Required recovery and takeover backups stay available.")}</p>
                      </div>
                      <footer className="preview-actions">
                        <button ref={appModalInitialFocusRef} className="secondary-action" type="button" disabled={busy} onClick={() => setBackupCleanupConfirm(false)}>
                          {t("Cancel")}
                        </button>
                        <button className="danger-action" type="button" disabled={busy} onClick={() => void cleanupManagedBackups()}>
                          {t((managedBackups?.eligibleCount ?? 0) === 1 ? "Clean up 1 backup" : "Clean up {{count}} backups", { count: managedBackups?.eligibleCount ?? 0 })}
                        </button>
                      </footer>
                    </>
                  ) : (
                    <>
                      <header className="profile-dialog-header backup-manager-header">
                        <div>
                          <div className="section-title">{t("Manage Backups")}</div>
                          <p className="muted">
                            {t((managedBackups?.items.length ?? 0) === 1 ? "{{count}} backup · {{size}}" : "{{count}} backups · {{size}}", {
                              count: managedBackups?.items.length ?? 0,
                              size: formatBytes(managedBackups?.totalBytes ?? 0)
                            })}
                          </p>
                        </div>
                      </header>
                      {backupManagerNotice ? (
                        <div className={`backup-manager-notice is-${backupManagerNotice.kind}`} role={backupManagerNotice.kind === "error" ? "alert" : "status"}>
                          {backupManagerNotice.message}
                        </div>
                      ) : null}
                      <div className="backup-manager-list" aria-busy={managedBackupsLoading}>
                        {managedBackupsLoading && !managedBackups ? (
                          <div className="backup-manager-empty">{t("Calculating storage...")}</div>
                        ) : managedBackups?.items.length ? (
                          managedBackups.items.map((item) => (
                            <article className="backup-manager-row" key={`${item.kind}:${item.id}`}>
                              <span className={`backup-kind-icon is-${item.kind}`} aria-hidden="true">
                                {item.kind === "skill-cleanup" ? <Database size={17} /> : <History size={17} />}
                              </span>
                              <span className="backup-row-copy">
                                <strong title={managedBackupTitle(item, t)}>{managedBackupTitle(item, t)}</strong>
                                <small>
                                  {formatDate(item.createdAt)} · {t("{{count}} files", { count: item.fileCount })} · {formatBytes(item.sizeBytes)}
                                </small>
                              </span>
                              <span className={`backup-status is-${item.cleanupStatus}`} title={managedBackupStatusLabel(item, t)}>
                                {managedBackupStatusLabel(item, t)}
                              </span>
                              {item.deletable ? (
                                <button
                                  className="backup-row-delete"
                                  type="button"
                                  disabled={busy}
                                  aria-label={t("Delete backup {{name}}", { name: managedBackupTitle(item, t) })}
                                  onClick={() => setBackupDeleteCandidate(item)}
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                  {t("Delete")}
                                </button>
                              ) : (
                                <span className="backup-required-lock" title={managedBackupStatusLabel(item, t)}>{t("Required")}</span>
                              )}
                            </article>
                          ))
                        ) : (
                          <div className="backup-manager-empty">
                            <History size={22} aria-hidden="true" />
                            <strong>{t("No managed backups")}</strong>
                            <span>{t("Recovery points will appear here after AgentEnv changes local environments.")}</span>
                          </div>
                        )}
                      </div>
                      <footer className="preview-actions backup-manager-actions">
                        <span>
                          {managedBackups?.eligibleCount
                            ? t("{{count}} eligible · {{size}}", {
                                count: managedBackups.eligibleCount,
                                size: formatBytes(managedBackups.eligibleBytes)
                              })
                            : t("Nothing to clean")}
                        </span>
                        <button ref={appModalInitialFocusRef} className="secondary-action" type="button" disabled={busy} onClick={closeBackupManager}>
                          {t("Close")}
                        </button>
                        <button
                          className="danger-action"
                          type="button"
                          disabled={busy || !managedBackups?.eligibleCount}
                          onClick={() => setBackupCleanupConfirm(true)}
                        >
                          {t("Clean up now")}
                        </button>
                      </footer>
                    </>
                  )}
                </section>
              </div>
            ) : null}
            {dataRestorePreview ? (
              <div className="preview-modal-backdrop" onClick={() => {
                if (!busy) setDataRestorePreview(undefined);
              }}>
                <section ref={appModalDialogRef} className="profile-form-dialog profile-form-dialog--compact" role="dialog" aria-modal="true" aria-label={t("Restore AgentEnv data")} onClick={(event) => event.stopPropagation()}>
                  <header className="profile-dialog-header">
                    <div>
                      <div className="section-title">{t("Restore AgentEnv data")}</div>
                      <p className="muted">{t("Replace current Profiles, Library resources, settings, deployment state, and recovery history.")}</p>
                    </div>
                  </header>
                  <div className="data-restore-summary">
                    <span><strong>{t("Created")}</strong>{formatDate(dataRestorePreview.createdAt)}</span>
                    <span><strong>{t("Format")}</strong>{t("Version {{version}}", { version: dataRestorePreview.formatVersion })}</span>
                    <span><strong>{t("Contents")}</strong>{t("{{count}} top-level items", { count: dataRestorePreview.topLevelItemCount })}</span>
                    <code title={dataRestorePreview.path}>{dataRestorePreview.path}</code>
                    <p>{t("A safety backup of the current data will be created before replacement.")}</p>
                  </div>
                  <footer className="preview-actions">
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
        {pendingSkillImport && selectedSkillImportConflict ? (
          <div className="preview-modal-backdrop" onClick={dismissSkillImport}>
            <section
              ref={appModalDialogRef}
              className="profile-form-dialog skill-import-conflict-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("Review duplicate Skill")}
              aria-busy={pendingSkillImport.committing}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="profile-dialog-header">
                <div>
                  <div className="section-title">
                    {t(
                      selectedSkillImportConflict.match === "id"
                        ? "A Skill with this Library ID already exists"
                        : "A Skill with this name already exists"
                    )}
                  </div>
                  <p className="muted">
                    {selectedSkillImportConflict.sourceUpdateAvailable
                      ? t("The content matches, and the incoming Skill adds a tracked online source.")
                      : selectedSkillImportConflict.identical
                        ? t("The incoming Skill is identical to the Library copy.")
                        : t("Review the versions, sources, and file changes before choosing which copy to keep.")}
                  </p>
                </div>
                <span className={`skill-import-match-state${selectedSkillImportConflict.identical ? " is-identical" : " is-different"}`}>
                  {t(
                    selectedSkillImportConflict.sourceUpdateAvailable
                      ? "Source available"
                      : selectedSkillImportConflict.identical
                        ? "Identical"
                        : "Different"
                  )}
                </span>
              </header>

              {pendingSkillImport.preview.conflicts.length > 1 ? (
                <div className="skill-import-existing-picker" role="radiogroup" aria-label={t("Existing Skills with the same name")}>
                  {pendingSkillImport.preview.conflicts.map((conflict) => (
                    <button
                      type="button"
                      disabled={pendingSkillImport.committing}
                      role="radio"
                      aria-checked={conflict.existing.id === selectedSkillImportConflict.existing.id}
                      className={conflict.existing.id === selectedSkillImportConflict.existing.id ? "is-selected" : ""}
                      key={conflict.existing.id}
                      onClick={() => {
                        setSelectedSkillConflictId(conflict.existing.id);
                        setSkillImportDecision(conflict.contentIdentical ? "keep-both" : "replace");
                      }}
                    >
                      <strong>{conflict.existing.id}</strong>
                      <span>{t(conflict.sourceUpdateAvailable ? "Source available" : conflict.identical ? "Identical" : "Different")}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="skill-import-comparison-summary">
                {[
                  { label: t("Library copy"), item: selectedSkillImportConflict.existing },
                  { label: t("Incoming copy"), item: pendingSkillImport.preview.incoming }
                ].map(({ label, item }) => (
                  <article key={label}>
                    <span>{label}</span>
                    <strong>{item.name}</strong>
                    <dl>
                      <div><dt>{t("Version")}</dt><dd>{item.version ?? t("Not declared")}</dd></div>
                      <div><dt>{t("Hash")}</dt><dd><code title={item.contentHash}>{item.contentHash.slice(0, 12)}</code></dd></div>
                      <div><dt>{t("Source")}</dt><dd title={item.source}>{item.sourceType === "github" || item.sourceType === "git" ? item.source : t("Local")}</dd></div>
                      <div>
                        <dt>{t("Modified")}</dt>
                        <dd title={item.upstream?.updatedAt ?? item.modifiedAt}>
                          {item.upstream?.updatedAt || item.modifiedAt
                            ? formatDate(item.upstream?.updatedAt ?? item.modifiedAt!)
                            : t("Unknown")}
                        </dd>
                      </div>
                      <div><dt>{t("ID")}</dt><dd><code>{item.id}</code></dd></div>
                    </dl>
                  </article>
                ))}
              </div>

              <div className="skill-import-file-review">
                <div className="skill-import-file-review__header">
                  <strong>{t("SKILL.md preview")}</strong>
                  <span>
                    {selectedSkillImportConflict.changes.length === 0
                      ? t("No file changes")
                      : t("{{count}} changed files", { count: selectedSkillImportConflict.changes.length })}
                  </span>
                </div>
                {selectedSkillImportConflict.changes.length > 0 ? (
                  <div className="diff-list">
                    {selectedSkillImportConflict.changes.map((change) => (
                      <div className="diff-file" key={change.path}>
                        <div className="diff-file-meta"><strong>{change.path}</strong></div>
                        <DiffViewer path={change.path} diff={change.diff} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="skill-import-identical-preview">{pendingSkillImport.preview.incoming.skillMarkdown}</pre>
                )}
              </div>

              {!selectedSkillImportConflict.contentIdentical ? (
                <div className="skill-import-decisions" role="radiogroup" aria-label={t("Import decision")}>
                  <label className={skillImportDecision === "replace" ? "is-selected" : ""}>
                    <input
                      type="radio"
                      disabled={pendingSkillImport.committing}
                      name="skill-import-decision"
                      checked={skillImportDecision === "replace"}
                      onChange={() => setSkillImportDecision("replace")}
                    />
                    <span><strong>{t("Replace Library copy")}</strong><small>{t("Profiles keep the same Skill reference. The current Library copy is backed up.")}</small></span>
                  </label>
                  <label className={skillImportDecision === "keep-both" ? "is-selected" : ""}>
                    <input
                      type="radio"
                      disabled={pendingSkillImport.committing}
                      name="skill-import-decision"
                      checked={skillImportDecision === "keep-both"}
                      onChange={() => setSkillImportDecision("keep-both")}
                    />
                    <span><strong>{t("Keep both")}</strong><small>{t("Save the incoming Skill under a different Library ID.")}</small></span>
                  </label>
                  {skillImportDecision === "keep-both" ? (
                    <label className="skill-import-alternate-id">
                      <span>{t("Library ID")}</span>
                      <input
                        disabled={pendingSkillImport.committing}
                        value={skillImportAlternateId}
                        aria-invalid={!alternateSkillIdValid}
                        onChange={(event) => setSkillImportAlternateId(event.target.value)}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}

              <footer className="preview-actions">
                <button
                  ref={appModalInitialFocusRef}
                  className="secondary-action"
                  type="button"
                  disabled={pendingSkillImport.committing}
                  onClick={dismissSkillImport}
                >
                  {t("Cancel")}
                </button>
                <button
                  className="primary-action"
                  type="button"
                  disabled={Boolean(
                    pendingSkillImport.committing ||
                    (!selectedSkillImportConflict.contentIdentical &&
                      skillImportDecision === "keep-both" &&
                      !alternateSkillIdValid)
                  )}
                  onClick={() => {
                    if (selectedSkillImportConflict.sourceUpdateAvailable) {
                      confirmSkillImport({ action: "update-source", existingId: selectedSkillImportConflict.existing.id });
                    } else if (selectedSkillImportConflict.identical) {
                      confirmSkillImport({ action: "reuse", existingId: selectedSkillImportConflict.existing.id });
                    } else if (skillImportDecision === "replace") {
                      confirmSkillImport({ action: "replace", existingId: selectedSkillImportConflict.existing.id });
                    } else {
                      confirmSkillImport({ action: "keep-both", id: skillImportAlternateId });
                    }
                  }}
                >
                  {pendingSkillImport.committing ? (
                    <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
                  ) : null}
                  {t(
                    pendingSkillImport.committing
                      ? "Importing..."
                      : selectedSkillImportConflict.sourceUpdateAvailable
                        ? "Update source"
                        : selectedSkillImportConflict.identical
                          ? "Use existing"
                          : skillImportDecision === "replace"
                            ? "Replace Skill"
                            : "Save another Skill"
                  )}
                </button>
              </footer>
            </section>
          </div>
        ) : null}
        {profileDialogMode === "create" && profileCreateSource === "target" ? (
          <TargetCaptureDialog
            target={targets.find((target) => target.id === profileForm.targetId)}
            targets={targets}
            name={profileForm.name}
            origin={profileCaptureOrigin}
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
                name: target ? `${target.name} Current` : current.name
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
