import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  BookOpenText,
  ExternalLink,
  FolderKanban,
  GitFork,
  HardDrive,
  Monitor,
  MonitorCheck,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings2,
  TriangleAlert,
  Trash2,
  X
} from "lucide-react";
import {
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";
import type {
  ActivationPreview,
  AssetPolicy,
  BackupSummary,
  DataRestorePreview,
  ProfileDetail,
  ProfileSummary,
  ResourceIconKey,
  RollbackPreview,
  StopManagingMode,
  StopManagingPreview,
  SaveProfileInput,
  AgentEnvSettings,
  AppLocale,
  GitHubAuthStatus,
  GitHubDeviceLogin,
  GitHubDeviceLoginResult,
  GitHubSkillImportInput,
  GitHubSkillImportResult,
  GitHubSkillScanResult,
  LibraryResourceVersions,
  ManageTargetSkillInput,
  RetireSharedSkillInput,
  SharedSkillRetentionInput,
  McpLibraryEntry,
  SaveMcpServerInput,
  SkillInventoryEntry,
  SkillAvailabilityInput,
  SkillIconInput,
  SkillCleanupRequest,
  SkillCleanupBackupSummary,
  SkillCleanupResult,
  SkillLibraryEntry,
  SkillUpdatePolicyInput,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdateSourceInput,
  TargetInfo,
  TargetCapturePreview,
  TargetManagementState
} from "../shared/types";
import { I18nProvider, useI18n, type TranslationValues } from "./i18n";
import {
  collectLibraryResourceVersions,
  libraryResourceVersionsEqual
} from "../shared/libraryVersions";
import { AgentsEditor } from "./components/AgentsEditor";
import { HistoryView } from "./components/HistoryView";
import { InfoTip } from "./components/InfoTip";
import { McpEditor } from "./components/McpEditor";
import { McpLibraryPanel } from "./components/McpLibraryPanel";
import { PreviewDialog } from "./components/PreviewDialog";
import { ProfileComposerSection } from "./components/ProfileComposerSection";
import { ResourceIconPicker } from "./components/ResourceIconPicker";
import {
  ProfileSidebar,
  targetIconFor,
  type AppWorkspace,
  type LibraryTab
} from "./components/ProfileSidebar";
import {
  SkillLibraryPanel,
  type PreparedSkillTarget,
  type SkillUpdateCheckStatus
} from "./components/SkillLibraryPanel";
import { SkillUpdateDialog } from "./components/SkillUpdateDialog";
import { SkillsEditor } from "./components/SkillsEditor";
import { TargetCaptureDialog } from "./components/TargetCaptureDialog";
import { TargetWorkspace } from "./components/TargetWorkspace";
import { Switch } from "./components/ui";
import {
  deriveApplyActionLabel,
  deriveProfileReadiness
} from "./profileReadiness";
import {
  defaultMcpLibraryViewState,
  defaultSkillLibraryViewState,
  updateLibraryScroll
} from "./libraryViewState";
import { useLibraryScrollRestoration } from "./hooks/useLibraryScrollRestoration";
import { useModalDialog } from "./hooks/useModalDialog";
import { useDesktopShortcuts } from "./hooks/useDesktopShortcuts";
import {
  listProfileApplications,
  summarizeProfile,
  type ProfileResourceSummary
} from "./profileSummary";

const emptyAssetPolicy: AssetPolicy = {
  ownedDirs: [],
  ownedFiles: [],
  skillRefs: [],
  mcpRefs: [],
  disabledSkillPaths: []
};

type ComposerSection = "instructions" | "skills" | "mcp" | "advanced";
type ProfileDialogMode = "create" | "edit";
type ProfileCreateSource = "blank" | "target";
type ProfileCaptureOrigin = "profiles" | "targets";
type ProfileCaptureActivity = "idle" | "reviewing" | "creating";

interface PendingProfileAction {
  label: string;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

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
  configText: profile.configText,
  assetPolicy: profile.assetPolicy
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
          aria-label={copied ? "Message copied" : "Copy message"}
          title={copied ? "Copied" : "Copy message"}
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

const formatShortDate = (value?: string) => {
  if (!value) {
    return "No activity";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
};

const isGitHubRateLimitError = (message: string) =>
  /github.*(?:rate limit|api limit)|(?:rate limit|api limit).*github/i.test(message);

type ValidationLevel = "ok" | "warning" | "error" | "pending";

interface ValidationRow {
  label: string;
  value: string;
  detail?: string;
  level: ValidationLevel;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const validateConfig = (
  configText: string,
  language?: TargetInfo["configLanguage"]
): Pick<ValidationRow, "value" | "detail" | "level"> => {
  if (language === "jsonc") {
    const errors: ParseError[] = [];
    const parsed = parseJsonc(configText.trim().length === 0 ? "{}" : configText, errors, {
      allowTrailingComma: true
    });
    if (errors.length > 0) {
      return {
        value: "Blocked",
        detail: errors.map((error) => printParseErrorCode(error.error)).join(", "),
        level: "error"
      };
    }
    if (!isRecord(parsed)) {
      return {
        value: "Blocked",
        detail: "Expected a JSON object",
        level: "error"
      };
    }
    return { value: "OK", level: "ok" };
  }

  if (language === "toml") {
    return {
      value: "Preview",
      detail: "Preview validates TOML in the main process",
      level: "pending"
    };
  }

  return { value: "Pending", detail: "Preview checks this target format", level: "pending" };
};

const createValidationRows = (
  profile: ProfileDetail,
  target?: TargetInfo,
  preview?: ActivationPreview,
  profileTarget: TargetInfo | undefined = target
): ValidationRow[] => {
  const configValidation = profile.manifest.managed.config
    ? validateConfig(profile.configText, profileTarget?.configLanguage)
    : { value: "Disabled", level: "pending" as const };
  const targetLevel: ValidationLevel =
    target?.health.status === "ready"
      ? "ok"
      : target?.health.status === "missing"
        ? "error"
        : target
          ? "warning"
          : "pending";

  return [
    {
      label: `${target?.name ?? "Target"} access`,
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
      label: profileTarget?.instructionsLabel ?? "Instructions",
      value: profile.manifest.managed.instructions
        ? profile.instructions.trim().length > 0
          ? "OK"
          : "Blocked"
        : "Disabled",
      detail:
        profile.manifest.managed.instructions && profile.instructions.trim().length === 0
          ? "Instructions are empty"
          : undefined,
      level:
        profile.manifest.managed.instructions && profile.instructions.trim().length === 0
          ? "error"
          : "ok"
    },
    {
      ...configValidation,
      label: `${profileTarget?.name ?? "Native"} native config`,
      detail:
        target && profileTarget && target.id !== profileTarget.id
          ? `Only applied when the destination Target is ${profileTarget.name}`
          : configValidation.detail
    },
    {
      label: `${target?.name ?? "Target"} compatibility`,
      value:
        target && profileTarget && target.id !== profileTarget.id
          ? preview
            ? (preview.omissions?.length ?? 0) > 0
              ? "Review"
              : "Compatible"
            : "Preview"
          : "Native",
      detail:
        target && profileTarget && target.id !== profileTarget.id
          ? preview
            ? `${preview.effectivePayload?.total ?? 0} resources included; ${preview.omissions?.length ?? 0} native items omitted`
            : "Preview calculates the portable payload and native-only omissions"
          : "Native configuration is supported by this Target",
      level:
        preview && (preview.omissions?.length ?? 0) > 0
          ? "warning"
          : target && profileTarget && target.id !== profileTarget.id
            ? "pending"
            : "ok"
    },
    {
      label: "Skills",
      value: profile.manifest.managed.assets
        ? profile.assetPolicy.ownedDirs.some((ownedDir) => ownedDir.kind === "skill")
          ? "Preview"
          : "OK"
        : "Disabled",
      detail:
        profile.manifest.managed.assets &&
        profile.assetPolicy.ownedDirs.some((ownedDir) => ownedDir.kind === "skill")
          ? "Preview verifies source directories and target ownership"
          : undefined,
      level:
        profile.manifest.managed.assets &&
        profile.assetPolicy.ownedDirs.some((ownedDir) => ownedDir.kind === "skill")
          ? "pending"
          : "ok"
    },
    {
      label: "Live conflicts",
      value: preview ? (preview.errors.length > 0 ? "Blocked" : "OK") : "Pending",
      detail: preview
        ? preview.errors.length > 0
          ? `${preview.errors.length} issue${preview.errors.length === 1 ? "" : "s"} found`
          : "Preview checks passed"
        : "Run preview to check live files",
      level: preview ? (preview.errors.length > 0 ? "error" : "ok") : "pending"
    }
  ];
};

const AppContent = ({
  onLocalePreferenceChange
}: {
  onLocalePreferenceChange(locale: AppLocale): void;
}) => {
  const { t, formatDate, formatNumber } = useI18n();
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [targetStates, setTargetStates] = useState<TargetManagementState[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [librarySkills, setLibrarySkills] = useState<SkillLibraryEntry[]>([]);
  const [mcpServers, setMcpServers] = useState<McpLibraryEntry[]>([]);
  const [skillUpdates, setSkillUpdates] = useState<SkillUpdateInfo[]>([]);
  const [skillInventory, setSkillInventory] = useState<SkillInventoryEntry[]>([]);
  const [skillInventoryRefreshing, setSkillInventoryRefreshing] = useState(false);
  const [skillCleanupBackups, setSkillCleanupBackups] = useState<SkillCleanupBackupSummary[]>([]);
  const [skillCleanupResult, setSkillCleanupResult] = useState<SkillCleanupResult>();
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
    skillAutoCheckIntervalMinutes: 60
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
  const [mcpUsage, setMcpUsage] = useState<Record<string, string[]>>({});
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [preview, setPreview] = useState<ActivationPreview>();
  const [replaceManagedDrift, setReplaceManagedDrift] = useState(false);
  const [acceptCrossTargetOmissions, setAcceptCrossTargetOmissions] = useState(false);
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview>();
  const [stopManagingPreview, setStopManagingPreview] = useState<StopManagingPreview>();
  const [rollbackError, setRollbackError] = useState<string>();
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>("library");
  const [activeLibraryTab, setActiveLibraryTab] = useState<LibraryTab>("skills");
  const [skillLibraryViewState, setSkillLibraryViewState] = useState(
    defaultSkillLibraryViewState
  );
  const [mcpLibraryViewState, setMcpLibraryViewState] = useState(
    defaultMcpLibraryViewState
  );
  const [mcpCreateRequest, setMcpCreateRequest] = useState(0);
  const [skillLibraryTool, setSkillLibraryTool] = useState<"import" | "discoveries">();
  const [skillUpdateCheckStatus, setSkillUpdateCheckStatus] =
    useState<SkillUpdateCheckStatus>();
  const [checkingProfileSkillUpdates, setCheckingProfileSkillUpdates] = useState(false);
  const [isProfileDirty, setIsProfileDirty] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [profileSaveStatus, setProfileSaveStatus] = useState("");
  const [settingsSaveStatus, setSettingsSaveStatus] = useState("");
  const [dataBackupStatus, setDataBackupStatus] = useState("");
  const [dataRestorePreview, setDataRestorePreview] = useState<DataRestorePreview>();
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
  const [deleteProfileDialogOpen, setDeleteProfileDialogOpen] = useState(false);
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
  const mcpSearchInputRef = useRef<HTMLInputElement>(null);
  const mcpCreateButtonRef = useRef<HTMLButtonElement>(null);
  const dataRefreshRequestRef = useRef(0);
  const profileFlowRequestRef = useRef(0);
  const activeProfileFlowRequestRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
  const rollbackReturnFocusRef = useRef<HTMLElement | null>(null);
  const dataRestoreReturnFocusRef = useRef<HTMLElement | null>(null);
  const appModalDialogRef = useRef<HTMLElement>(null);
  const appModalInitialFocusRef = useRef<HTMLButtonElement>(null);
  const appModalFallbackFocusRef = useRef<HTMLElement>(null);
  const activeLibraryView = activeWorkspace === "library" ? activeLibraryTab : undefined;
  const libraryScroll = useLibraryScrollRestoration({
    activeView: activeLibraryView,
    scrollTop:
      activeLibraryView === "skills"
        ? skillLibraryViewState.scrollTop
        : activeLibraryView === "mcp"
          ? mcpLibraryViewState.scrollTop
          : 0,
    restoreKey:
      activeLibraryView === "skills"
        ? librarySkills
        : activeLibraryView === "mcp"
          ? mcpServers
          : activeWorkspace,
    onScrollTopChange: (scrollTop) => {
      if (activeLibraryView === "skills") {
        setSkillLibraryViewState((current) => updateLibraryScroll(current, scrollTop));
      } else if (activeLibraryView === "mcp") {
        setMcpLibraryViewState((current) => updateLibraryScroll(current, scrollTop));
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
    if (settingsSaveStatus !== "Settings saved") {
      return undefined;
    }
    const timeout = window.setTimeout(() => setSettingsSaveStatus(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [settingsSaveStatus]);

  useEffect(() => {
    if (profileSaveStatus !== "Profile saved") {
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
      setBusy(false);
    }
  };

  const loadProfileCore = async (
    settingsOverride?: AgentEnvSettings,
    shouldApply: () => boolean = () => true
  ) => {
    const skillItemsPromise = window.agentEnv.listSkillLibrary();
    const corePromise = Promise.all([
      window.agentEnv.listTargets(),
      window.agentEnv.listTargetStates(),
      window.agentEnv.listProfiles(),
      window.agentEnv.listBackups(),
      skillItemsPromise,
      window.agentEnv.listSkillCleanupBackups(),
      window.agentEnv.listMcpLibrary(),
      settingsOverride ?? window.agentEnv.readSettings()
    ]);

    const skillItems = await skillItemsPromise;
    if (shouldApply()) {
      setLibrarySkills(skillItems);
    }

    const [
      targetItems,
      targetStateItems,
      profileItems,
      backupItems,
      ,
      cleanupBackupItems,
      mcpItems,
      settings
    ] = await corePromise;

    if (!shouldApply()) {
      return {
        targetItems,
        targetStateItems,
        profileItems,
        backupItems,
        skillItems,
        mcpItems,
        settings
      };
    }

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
    setMcpServers(mcpItems);
    setSkillSettings(settings);
    onLocalePreferenceChange(settings.locale);
    setSelectedTargetId((current) => current ?? targetItems[0]?.id);

    return {
      targetItems,
      targetStateItems,
      profileItems,
      backupItems,
      skillItems,
      mcpItems,
      settings
    };
  };

  const loadProfileEnrichment = async (
    core: Awaited<ReturnType<typeof loadProfileCore>>,
    checkSkillUpdates: boolean,
    shouldApply: () => boolean = () => true
  ) => {
    const { targetItems, profileItems, skillItems, mcpItems, settings } = core;
    const [skillUpdatesResult, skillInventoryResult, githubStatusResult] =
      await Promise.allSettled([
        checkSkillUpdates && settings.skillAutoCheckEnabled
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
      profileItems.map((profile) => window.agentEnv.readProfile(profile.id))
    );
    const usage: Record<string, string[]> = {};
    const nextMcpUsage: Record<string, string[]> = {};
    const nextProfileResourceCounts: Record<string, ProfileResourceSummary> = {};
    const nextProfileLibraryVersions: Record<string, LibraryResourceVersions> = {};
    for (const profile of profileDetails) {
      nextProfileLibraryVersions[profile.id] = collectLibraryResourceVersions(
        profile,
        skillItems,
        mcpItems
      );
      const profileTarget = targetItems.find(
        (targetItem) => targetItem.id === profile.manifest.targetId
      );
      if (profileTarget) {
        nextProfileResourceCounts[profile.id] = summarizeProfile(
          profile,
          profileTarget,
          skillItems
        );
      }
      for (const skillRef of profile.assetPolicy.skillRefs ?? []) {
        usage[skillRef.libraryId] = (usage[skillRef.libraryId] ?? []).concat(
          profile.manifest.name
        );
      }
      for (const mcpRef of profile.assetPolicy.mcpRefs ?? []) {
        nextMcpUsage[mcpRef.libraryId] = (nextMcpUsage[mcpRef.libraryId] ?? []).concat(
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
    setMcpUsage(nextMcpUsage);
    setProfileResourceCounts(nextProfileResourceCounts);
    setProfileLibraryVersions(nextProfileLibraryVersions);
    return { skillUpdateItems };
  };

  const refreshProfiles = async ({
    checkSkillUpdates = true,
    settingsOverride
  }: {
    checkSkillUpdates?: boolean;
    settingsOverride?: AgentEnvSettings;
  } = {}) => {
    const requestId = ++dataRefreshRequestRef.current;
    const shouldApply = () => dataRefreshRequestRef.current === requestId;
    const core = await loadProfileCore(settingsOverride, shouldApply);
    const enrichment = await loadProfileEnrichment(core, checkSkillUpdates, shouldApply);
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
        if (profileItems.length === 0) {
          return;
        }

        const initialTarget =
          targetItems.find(
            (target) =>
              target.health.executableFound &&
              targetStateItems.some(
                (state) => state.targetId === target.id && Boolean(state.activeProfileId)
              )
          ) ?? targetItems.find((target) => target.health.executableFound) ?? targetItems[0];
        const initialTargetId = initialTarget?.id;
        const activeProfileId = targetStateItems.find(
          (state) => state.targetId === initialTargetId
        )?.activeProfileId;
        const initialProfile =
          profileItems.find((profile) => profile.id === activeProfileId) ??
          profileItems.find((profile) => !initialTargetId || profile.targetId === initialTargetId) ??
          profileItems[0];
        setSelectedTargetId(initialTargetId ?? initialProfile.targetId);
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
      refreshProfiles().catch((unknownError) => {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isLoading, skillSettings.skillAutoCheckEnabled, skillSettings.skillAutoCheckIntervalMinutes]);

  const selectProfileNow = async (
    profileId: string,
    composerSection?: "instructions" | "skills" | "mcp" | "advanced"
  ) => {
    const requestId = ++profileFlowRequestRef.current;
    activeProfileFlowRequestRef.current = requestId;
    const isDifferentProfile = profileId !== selectedProfileId;
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    setRollbackPreview(undefined);
    if (isDifferentProfile) {
      setDraftProfile(undefined);
      setIsProfileDirty(false);
      setProfileSaveStatus("");
    }
    setActiveComposerSection(composerSection);
    setActiveWorkspace("profiles");
    setSelectedProfileId(profileId);
    try {
      const profile = await window.agentEnv.readProfile(profileId);
      if (requestId !== profileFlowRequestRef.current) {
        return;
      }
      setSelectedTargetId((current) => current ?? profile.manifest.targetId);
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
    const label = workspace === "profiles" ? "open Profiles" : `open ${workspace}`;
    guardProfileAction(label, () => {
      libraryScroll.captureScroll();
      setActiveWorkspace(workspace);
    });
  };

  const selectLibraryTab = (tab: LibraryTab) => {
    if (activeWorkspace === "library" && activeLibraryTab === tab) {
      return;
    }
    const label = tab === "skills" ? "open Skills" : "open MCP Servers";
    guardProfileAction(label, () => {
      libraryScroll.captureScroll();
      setActiveLibraryTab(tab);
      setActiveWorkspace("library");
    });
  };

  const selectProfile = (
    profileId: string,
    composerSection?: "instructions" | "skills" | "mcp" | "advanced"
  ) => {
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

  const changeProfileIconNow = async (profileId: string, iconKey: ResourceIconKey) => {
    if (draftProfile?.id === profileId) {
      updateDraftProfile({
        ...draftProfile,
        manifest: { ...draftProfile.manifest, iconKey }
      });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const profile = await window.agentEnv.readProfile(profileId);
      setActiveWorkspace("profiles");
      setSelectedProfileId(profileId);
      setSelectedTargetId((current) => current ?? profile.manifest.targetId);
      updateDraftProfile({
        ...profile,
        manifest: { ...profile.manifest, iconKey }
      });
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const changeProfileIcon = (profileId: string, iconKey: ResourceIconKey) => {
    guardProfileAction("change the profile icon", () => changeProfileIconNow(profileId, iconKey));
  };

  const saveDraft = async () => {
    if (!draftProfile) {
      return undefined;
    }

    const saved = await window.agentEnv.saveProfile(toSaveInput(draftProfile));
    setDraftProfile(saved);
    setIsProfileDirty(false);
    setProfileSaveStatus("Profile saved");
    setSkillUpdateCheckStatus(undefined);
    await refreshProfiles();
    return saved;
  };

  const saveSelectedProfile = async () => {
    if (saveInFlightRef.current) {
      return;
    }
    saveInFlightRef.current = true;
    setIsProfileSaving(true);
    setBusy(true);
    setError(undefined);
    try {
      await saveDraft();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      saveInFlightRef.current = false;
      setIsProfileSaving(false);
      setBusy(false);
    }
  };

  useDesktopShortcuts({
    activeWorkspace,
    activeLibraryTab,
    isProfileSaving,
    onSaveProfile: saveSelectedProfile,
    onRefreshSkills: refreshSkills,
    profileSearchRef: profileSearchInputRef,
    skillSearchRef: skillSearchInputRef,
    mcpSearchRef: mcpSearchInputRef
  });

  const openCreateProfileDialogNow = () => {
    const targetId = selectedTargetId ?? targets[0]?.id;
    if (!targetId) {
      setError("No target available");
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
    const targetName = targets.find((item) => item.id === targetId)?.name ?? "Target";
    guardProfileAction(`create a profile from ${targetName}`, () => openCreateFromTargetDialogNow(targetId));
  };

  const openEditProfileDialog = () => {
    if (!draftProfile) {
      return;
    }
    setProfileForm({
      targetId: draftProfile.manifest.targetId,
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
              targetId: profileForm.targetId,
              name,
              description
            });
        await refreshProfiles();
        setSelectedTargetId(saved.manifest.targetId);
        setSelectedProfileId(saved.id);
        setDraftProfile(saved);
        if (profileCreateSource === "target") {
          setProfileCaptureStatus(t("{{name}} created. Target unchanged.", { name: saved.manifest.name }));
        }
      } else if (draftProfile) {
        const updatedProfile: ProfileDetail = {
          ...draftProfile,
          manifest: {
            ...draftProfile.manifest,
            name,
            description
          }
        };
        updateDraftProfile(updatedProfile);
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
        setError(message);
      }
    } finally {
      setProfileCaptureActivity("idle");
      setBusy(false);
    }
  };

  const duplicateSelectedProfileNow = async () => {
    if (!selectedProfileId) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setIsProfileActionsOpen(false);
    profileActionsButtonRef.current?.focus();
    try {
      const saved = await window.agentEnv.duplicateProfile(selectedProfileId);
      await refreshProfiles();
      setSelectedTargetId(saved.manifest.targetId);
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

  const duplicateSelectedProfile = () => {
    guardProfileAction("duplicate this profile", duplicateSelectedProfileNow);
  };

  const deleteSelectedProfile = async () => {
    if (!selectedProfileId) {
      return;
    }
    const deletedProfileId = selectedProfileId;
    const deletedTargetId = draftProfile?.manifest.targetId ?? selectedTargetId;
    setBusy(true);
    setError(undefined);
    try {
      await window.agentEnv.deleteProfile(deletedProfileId);
      const { profileItems } = await refreshProfiles();
      const nextProfile = profileItems.find((profile) => profile.targetId === deletedTargetId);
      if (nextProfile) {
        const nextDetail = await window.agentEnv.readProfile(nextProfile.id);
        setSelectedProfileId(nextProfile.id);
        setSelectedTargetId(nextProfile.targetId);
        setDraftProfile(nextDetail);
      } else {
        setSelectedProfileId(undefined);
        setDraftProfile(undefined);
      }
      setDeleteProfileDialogOpen(false);
      setIsProfileActionsOpen(false);
      setPreview(undefined);
      setRollbackPreview(undefined);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const openDeleteProfileDialog = () => {
    appModalFallbackFocusRef.current = profileActionsButtonRef.current;
    guardProfileAction("delete this profile", () => setDeleteProfileDialogOpen(true));
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
    setDeleteProfileDialogOpen(false);
    setPreview(undefined);
    setRollbackPreview(undefined);
    setTargetCapturePreview(undefined);
    setProfileCaptureActivity("idle");
    setProfileCaptureError("");
    setProfileFormError("");
  };

  const appModalOpen = Boolean(
    pendingProfileAction || profileDialogMode || deleteProfileDialogOpen || dataRestorePreview
  );
  const dismissAppModal = () => {
    if (dataRestorePreview) {
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
    fallbackFocusRef: dataRestorePreview
      ? dataRestoreReturnFocusRef
      : appModalFallbackFocusRef,
    onDismiss: dismissAppModal,
    dismissDisabled: busy,
    focusKey:
      profileDialogMode === "create" && profileCreateSource === "target"
        ? `target-capture:${targetCapturePreview ? "review" : "setup"}`
        : profileDialogMode ?? (deleteProfileDialogOpen ? "delete" : dataRestorePreview ? "restore" : "guard")
  });

  const selectTargetNow = (targetId: string) => {
    setIsTargetMenuOpen(false);
    targetMenuButtonRef.current?.focus();
    if (targetId === selectedTargetId) {
      return;
    }

    setSelectedTargetId(targetId);
    setPreview(undefined);
    setRollbackPreview(undefined);
  };

  const selectTarget = (targetId: string) => {
    if (targetId === selectedTargetId) {
      setIsTargetMenuOpen(false);
      return;
    }
    const targetName = targets.find((target) => target.id === targetId)?.name ?? "target";
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
  const installedTargets = targets.filter((target) => target.health.executableFound);
  const profileTarget = targets.find(
    (target) => target.id === draftProfile?.manifest.targetId
  );
  const normalizedProfileSearch = profileSearch.trim().toLowerCase();
  const currentProfileId = targetStates.find(
    (state) => state.targetId === selectedTargetId
  )?.activeProfileId;
  const visibleProfiles = profiles
    .filter((profile) => {
      if (normalizedProfileSearch.length === 0) {
        return true;
      }

      return `${profile.name} ${profile.description}`.toLowerCase().includes(normalizedProfileSearch);
    })
    .sort((left, right) => {
      if (left.id === currentProfileId) return -1;
      if (right.id === currentProfileId) return 1;
      return left.name.localeCompare(right.name);
    });
  const activeTargetName = selectedTarget?.name ?? draftProfile?.manifest.targetId ?? "target";
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
  const selectedSkillUpdateImpact = selectedSkillUpdatePlan
    ? `Updates the shared Library copy used by ${plural(
        skillUsage[selectedSkillUpdatePlan.id]?.length ?? 0,
        "profile"
      )}. ${
        skillSettings.skillSyncMethod === "copy"
          ? "Copied Target installs remain unchanged until their Profiles are applied."
          : "Linked Target installs may change immediately after this update."
      }`
    : undefined;
  const isSelectedProfileActive = Boolean(
    selectedProfileId && targetStates.some((state) => state.activeProfileId === selectedProfileId)
  );
  const selectedProfileActiveTargets = selectedProfileId
    ? targetStates
        .filter((state) => state.activeProfileId === selectedProfileId)
        .map(
          (state) =>
            targets.find((target) => target.id === state.targetId)?.name ?? state.targetId
        )
    : [];
  const validationRows = draftProfile
    ? createValidationRows(draftProfile, selectedTarget, preview, profileTarget)
    : [];
  const localValidationErrors = validationRows
    .filter(
      (row) =>
        row.level === "error" && row.label !== "Target access" && row.label !== "Live conflicts"
    )
    .map((row) => row.detail ?? `${row.label} is invalid`);
  const resourceSummary =
    draftProfile && profileTarget
      ? summarizeProfile(draftProfile, profileTarget, librarySkills)
      : undefined;
  const selectedTargetProfileHash =
    selectedTarget && draftProfile
      ? draftProfile.targetContentHashes?.[selectedTarget.id] ??
        (selectedTarget.id === draftProfile.manifest.targetId ? draftProfile.contentHash : undefined)
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
              ? collectLibraryResourceVersions(draftProfile, librarySkills, mcpServers)
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
  const readinessTargetName = selectedTarget?.name ?? t("Target");
  const readinessActionText =
    readiness.status === "applied"
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
                  ? t("Review profile configuration")
                  : readiness.status === "preview-error"
                    ? t("Review blocking issues")
                    : readiness.status === "no-target"
                      ? t("Select a Target")
                      : t(readiness.message);
  const applyDisabled =
    !draftProfile || !selectedTarget || busy || isProfileDirty || readiness.status === "applied";
  const applyDescription = !draftProfile
    ? t("Select a profile before previewing changes")
    : !selectedTarget
      ? t("Select a target before previewing changes")
      : busy
        ? t("An action is in progress")
        : t(readiness.message);
  const previewHasOnlyManagedDrift = Boolean(
    preview &&
      preview.errors.length > 0 &&
      preview.errors.every((item) =>
        item.startsWith("External changes detected in AgentEnv-managed")
      )
  );
  const canApply = Boolean(
    preview &&
      (preview.changes.length > 0 ||
        preview.resourceChanges.length > 0 ||
        preview.sharedSkillPreparationChanged) &&
      (preview.errors.length === 0 || (previewHasOnlyManagedDrift && replaceManagedDrift)) &&
      (!preview.requiresOmissionAcknowledgement || acceptCrossTargetOmissions) &&
      localValidationErrors.length === 0 &&
      !rollbackPreview &&
      (selectedTarget?.health.canWrite ?? false)
  );

  const readyTargetCount = targets.filter(
    (target) => target.health.status === "ready" && target.health.canWrite
  ).length;

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
    setBusy(true);
    try {
      const nextPreview = await window.agentEnv.previewApply(
        draftProfile.id,
        selectedTarget?.id
      );
      if (requestId !== profileFlowRequestRef.current) {
        return;
      }
      const rendererBlockers = [
        ...(!selectedTarget?.health.canWrite
          ? [selectedTarget?.health.summary || `${selectedTarget?.name ?? "Target"} is unavailable`]
          : []),
        ...localValidationErrors
      ];
      setReplaceManagedDrift(false);
      setAcceptCrossTargetOmissions(false);
      setPreview({
        ...nextPreview,
        errors: [...new Set([...rendererBlockers, ...nextPreview.errors])]
      });
    } catch (unknownError) {
      if (requestId === profileFlowRequestRef.current) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    } finally {
      if (requestId === profileFlowRequestRef.current) {
        activeProfileFlowRequestRef.current = undefined;
        setBusy(false);
      }
    }
  };

  const runReadinessRemediation = () => {
    if (readiness.remediationLabel === "Open Targets") {
      setActiveWorkspace("targets");
      return;
    }
    if (readiness.remediationLabel === "Save now") {
      void saveSelectedProfile();
      return;
    }
    if (readiness.remediationLabel === "Review Advanced") {
      setActiveComposerSection("advanced");
      return;
    }
    if (readiness.remediationLabel === "Review preview") {
      document
        .querySelector<HTMLButtonElement>(
          '[role="dialog"][aria-label="Preview"] .secondary-action'
        )
        ?.focus();
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
    setError(undefined);
    setProfileSaveStatus("");
    try {
      const result = await window.agentEnv.applyProfile(draftProfile.id, preview.id, {
        allowManagedDrift: replaceManagedDrift,
        allowOmissions: acceptCrossTargetOmissions
      });
      if (!result.ok) {
        setError(result.errors.join("\n"));
        return;
      }
      setPreview(undefined);
      setRollbackPreview(undefined);
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const adoptLiveInstructions = async () => {
    if (!draftProfile || !selectedTarget) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await window.agentEnv.adoptTargetInstructions(
        draftProfile.id,
        selectedTarget.id
      );
      setDraftProfile(saved);
      setIsProfileDirty(false);
      setPreview(undefined);
      setProfileSaveStatus("Live instructions adopted into Profile");
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
      const result = await window.agentEnv.importSkillToLibrary({ sourcePath });
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles();
      setSkillUpdateCheckStatus({
        state: "success",
        message:
          result.managedLocations.length > 0
            ? `Imported ${result.skill.name} · Local copy is now managed`
            : `Imported ${result.skill.name} to Library`
      });
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const importExternalSkill = async (skill: SkillInventoryEntry) => {
    setBusy(true);
    setError(undefined);
    try {
      await window.agentEnv.importSkillToLibrary({
        sourcePath: skill.path,
        id: skill.skillKey,
        upstream: skill.externalOwnership?.upstream,
        provenance: {
          importedVia: "local-scan",
          externalManager: "skills-cli",
          externalLockPath: skill.externalOwnership?.lockPath
        }
      });
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles();
      setSkillUpdateCheckStatus({
        state: "success",
        message: `Imported ${skill.name} to Library`
      });
      return true;
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateLibrarySkill = async (id: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await window.agentEnv.updateLibrarySkill(id);
      setSelectedSkillUpdatePlan(undefined);
      const { skillUpdateItems } = await refreshProfiles();
      setSkillUpdateCheckStatus(summarizeSkillUpdateResult(id, skillUpdateItems, t));
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

  const reviewMcpUsage = (id: string) => {
    const firstProfileName = mcpUsage[id]?.[0];
    const profile = profiles.find((item) => item.name === firstProfileName);
    if (profile) {
      selectProfile(profile.id, "mcp");
    } else {
      setActiveWorkspace("profiles");
    }
  };

  const updateAllLibrarySkills = async (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }

    setBusy(true);
    setError(undefined);
    setBulkSkillUpdatePlans(undefined);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => window.agentEnv.updateLibrarySkill(id))
      );
      const failures = results.filter((result): result is PromiseRejectedResult =>
        result.status === "rejected"
      );
      setSelectedSkillUpdatePlan(undefined);
      const { skillUpdateItems } = await refreshProfiles();
      if (failures.length === 0) {
        setSkillUpdateCheckStatus({
          state: "success",
          message:
            skillUpdateItems.filter((update) => update.updateAvailable && !update.error).length > 0
              ? `Updated ${plural(ids.length, "skill")} · More updates remain`
              : `Updated ${plural(ids.length, "skill")} · All tracked skills are up to date`
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
      const { skillUpdateItems } = await refreshProfiles();
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

  const importGitHubSkills = async (
    inputs: GitHubSkillImportInput[]
  ): Promise<GitHubSkillImportResult> => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await window.agentEnv.importGitHubSkills(inputs);
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles({ checkSkillUpdates: false });
      if (result.imported.length > 0) {
        setSkillUpdateCheckStatus({
          state: result.failed.length > 0 ? "info" : "success",
          message:
            result.failed.length > 0
              ? `Imported ${result.imported.length} · ${result.failed.length} failed`
              : `Imported ${result.imported.length} ${result.imported.length === 1 ? "skill" : "skills"}`
        });
      }
      return result;
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      throw unknownError;
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
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      setSkillUpdateCheckStatus(undefined);
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
    try {
      await window.agentEnv.rollbackSkillCleanup(backupId);
      setSkillCleanupResult(undefined);
      await refreshProfiles();
      setSkillUpdateCheckStatus({
        state: "success",
        message: restoringRemoval ? "Skill removal undone" : "Skill cleanup undone"
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
      await window.agentEnv.setSkillUpdateSource(input);
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles();
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
      await window.agentEnv.setSkillUpdatePolicy(input);
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles();
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
      await window.agentEnv.setSkillIcon(input);
      await refreshSkills();
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
      await refreshProfiles({ settingsOverride: nextSettings });
      setSettingsSaveStatus("Settings saved");
    } catch (unknownError) {
      setSettingsSaveStatus("");
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const createAgentEnvDataBackup = async () => {
    setBusy(true);
    setError(undefined);
    setDataBackupStatus("Creating data backup");
    try {
      const result = await window.agentEnv.createDataBackup();
      setDataBackupStatus(result ? `Data backup created at ${result.path}` : "");
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
      const firstProfile = refreshed.profileItems[0];
      if (firstProfile) {
        setSelectedProfileId(firstProfile.id);
        setSelectedTargetId(firstProfile.targetId);
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
      await refreshProfiles();
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
        if (result?.state === "slow-down") {
          delayMs += 5000;
        }
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

  const saveMcpServer = async (input: SaveMcpServerInput) => {
    setBusy(true);
    setError(undefined);
    try {
      await window.agentEnv.saveMcpServer(input);
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      throw unknownError;
    } finally {
      setBusy(false);
    }
  };

  const removeMcpServer = async (id: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await window.agentEnv.removeMcpServer(id);
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
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
    : profileCaptureStatus
      ? { kind: "success", title: profileCaptureStatus }
    : skillCleanupResult
      ? {
          kind: "success",
          title:
            skillCleanupResult.operation === "remove"
              ? t("Removed {{id}}", { id: skillCleanupResult.libraryId })
              : skillCleanupResult.operation === "retire"
                ? t("Replaced shared copy for {{id}}", { id: skillCleanupResult.libraryId })
                : skillCleanupResult.libraryCreated
                  ? t("Added {{id}} to Library", { id: skillCleanupResult.libraryId })
                  : t("Managed copies for {{id}}", { id: skillCleanupResult.libraryId }),
          message:
            skillCleanupResult.operation === "remove"
              ? skillCleanupResult.managedLocations.length === 0
                ? t("Removed from the Library. No Target installs were affected.")
                : t("Removed from the Library and {{count}} managed Target installs.", {
                    count: skillCleanupResult.managedLocations.length
                  })
              : t("{{count}} local copies were updated. A restorable backup is available in History.", {
                  count: skillCleanupResult.managedLocations.length
                }),
          action: {
            label: skillCleanupResult.operation === "remove" ? "Undo removal" : "Undo cleanup",
            onClick: () => void undoSkillCleanup()
          }
        }
    : skillRefreshStatus
      ? {
          kind: skillRefreshStatus === "refreshing" ? "loading" : "success",
          title: skillRefreshStatus === "refreshing" ? "Refreshing skills" : "Skills refreshed"
        }
    : targetRefreshStatus
      ? {
          kind: targetRefreshStatus === "refreshing" ? "loading" : "success",
          title: targetRefreshStatus === "refreshing" ? "Refreshing targets" : "Targets refreshed"
        }
    : skillUpdateCheckStatus
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
      : profileSaveStatus
        ? {
            kind: profileSaveStatus === "Profile saved" ? "success" : "info",
            title: profileSaveStatus
          }
        : dataBackupStatus
          ? {
              kind: dataBackupStatus === "Creating data backup" ? "loading" : "success",
              title: dataBackupStatus
            }
        : settingsSaveStatus
          ? {
              kind: settingsSaveStatus === "Settings saved" ? "success" : "loading",
              title: settingsSaveStatus
            }
        : undefined;
  const profileApplyControl = (
    <div className="profile-apply-control" ref={profileApplyControlRef}>
      <button
        className="profile-apply-button"
        type="button"
        aria-describedby="profile-apply-description"
        title={t(applyActionLabel)}
        disabled={applyDisabled}
        onClick={previewSelectedProfile}
      >
        {selectedTargetIcon?.assetUrl ? (
          <img
            className={`profile-target-logo profile-target-logo--${selectedTargetIcon.flavor}`}
            src={selectedTargetIcon.assetUrl}
            alt=""
          />
        ) : (
          <Monitor size={17} strokeWidth={2.2} aria-hidden="true" />
        )}
        <strong>
          {t("Apply")}
        </strong>
      </button>
      <span id="profile-apply-description" hidden>{applyDescription}</span>
    </div>
  );
  const targetWorkspaceControl = installedTargets.length === 1 && selectedTarget ? (
    <div
      className="profile-target-workspace-button is-static"
      aria-label={t("Current target {{name}}", { name: selectedTarget.name })}
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
        aria-label={t("Select apply target")}
        title={t("Select apply target")}
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
        <div className="profile-target-menu" role="menu" aria-label={t("Apply targets")}>
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
        activeLibraryTab={activeLibraryTab}
        onWorkspaceSelect={selectWorkspace}
        onLibraryTabSelect={selectLibraryTab}
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
        <AppFeedback feedback={appFeedback} onDismiss={dismissAppFeedback} />
        {activeWorkspace === "library" ? (
          <>
            <header className="page-header library-page-header">
              <div>
                <h2 aria-label={`${t("Library")}/${t(activeLibraryTab === "skills" ? "Skills" : "MCP Servers")}`}>
                  <span>{t("Library")}</span>
                  <span className="breadcrumb-separator">/</span>
                  <span>{t(activeLibraryTab === "skills" ? "Skills" : "MCP Servers")}</span>
                  <InfoTip label={t("Library is the shared resource layer. Profiles reference these skills and MCP servers instead of duplicating files in every profile.")} />
                </h2>
              </div>
              <div className="page-actions">
                {activeLibraryTab === "skills" ? (
                  <>
                    <button
                      className="primary-inline-action"
                      type="button"
                      aria-label={t("Import skills")}
                      onClick={() => setSkillLibraryTool("import")}
                    >
                      <Plus size={16} strokeWidth={2.4} />
                      {t("Import")}
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => {
                        void openSkillDiscoveries();
                      }}
                    >
                      <ScanLine size={15} strokeWidth={2.2} />
                      {t("Scan local")}
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      aria-label={t("Refresh skills")}
                      disabled={skillRefreshStatus === "refreshing"}
                      onClick={() => {
                        void refreshSkills();
                      }}
                    >
                      <RefreshCw
                        className={skillRefreshStatus === "refreshing" ? "is-spinning" : ""}
                        size={15}
                        strokeWidth={2.2}
                      />
                      {t("Refresh")}
                    </button>
                  </>
                ) : (
                  <button
                    ref={mcpCreateButtonRef}
                    className="primary-inline-action"
                    type="button"
                    onClick={() => setMcpCreateRequest((current) => current + 1)}
                  >
                    <Plus size={16} strokeWidth={2.4} />
                    {t("Add MCP server")}
                  </button>
                )}
              </div>
            </header>
            {activeLibraryTab === "mcp" ? (
              <section
                className="metric-strip metric-strip--compact metric-strip--mcp"
                aria-label={t("Library summary")}
              >
                <div className="metric-tile">
                  <span className="metric-icon metric-icon--purple" aria-hidden="true">
                    <Network size={21} strokeWidth={2.2} />
                  </span>
                  <div>
                    <strong>{mcpServers.length}</strong>
                    <small>{t("MCP Servers")}</small>
                    <span>{t("Shared across profiles")}</span>
                  </div>
                </div>
                <div className="metric-tile">
                  <span className="metric-icon metric-icon--amber" aria-hidden="true"><FolderKanban size={21} strokeWidth={2.2} /></span>
                  <div><strong>{Object.keys(mcpUsage).length}</strong><small>{t("In use")}</small><span>{t("Across {{count}} profiles", { count: profiles.length })}</span></div>
                </div>
                <div className="metric-tile">
                  <span className="metric-icon metric-icon--blue" aria-hidden="true"><MonitorCheck size={21} strokeWidth={2.2} /></span>
                  <div><strong>{readyTargetCount}</strong><small>{t("Ready targets")}</small><span>{t("{{ready}}/{{total}} available", { ready: readyTargetCount, total: targets.length || 0 })}</span></div>
                </div>
              </section>
            ) : null}
            {activeLibraryTab === "skills" ? (
              <SkillLibraryPanel
                isLoading={isLoading}
                librarySkills={librarySkills}
                skillUpdates={skillUpdates}
                skillInventory={skillInventory}
                cleanupBackups={skillCleanupBackups}
                selectedUpdatePlan={selectedSkillUpdatePlan}
                bulkUpdatePlans={bulkSkillUpdatePlans}
                skillUsage={skillUsage}
                installedTargetIds={targets
                  .filter((target) => target.health.executableFound)
                  .map((target) => target.id)}
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
                onManageTargetSkill={manageTargetSkill}
                onConsolidateSkillGroup={(input) => void consolidateSkillGroup(input)}
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
                onReviewSkillUsage={reviewSkillUsage}
                onCheckUpdates={checkSkillUpdates}
                onOpenSource={(url) => {
                  void window.agentEnv.openExternalUrl(url).catch((unknownError) => {
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
            ) : (
              <McpLibraryPanel
                mcpServers={mcpServers}
                mcpUsage={mcpUsage}
                createRequest={mcpCreateRequest}
                createTriggerRef={mcpCreateButtonRef}
                viewState={mcpLibraryViewState}
                onViewStateChange={(next) => {
                  libraryScroll.resetScrollNow();
                  setMcpLibraryViewState(next);
                }}
                searchInputRef={mcpSearchInputRef}
                scrollOwnerRef={libraryScroll.setScrollOwner}
                onSave={saveMcpServer}
                onRemove={removeMcpServer}
                onReviewUsage={reviewMcpUsage}
              />
            )}
          </>
        ) : activeWorkspace === "profiles" ? (
          <>
            <header className="page-header profile-page-header">
              <div className="profile-page-heading">
                <h2 aria-label={t("Profiles")}>{t("Profiles")}</h2>
                <p>{t("Compose reusable environments and apply them safely to local agent targets.")}</p>
              </div>
              <div className="profile-page-actions" ref={profilePageActionsRef}>
                {targetWorkspaceControl}
                <button
                  className="profile-new-button"
                  type="button"
                  onClick={openCreateProfileDialog}
                >
                  <Plus size={15} strokeWidth={2.3} aria-hidden="true" />
                  {t("New Profile")}
                </button>
              </div>
            </header>
            <section className="profile-workbench" aria-label={t("Profiles")}>
              <aside className="profile-index" aria-label={t("Profile list")}>
                <div className="profile-list-toolbar">
                  <label className="profile-search">
                    <Search size={15} strokeWidth={2.2} aria-hidden="true" />
                    <input
                      ref={profileSearchInputRef}
                      aria-label={t("Search profiles")}
                      placeholder={t("Search Profile name...")}
                      value={profileSearch}
                      onChange={(event) => setProfileSearch(event.currentTarget.value)}
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
                    const counts = profileResourceCounts[profile.id];
                    const profileApplications = listProfileApplications(
                      profile.id,
                      targetStates,
                      targets
                    );
                    const isSelected = profile.id === selectedProfileId;
                    const profileIconKey =
                      (isSelected ? draftProfile?.manifest.iconKey : undefined) ??
                      profile.iconKey ??
                      "folder";
                    return (
                      <div
                        className={`profile-row${isSelected ? " is-active" : ""}`}
                        key={profile.id}
                        role="group"
                        aria-label={t("Profile {{name}}", { name: profile.name })}
                      >
                      <ResourceIconPicker
                        className="profile-row__icon"
                        iconKey={profileIconKey}
                        label={profile.name}
                        triggerLabel={t("Change icon for profile {{id}}", { id: profile.id })}
                        onChange={(iconKey) => changeProfileIcon(profile.id, iconKey)}
                      />
                      <button
                        className="profile-row__content"
                        type="button"
                        aria-current={isSelected ? "page" : undefined}
                        onClick={() => selectProfile(profile.id)}
                      >
                        <span className="profile-row__title">
                          <span className="profile-row__name">{profile.name}</span>
                          {isSelected && isProfileDirty ? <strong>{t("Unsaved")}</strong> : null}
                          {profile.id === currentProfileId && !(isSelected && isProfileDirty) ? (
                            <strong className="profile-row__current">{t("Current")}</strong>
                          ) : null}
                        </span>
                        <small title={profile.description || t("No description")}>
                          {profile.description || t("No description")}
                        </small>
                        <span className="profile-row__stats">
                          <span>{t("{{count}} skills", { count: counts?.skills.count ?? 0 })}</span>
                          <span>{counts?.mcp.count ?? 0} MCP</span>
                          <span>{t("{{count}} files", { count: counts?.instructions.count ?? 0 })}</span>
                        </span>
                        <span
                          className={`profile-row__deployments${profileApplications.length === 0 ? " profile-row__deployments--empty" : ""}`}
                          aria-label={
                            profileApplications.length > 0
                              ? t("Active on: {{targets}}", { targets: profileApplications.map((application) => application.target?.name ?? application.state.targetId).join(", ") })
                              : t("Not active")
                          }
                        >
                          {profileApplications.length === 0 ? (
                            <span>{t("Not active")}</span>
                          ) : profileApplications.map((application) => {
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
                      </button>
                      </div>
                    );
                  })}
                </div>
              </aside>
              <div className="profile-editor-surface">
                {draftProfile ? (
                  <>
                    <header className="profile-hero">
                      <ResourceIconPicker
                        className="profile-hero__icon"
                        iconKey={draftProfile.manifest.iconKey ?? "folder"}
                        label={draftProfile.manifest.name}
                        triggerLabel={t("Change icon for profile {{id}}", { id: draftProfile.id })}
                        onChange={(iconKey) =>
                          updateDraftProfile({
                            ...draftProfile,
                            manifest: { ...draftProfile.manifest, iconKey }
                          })
                        }
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
                          <span className="success-pill">
                            {t("Native: {{name}}", { name: profileTarget?.name ?? draftProfile.manifest.targetId })}
                          </span>
                          {selectedTarget && selectedTarget.id !== profileTarget?.id ? (
                            <span className="profile-hero__destination">
                              <ArrowRight size={13} strokeWidth={2.2} aria-hidden="true" />
                              {t("Deploying to {{name}}", { name: selectedTarget.name })}
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
                              disabled={busy || !isProfileDirty}
                              onClick={saveSelectedProfile}
                            >
                              {t("Save")}
                            </button>
                          </div>
                          {profileApplyControl}
                          <button
                            ref={profileActionsButtonRef}
                            className="icon-action"
                            type="button"
                            aria-expanded={isProfileActionsOpen}
                            aria-haspopup="menu"
                            aria-label={t("More profile actions")}
                            title={t("More profile actions")}
                            onClick={() => {
                              setIsTargetMenuOpen(false);
                              setIsProfileActionsOpen((current) => !current);
                            }}
                          >
                            <MoreHorizontal size={16} strokeWidth={2.2} />
                          </button>
                          {isProfileActionsOpen ? (
                            <div className="profile-actions-menu" role="menu" aria-label={t("Profile actions")}>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setIsProfileActionsOpen(false);
                                  openEditProfileDialog();
                                }}
                              >
                                <Pencil size={15} strokeWidth={2.2} aria-hidden="true" />
                                <span>{t("Edit profile")}</span>
                              </button>
                              <button type="button" role="menuitem" onClick={duplicateSelectedProfile}>
                                <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
                                <span>{t("Duplicate profile")}</span>
                              </button>
                              <button
                                className="is-danger"
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setIsProfileActionsOpen(false);
                                  openDeleteProfileDialog();
                                }}
                              >
                                <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
                                <span>{t("Delete profile")}</span>
                              </button>
                            </div>
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
                              <ArrowRight size={12} strokeWidth={2.3} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </header>
            <section className="profile-composer" aria-label={t("Profile composer")}>
              <ProfileComposerSection
                id="instructions"
                icon={<BookOpenText size={18} strokeWidth={2.2} />}
                title={t("Instructions")}
                description={t("Agent instructions and rule files")}
                count={resourceSummary?.instructions.count ?? 0}
                chipNames={
                  resourceSummary?.instructions.count
                    ? [profileTarget?.instructionsLabel ?? t("Instructions")]
                    : []
                }
                expanded={activeComposerSection === "instructions"}
                onToggle={() => toggleComposerSection("instructions")}
              >
                <AgentsEditor
                  label={profileTarget?.instructionsLabel ?? t("Instructions")}
                  value={draftProfile.instructions}
                  onChange={(instructions) => {
                    updateDraftProfile({ ...draftProfile, instructions });
                  }}
                />
              </ProfileComposerSection>
              <ProfileComposerSection
                id="skills"
                icon={<Database size={18} strokeWidth={2.2} />}
                title={t("Skills")}
                description={t("Reusable skills and workflows")}
                count={resourceSummary?.skills.count ?? 0}
                chipNames={resourceSummary?.skills.names ?? []}
                expanded={activeComposerSection === "skills"}
                onToggle={() => toggleComposerSection("skills")}
              >
                <SkillsEditor
                  mode="skills"
                  value={draftProfile.assetPolicy ?? emptyAssetPolicy}
                  configText={draftProfile.configText}
                  configLanguage={profileTarget?.configLanguage}
                  preview={preview}
                  librarySkills={librarySkills}
                  skillUpdates={skillUpdates}
                  checkingSkillUpdates={checkingProfileSkillUpdates}
                  mcpServers={mcpServers}
                  onCheckSkillUpdates={(ids) => void checkProfileSkillUpdates(ids)}
                  onPreviewSkillUpdate={(id) => void previewLibrarySkillUpdate(id)}
                  onChange={(assetPolicy) => {
                    updateDraftProfile({ ...draftProfile, assetPolicy });
                  }}
                />
              </ProfileComposerSection>
              <ProfileComposerSection
                id="mcp"
                icon={<Network size={18} strokeWidth={2.2} />}
                title={t("MCP Servers")}
                description={t("External tools and service connections")}
                count={resourceSummary?.mcp.count ?? 0}
                chipNames={resourceSummary?.mcp.names ?? []}
                expanded={activeComposerSection === "mcp"}
                onToggle={() => toggleComposerSection("mcp")}
              >
                <SkillsEditor
                  mode="mcp"
                  value={draftProfile.assetPolicy ?? emptyAssetPolicy}
                  configText={draftProfile.configText}
                  configLanguage={profileTarget?.configLanguage}
                  preview={preview}
                  librarySkills={librarySkills}
                  mcpServers={mcpServers}
                  onChange={(assetPolicy) => {
                    updateDraftProfile({ ...draftProfile, assetPolicy });
                  }}
                />
              </ProfileComposerSection>
              <ProfileComposerSection
                id="advanced"
                icon={<Settings2 size={18} strokeWidth={2.2} />}
                title={t("Advanced")}
                description={t("Raw config, overrides, validation, and history")}
                count={draftProfile.assetPolicy.disabledSkillPaths.length}
                chipNames={draftProfile.assetPolicy.disabledSkillPaths}
                expanded={activeComposerSection === "advanced"}
                onToggle={() => toggleComposerSection("advanced")}
              >
                {selectedTarget && profileTarget && selectedTarget.id !== profileTarget.id ? (
                  <div className="native-config-notice" role="note">
                    <strong>{t("{{name}}-only configuration", { name: profileTarget.name })}</strong>
                    <span>{t("This section is saved with the Profile but omitted when applying to {{name}}.", { name: selectedTarget.name })}</span>
                  </div>
                ) : null}
                <McpEditor
                  label={t("{{name}}-only {{config}}", { name: profileTarget?.name ?? t("Native"), config: profileTarget?.configLabel ?? t("config") })}
                  value={draftProfile.configText}
                  onChange={(configText) => {
                    updateDraftProfile({ ...draftProfile, configText });
                  }}
                />
                <SkillsEditor
                  mode="advanced"
                  value={draftProfile.assetPolicy ?? emptyAssetPolicy}
                  configText={draftProfile.configText}
                  configLanguage={profileTarget?.configLanguage}
                  preview={preview}
                  librarySkills={librarySkills}
                  mcpServers={mcpServers}
                  onChange={(assetPolicy) => {
                    updateDraftProfile({ ...draftProfile, assetPolicy });
                  }}
                />
                <section className="validation-panel" aria-label={t("Validation")}>
                  <div className="section-title">{t("Validation")}</div>
                  <div className="validation-grid">
                    {validationRows.map((row) => (
                      <div className={`check-row check-row--${row.level}`} key={row.label}>
                        <span>
                          {t(row.label)}
                          {row.detail ? <small>{t(row.detail)}</small> : null}
                        </span>
                        <strong>{t(row.value)}</strong>
                      </div>
                    ))}
                  </div>
                  {preview?.warnings.map((item) => (
                    <p className="warning" key={item}>
                      {item}
                    </p>
                  ))}
                  {preview?.errors.map((item) => (
                    <p className="error" key={item}>
                      {item}
                    </p>
                  ))}
                </section>
                <HistoryView
                  backups={backups.filter(
                    (backup) =>
                      backup.profileId === draftProfile.id &&
                      backup.targetId === selectedTarget?.id
                  )}
                  busy={busy}
                  rollbackPreview={undefined}
                  onPreviewRollback={previewSelectedRollback}
                  onRestoreRollback={restoreSelectedRollback}
                />
              </ProfileComposerSection>
            </section>
            {rollbackPreview ? (
              <PreviewDialog
                preview={rollbackPreview}
                title={t("Rollback preview")}
                confirmLabel={t("Restore backup")}
                confirmDisabled={busy || rollbackPreview.errors.length > 0}
                cancelDisabled={busy}
                errorMessage={rollbackError}
                onCancel={busy
                  ? undefined
                  : () => {
                      setRollbackPreview(undefined);
                      setRollbackError(undefined);
                    }}
                onConfirm={restoreSelectedRollback}
              />
            ) : null}
            {preview ? (
              <PreviewDialog
                preview={preview}
                title={t("Apply preview for {{name}}", { name: activeTargetName })}
                confirmLabel={t(replaceManagedDrift ? "Back up and replace" : "Apply profile")}
                confirmDisabled={!canApply || busy}
                managedDriftAcknowledged={replaceManagedDrift}
                onManagedDriftAcknowledgedChange={setReplaceManagedDrift}
                omissionsAcknowledged={acceptCrossTargetOmissions}
                onOmissionsAcknowledgedChange={setAcceptCrossTargetOmissions}
                onOpenRecovery={() => {
                  setPreview(undefined);
                  setActiveComposerSection("advanced");
                }}
                onAdoptInstructions={
                  draftProfile.manifest.targetId === selectedTarget?.id
                    ? adoptLiveInstructions
                    : undefined
                }
                onCancel={() => {
                  setReplaceManagedDrift(false);
                  setAcceptCrossTargetOmissions(false);
                  setPreview(undefined);
                }}
                onConfirm={applySelectedProfile}
              />
            ) : null}
            <SkillUpdateDialog
              plan={selectedSkillUpdatePlan}
              impact={selectedSkillUpdateImpact}
              busy={busy}
              onClose={() => setSelectedSkillUpdatePlan(undefined)}
              onConfirm={(id) => void updateLibrarySkill(id)}
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
                                  const nextTarget = currentTarget?.health.executableFound
                                    ? currentTarget
                                    : targets.find((target) => target.health.executableFound);
                                  if (nextTarget) {
                                    setProfileForm((current) => ({
                                      ...current,
                                      targetId: nextTarget.id,
                                      name: current.name.trim() || `${nextTarget.name} Current`
                                    }));
                                  }
                                }}
                              >
                                {t("From Target")}
                              </button>
                            </div>
                          ) : null}
                          <label>
                            <span>{t("Native Target")}</span>
                            <select
                              aria-label={t("Profile target")}
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
              {deleteProfileDialogOpen && draftProfile ? (
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
                          {isSelectedProfileActive
                            ? t("{{name}} is active on {{targets}}. Apply another profile or stop managing each Target before removing it.", { name: draftProfile.manifest.name, targets: selectedProfileActiveTargets.join(", ") })
                            : t("Remove {{name}}? Applied target files and backups are not removed.", { name: draftProfile.manifest.name })}
                        </p>
                      </div>
                    </header>
                    <footer className="preview-actions">
                      <button ref={appModalInitialFocusRef} className="secondary-action" type="button" disabled={busy} onClick={closeProfileDialog}>
                        {t("Cancel")}
                      </button>
                      {!isSelectedProfileActive ? (
                        <button className="danger-action" type="button" disabled={busy} onClick={deleteSelectedProfile}>
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
                          {t("Open Targets")}
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
            <header className="page-header">
              <div>
                <h2 aria-label={t("Settings")}>{t("Settings")}</h2>
                <p>{t("Local defaults and connected services.")}</p>
              </div>
            </header>
            <section className="resource-section settings-section" aria-labelledby="appearance-heading">
              <div className="settings-section-title">
                <div>
                  <div className="resource-heading" id="appearance-heading">{t("Appearance")}</div>
                  <p className="settings-muted">{t("Choose how AgentEnv Manager displays its interface.")}</p>
                </div>
              </div>
              <div className="resource-settings-grid resource-settings-grid--single">
                <label>
                  <span>{t("Language")}</span>
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
                  <small className="settings-field-note">
                    {t("Uses your system language until you choose another language.")}
                  </small>
                </label>
              </div>
            </section>
            <section className="resource-section settings-section" aria-labelledby="library-defaults-heading">
              <div className="settings-section-title">
                <div>
                  <div className="resource-heading" id="library-defaults-heading">{t("Skills library")}</div>
                  <p className="settings-muted">{t("Defaults used when installing managed skills.")}</p>
                </div>
              </div>
              <div className="resource-settings-grid">
                <label>
                  <span>{t("Sync")}</span>
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
                  <small className="settings-field-note">
                    {skillSettings.skillSyncMethod === "copy"
                      ? t("Library updates stay pending until installs are explicitly synchronized.")
                      : skillSettings.skillSyncMethod === "auto"
                        ? t("Uses live links when supported and falls back to copied installs.")
                        : t("Library updates immediately change linked Target skills without another Apply preview.")}
                  </small>
                </label>
                <label>
                  <span>{t("Storage")}</span>
                  <div className="settings-readonly-value" aria-label={t("Global skill storage location")}>
                    {t("AgentEnv data")}
                  </div>
                </label>
                <div className="settings-auto-check-row">
                  <div className="settings-auto-check-main">
                    <span className="settings-auto-check-copy">
                      <span className="settings-auto-check-title">
                        <strong>{t("Auto-check")}</strong>
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
                      </span>
                      <small>{t("Checks only skills that have per-skill update checks enabled.")}</small>
                    </span>
                  </div>
                  <label className="settings-interval-field">
                    <span>{t("Check interval")}</span>
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
              </div>
            </section>
            <section className="resource-section settings-section" aria-labelledby="agentenv-data-heading">
              <div className="settings-section-header settings-data-header">
                <div>
                  <div className="resource-heading" id="agentenv-data-heading">{t("AgentEnv data")}</div>
                  <p className="settings-muted">{t("Profiles, Library resources, deployment state, and recovery backups.")}</p>
                </div>
                <div className="settings-data-actions">
                  <button className="secondary-action" type="button" disabled={busy} onClick={() => void window.agentEnv.openDataFolder()}>
                    <FolderKanban size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t("Open folder")}
                  </button>
                  <button className="secondary-action" type="button" disabled={busy} onClick={() => void createAgentEnvDataBackup()}>
                    <HardDrive size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t("Create backup")}
                  </button>
                  <button className="secondary-action" type="button" disabled={busy} onClick={() => void selectAgentEnvDataRestore()}>
                    <RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" />
                    {t("Restore backup")}
                  </button>
                </div>
              </div>
              <code className="settings-data-path">~/.config/agentenv-manager</code>
              <p className="settings-field-note">{t("Backups are private directory snapshots. GitHub credentials remain encrypted for this Mac.")}</p>
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
          <PreviewDialog preview={rollbackPreview} title={t("Rollback preview")} />
        ) : (
          <div className="empty-state">
            <h2>{t("No profile selected")}</h2>
          </div>
        )}
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
