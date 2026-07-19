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
  RetireSharedSkillInput,
  SharedSkillRetentionInput,
  McpLibraryEntry,
  SaveMcpServerInput,
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
import { AgentsEditor } from "./components/AgentsEditor";
import { AgentSettingsSection } from "./components/AgentSettingsSection";
import { DiffViewer } from "./components/DiffViewer";
import { HistoryView } from "./components/HistoryView";
import { InfoTip } from "./components/InfoTip";
import { OverflowTooltip } from "./components/OverflowTooltip";
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
import {
  defaultMcpLibraryViewState,
  defaultSkillLibraryViewState,
  updateLibraryScroll
} from "./libraryViewState";
import { useLibraryScrollRestoration } from "./hooks/useLibraryScrollRestoration";
import { useModalDialog } from "./hooks/useModalDialog";
import { useDesktopShortcuts } from "./hooks/useDesktopShortcuts";
import {
  compareProfilesByCreationTime,
  listProfileApplications,
  preferredTargetForProfile,
  summarizeProfile,
  type ProfileResourceSummary
} from "./profileSummary";
import { createTargetNameIndex } from "./targetPresentation";

const emptyAssetPolicy: AssetPolicy = {
  ownedDirs: [],
  ownedFiles: [],
  skillRefs: [],
  mcpRefs: [],
  disabledSkillPaths: []
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

type ComposerSection = "instructions" | "skills" | "mcp" | "advanced";
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

  return { value: "Pending", detail: "Preview checks this Agent format", level: "pending" };
};

const createValidationRows = (
  profile: ProfileDetail,
  target?: TargetInfo,
  preview?: ActivationPreview,
  profileTarget: TargetDescriptor | undefined = target
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
      label: profileTarget?.instructionsLabel ?? "Instructions",
      value: profile.manifest.managed.instructions
        ? profile.instructions.trim().length > 0
          ? "OK"
          : "Empty"
        : "Disabled",
      detail:
        profile.manifest.managed.instructions && profile.instructions.trim().length === 0
          ? "Applying this Profile clears managed instructions"
          : undefined,
      level:
        profile.manifest.managed.instructions && profile.instructions.trim().length === 0
          ? "warning"
          : "ok"
    },
    {
      ...configValidation,
      label: `${profileTarget?.name ?? "Native"} native config`,
      detail:
        target && profileTarget && target.id !== profileTarget.id
          ? `Only applied when the destination Agent is ${profileTarget.name}`
          : configValidation.detail
    },
    {
      label: `${target?.name ?? "Agent"} compatibility`,
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
          : "Native configuration is supported by this Agent",
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
          ? "Preview verifies source directories and Agent ownership"
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
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [librarySkills, setLibrarySkills] = useState<SkillLibraryEntry[]>([]);
  const [mcpServers, setMcpServers] = useState<McpLibraryEntry[]>([]);
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
  const [mcpUsage, setMcpUsage] = useState<Record<string, string[]>>({});
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [profileTargetSelections, setProfileTargetSelections] = useState<Record<string, string>>({});
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [preview, setPreview] = useState<ActivationPreview>();
  const [replaceProtectedTargetChanges, setReplaceProtectedTargetChanges] = useState(false);
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
  const [importingOwnedSkillIndex, setImportingOwnedSkillIndex] = useState<number>();
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
  const backupManagerReturnFocusRef = useRef<HTMLElement | null>(null);
  const appModalDialogRef = useRef<HTMLElement>(null);
  const appModalInitialFocusRef = useRef<HTMLButtonElement>(null);
  const appModalFallbackFocusRef = useRef<HTMLElement>(null);
  const activeLibraryView = activeWorkspace === "library" ? activeLibraryTab : undefined;
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
    if (activeWorkspace !== "settings") return;
    void refreshManagedBackups();
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
    const corePromise = Promise.all([
      window.agentEnv.listSupportedTargets(),
      window.agentEnv.listTargets(forceTargetRefresh),
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
      supportedTargetItems,
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
        supportedTargetItems,
        targetItems,
        targetStateItems,
        profileItems,
        backupItems,
        skillItems,
        mcpItems,
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
    setMcpServers(mcpItems);
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
      mcpItems,
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
      mcpItems,
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
      const profileTarget = supportedTargetItems.find(
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
        const initialProfileTargetId = initialTargetId ?? initialProfile.targetId;
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
      const profileTargetId = preferredTargetForProfile(
        profile.id,
        profile.manifest.targetId,
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

  const importOwnedSkillToLibrary = async (
    index: number,
    asset: AssetPolicy["ownedDirs"][number]
  ) => {
    if (!draftProfile?.profileDir) {
      setError("This Profile has no local storage directory");
      return;
    }
    const baseId = asset.targetName
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile-skill";
    const sourcePath = `${draftProfile.profileDir.replace(/[\\/]+$/, "")}/${asset.source.replace(/^[\\/]+/, "")}`;

    setImportingOwnedSkillIndex(index);
    setError(undefined);
    try {
      const prepared = await prepareSkillImport({
        kind: "local",
        input: { sourcePath, id: baseId }
      });
      if (!prepared || prepared.kind !== "local") return;
      const result = await window.agentEnv.importSkillToLibrary(prepared.input);
      setPendingSkillImport(undefined);
      await refreshProfiles({ checkSkillUpdates: false });
      updateDraftProfile({
        ...draftProfile,
        assetPolicy: {
          ...draftProfile.assetPolicy,
          ownedDirs: draftProfile.assetPolicy.ownedDirs.filter(
            (_, currentIndex) => currentIndex !== index
          ),
          skillRefs: (draftProfile.assetPolicy.skillRefs ?? []).concat({
            libraryId: result.skill.id,
            targetName: asset.targetName,
            enabled: true
          })
        }
      });
      setSkillUpdateCheckStatus({
        state: "success",
        message: result.sourceUpdated
          ? t("Updated the tracked source for {{name}}. Save the Profile to use this reference.", {
              name: result.skill.name
            })
          : result.reused
          ? t("Using the existing {{name}} Library entry. Save the Profile to use this reference.", {
              name: result.skill.name
            })
          : t("{{name}} imported to Library. Save the Profile to use this reference.", {
              name: result.skill.name
            })
      });
    } catch (unknownError) {
      setPendingSkillImport(undefined);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setImportingOwnedSkillIndex(undefined);
    }
  };

  const acceptProfileMetadata = (saved: ProfileDetail, previousName: string) => {
    const summary: ProfileSummary = {
      id: saved.id,
      targetId: saved.manifest.targetId,
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
    setMcpUsage((current) => reconcileProfileUsage(
      current,
      Object.keys(versions?.mcp ?? {}),
      Object.keys(versions?.mcp ?? {}),
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
        targetId: saved.manifest.targetId,
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
      const nativeTarget = targets.find(
        (target) => target.id === saved.manifest.targetId
      );
      if (nativeTarget) {
        setProfileResourceCounts((current) => ({
          ...current,
          [saved.id]: summarizeProfile(saved, nativeTarget, librarySkills)
        }));
      }
      setProfileLibraryVersions((current) => ({
        ...current,
        [saved.id]: collectLibraryResourceVersions(saved, librarySkills, mcpServers)
      }));
      setSkillUsage((current) => reconcileProfileUsage(
        current,
        Object.keys(previousLibraryVersions?.skills ?? {}),
        saved.assetPolicy.skillRefs.map((reference) => reference.libraryId),
        previousName,
        saved.manifest.name
      ));
      setMcpUsage((current) => reconcileProfileUsage(
        current,
        Object.keys(previousLibraryVersions?.mcp ?? {}),
        saved.assetPolicy.mcpRefs.map((reference) => reference.libraryId),
        previousName,
        saved.manifest.name
      ));
      setTargetStates((current) =>
        current.map((state) => {
          if (state.activeProfileId !== saved.id) return state;
          const expectedHash =
            saved.targetContentHashes?.[state.targetId] ??
            (saved.manifest.targetId === state.targetId ? saved.contentHash : undefined);
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
        setProfileTargetSelections((current) => ({
          ...current,
          [saved.id]: saved.manifest.targetId
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
      setProfileTargetSelections((current) => ({
        ...current,
        [saved.id]: saved.manifest.targetId
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
        setProfileTargetSelections((current) => ({
          ...current,
          [nextProfile.id]: nextProfile.targetId
        }));
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
    pendingSkillImport || pendingProfileAction || profileDialogMode || deleteProfileDialogOpen || dataRestorePreview || backupManagerOpen
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
        : profileDialogMode ?? (deleteProfileDialogOpen
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
  const installedTargets = targets.filter((target) => target.health.executableFound);
  const profileTarget = supportedTargets.find(
    (target) => target.id === draftProfile?.manifest.targetId
  );
  const normalizedProfileSearch = profileSearch.trim().toLowerCase();
  const visibleProfiles = profiles
    .filter((profile) => {
      if (normalizedProfileSearch.length === 0) {
        return true;
      }

      return `${profile.name} ${profile.description}`.toLowerCase().includes(normalizedProfileSearch);
    })
    .sort(compareProfilesByCreationTime);
  const activeTargetName = selectedTarget?.name ?? draftProfile?.manifest.targetId ?? "Agent";
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
    ? t(
        skillSettings.skillSyncMethod === "copy"
          ? "Updates the shared Library copy used by {{profiles}}. Copied Agent installs remain unchanged until their Profiles are applied."
          : "Updates the shared Library copy used by {{profiles}}. Linked Agent installs may change immediately after this update.",
        {
          profiles: plural(skillUsage[selectedSkillUpdatePlan.id]?.length ?? 0, "profile")
        }
      )
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
        row.level === "error" && row.label !== "Agent access" && row.label !== "Live conflicts"
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
  const previewReplaceableTargetPaths = new Set(preview?.replaceableTargetPaths ?? []);
  const previewHasOnlyReplaceableErrors = Boolean(
    preview &&
      preview.errors.length > 0 &&
      preview.errors.every((item) => {
        if (item.startsWith("External changes detected in AgentEnv-managed")) {
          return true;
        }
        const path = item.match(
          /^skill target already exists and is not AgentEnv-owned: (.+)$/i
        )?.[1];
        return Boolean(path && previewReplaceableTargetPaths.has(path));
      })
  );
  const canApply = Boolean(
    preview &&
      (preview.changes.length > 0 ||
        preview.resourceChanges.length > 0 ||
        preview.sharedSkillPreparationChanged ||
        preview.targetStateChanged) &&
      (preview.errors.length === 0 ||
        (previewHasOnlyReplaceableErrors && replaceProtectedTargetChanges)) &&
      (!preview.requiresOmissionAcknowledgement || acceptCrossTargetOmissions) &&
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
      const rendererBlockers = [
        ...(!selectedTarget?.health.canWrite
          ? [selectedTarget?.health.summary || `${selectedTarget?.name ?? "Agent"} is unavailable`]
          : []),
        ...localValidationErrors
      ];
      setReplaceProtectedTargetChanges(false);
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
    if (
      readiness.remediationLabel === "Open Advanced" ||
      readiness.remediationLabel === "Open Recovery"
    ) {
      setActiveComposerSection("advanced");
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
      const result = await window.agentEnv.applyProfile(draftProfile.id, preview.id, {
        allowManagedDrift: replaceProtectedTargetChanges,
        allowUnmanagedSkillReplacement: replaceProtectedTargetChanges,
        allowOmissions: acceptCrossTargetOmissions
      });
      if (!result.ok) {
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
          warningCount: preview.warnings.length,
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
            : kind === "config"
              ? "Advanced"
              : kind === "mcp"
                ? "MCP Servers"
                : "Disabled skills"
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

  const updateLibrarySkill = async (id: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const updated = await window.agentEnv.updateLibrarySkill(id);
      setSelectedSkillUpdatePlan(undefined);
      applyLibraryContentUpdatesLocally([updated]);
      setSkillUpdateCheckStatus(
        summarizeSkillUpdateResult(
          id,
          skillUpdates.filter((item) => item.id !== id),
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
      const updatedSkills = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      setSelectedSkillUpdatePlan(undefined);
      applyLibraryContentUpdatesLocally(updatedSkills);
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
    : skillRefreshStatus
      ? {
          kind: skillRefreshStatus === "refreshing" ? "loading" : "success",
          title: skillRefreshStatus === "refreshing" ? "Refreshing skills" : "Skills refreshed"
        }
    : targetRefreshStatus
      ? {
          kind: targetRefreshStatus === "refreshing" ? "loading" : "success",
          title: targetRefreshStatus === "refreshing" ? "Refreshing Agents" : "Agents refreshed"
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
        : dataBackupStatus
          ? {
              kind: dataBackupStatus === "Creating data export" ? "loading" : "success",
              title: dataBackupStatus
            }
        : settingsSaveStatus
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
        ) : selectedTargetIcon?.assetUrl ? (
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
            <PageHeader
              className="page-header library-page-header"
              title={t(activeLibraryTab === "skills" ? "Skills" : "MCP Servers")}
              help={<InfoTip label={t("Library is the shared resource layer. Profiles reference these skills and MCP servers instead of duplicating files in every profile.")} />}
              actions={(
                <ControlGroup className="page-actions" aria-label={t("Library actions")}>
                  {activeLibraryTab === "skills" ? (
                    <>
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
                        aria-label={t("Refresh skills")}
                        disabled={skillRefreshStatus === "refreshing"}
                        icon={(
                          <RefreshCw
                            className={skillRefreshStatus === "refreshing" ? "is-spinning" : ""}
                            size={15}
                            strokeWidth={2.2}
                          />
                        )}
                        onClick={() => {
                          void refreshSkills();
                        }}
                      >
                        {t("Refresh")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      ref={mcpCreateButtonRef}
                      className="primary-inline-action"
                      size="prominent"
                      variant="primary"
                      icon={<Plus size={16} strokeWidth={2.4} />}
                      onClick={() => setMcpCreateRequest((current) => current + 1)}
                    >
                      {t("Add MCP server")}
                    </Button>
                  )}
                </ControlGroup>
              )}
            />
            {activeLibraryTab === "skills" ? (
              <SkillLibraryPanel
                isLoading={isLoading}
                isBusy={busy}
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
            <PageHeader
              className="page-header profile-page-header"
              title={t("Profiles")}
              description={t("Compose reusable environments and apply them safely to local Agents.")}
              actions={(
                <div className="profile-page-actions" ref={profilePageActionsRef}>
                  <Button
                    className="profile-new-button is-primary"
                    size="prominent"
                    variant="primary"
                    icon={<Plus size={15} strokeWidth={2.3} />}
                    onClick={openCreateProfileDialog}
                  >
                    {t("New Profile")}
                  </Button>
                </div>
              )}
            />
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
                        </span>
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
                        onChange={(iconKey) => changeProfileIcon(draftProfile.id, iconKey)}
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
                          <span className="native-target-pill">
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
                          {profileApplyControl}
                          {targetWorkspaceControl}
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
                            <div className="profile-actions-menu ui-action-menu" role="menu" aria-label={t("Profile actions")}>
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
                              <span>{t(readiness.remediationLabel)}</span>
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
                  appliedSkillVersions={
                    selectedTargetState?.activeProfileId === draftProfile.id
                      ? selectedTargetState.appliedLibraryVersions?.skills
                      : undefined
                  }
                  selectedTargetName={selectedTarget?.name}
                  importingOwnedSkillIndex={importingOwnedSkillIndex}
                  mcpServers={mcpServers}
                  onCheckSkillUpdates={(ids) => void checkProfileSkillUpdates(ids)}
                  onPreviewSkillUpdate={(id) => void previewLibrarySkillUpdate(id)}
                  onImportOwnedSkill={(index, skill) => void importOwnedSkillToLibrary(index, skill)}
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
                description={t("Agent settings, validation, and recovery")}
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
                  label={t("{{name}} settings ({{config}})", { name: profileTarget?.name ?? t("Native"), config: profileTarget?.configLabel ?? t("config") })}
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
                  targetNames={targetNames}
                  onPreviewRollback={previewSelectedRollback}
                  onRestoreRollback={restoreSelectedRollback}
                />
              </ProfileComposerSection>
            </section>
            {rollbackPreview ? (
              <PreviewDialog
                preview={rollbackPreview}
                targetNames={targetNames}
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
                targetNames={targetNames}
                title={t("Apply preview for {{name}}", { name: activeTargetName })}
                confirmLabel={t(replaceProtectedTargetChanges ? "Back up and replace" : "Apply profile")}
                confirmDisabled={!canApply || busy}
                confirmBusy={isProfileApplying}
                replacementAcknowledged={replaceProtectedTargetChanges}
                onReplacementAcknowledgedChange={setReplaceProtectedTargetChanges}
                omissionsAcknowledged={acceptCrossTargetOmissions}
                onOmissionsAcknowledgedChange={setAcceptCrossTargetOmissions}
                onOpenRecovery={() => {
                  setPreview(undefined);
                  setActiveComposerSection("advanced");
                }}
                onAdoptTargetChanges={
                  draftProfile.manifest.targetId === selectedTarget?.id
                    ? adoptCompatibleTargetChanges
                    : undefined
                }
                onCancel={() => {
                  setReplaceProtectedTargetChanges(false);
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
                                {t("From Agent")}
                              </button>
                            </div>
                          ) : null}
                          <label>
                            <span>{t("Native format")}</span>
                            <select
                              aria-label={t("Profile native format")}
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
                            ? t("{{name}} is active on {{targets}}. Apply another profile or stop managing each Agent before removing it.", { name: draftProfile.manifest.name, targets: selectedProfileActiveTargets.join(", ") })
                            : t("Remove {{name}}? Applied Agent files and backups are not removed.", { name: draftProfile.manifest.name })}
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
                        : t("Library updates immediately change linked Agent Skills without another Apply preview.")}
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
                      <div><dt>{t("Source")}</dt><dd title={item.source}>{item.sourceType === "github" ? item.source : t("Local")}</dd></div>
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
