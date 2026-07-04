import { useEffect, useRef, useState } from "react";
import {
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
  Rocket,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
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
  ProfileDetail,
  ProfileSummary,
  RollbackPreview,
  SaveProfileInput,
  AgentEnvSettings,
  GitHubAuthStatus,
  GitHubDeviceLogin,
  GitHubDeviceLoginResult,
  ManageTargetSkillInput,
  McpLibraryEntry,
  SaveMcpServerInput,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdateSourceInput,
  TargetInfo,
  TargetManagementState
} from "../shared/types";
import { AgentsEditor } from "./components/AgentsEditor";
import { HistoryView } from "./components/HistoryView";
import { InfoTip } from "./components/InfoTip";
import { McpEditor } from "./components/McpEditor";
import { McpLibraryPanel } from "./components/McpLibraryPanel";
import { PreviewDialog } from "./components/PreviewDialog";
import { ProfileComposerSection } from "./components/ProfileComposerSection";
import {
  ProfileSidebar,
  targetIconFor,
  type AppWorkspace,
  type LibraryTab
} from "./components/ProfileSidebar";
import {
  SkillLibraryPanel,
  type SkillUpdateCheckStatus
} from "./components/SkillLibraryPanel";
import { SkillsEditor } from "./components/SkillsEditor";
import { TargetWorkspace } from "./components/TargetWorkspace";
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
import { useDesktopShortcuts } from "./hooks/useDesktopShortcuts";
import {
  findRecentProfileApplication,
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

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const summarizeSkillUpdateChecks = (skillUpdateItems: SkillUpdateInfo[]): SkillUpdateCheckStatus => {
  const failedChecks = skillUpdateItems.filter((update) => update.error).length;
  const availableUpdates = skillUpdateItems.filter(
    (update) => update.updateAvailable && !update.error
  ).length;

  if (failedChecks > 0) {
    return {
      state: "error",
      message: `${plural(failedChecks, "check")} failed`
    };
  }

  if (skillUpdateItems.length === 0) {
    return {
      state: "info",
      message: "No tracked update sources"
    };
  }

  return {
    state: "success",
    message:
      availableUpdates > 0
        ? `${plural(availableUpdates, "update")} available`
        : "All tracked skills are up to date"
  };
};

const summarizeSkillUpdateResult = (
  skillId: string,
  skillUpdateItems: SkillUpdateInfo[]
): SkillUpdateCheckStatus => {
  const remainingUpdates = skillUpdateItems.filter(
    (update) => update.updateAvailable && !update.error
  ).length;

  return {
    state: "success",
    message:
      remainingUpdates > 0
        ? `Updated ${skillId} · ${plural(remainingUpdates, "update")} remain`
        : `Updated ${skillId} · All tracked skills are up to date`
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

const AppFeedback = ({
  feedback,
  onDismiss
}: {
  feedback?: AppFeedbackMessage;
  onDismiss(): void;
}) => {
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

  return (
    <div
      className={`app-feedback app-feedback--${feedback.kind}`}
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
      <div>
        <strong>{feedback.title}</strong>
        {feedback.message ? <span>{feedback.message}</span> : null}
        {feedback.action ? (
          <button className="app-feedback__action" type="button" onClick={feedback.action.onClick}>
            {feedback.action.label}
          </button>
        ) : null}
      </div>
      <button type="button" aria-label="Dismiss message" onClick={onDismiss}>
        <X size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
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
  preview?: ActivationPreview
): ValidationRow[] => {
  const configValidation = profile.manifest.managed.config
    ? validateConfig(profile.configText, target?.configLanguage)
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
      label: "Target access",
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
      label: target?.instructionsLabel ?? "Instructions",
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
      label: target?.configLabel ?? "Config",
      ...configValidation
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

export const App = () => {
  const [targets, setTargets] = useState<TargetInfo[]>([]);
  const [targetStates, setTargetStates] = useState<TargetManagementState[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [librarySkills, setLibrarySkills] = useState<SkillLibraryEntry[]>([]);
  const [mcpServers, setMcpServers] = useState<McpLibraryEntry[]>([]);
  const [skillUpdates, setSkillUpdates] = useState<SkillUpdateInfo[]>([]);
  const [skillInventory, setSkillInventory] = useState<SkillInventoryEntry[]>([]);
  const [selectedSkillUpdatePlan, setSelectedSkillUpdatePlan] = useState<SkillUpdatePlan>();
  const [profileResourceCounts, setProfileResourceCounts] = useState<
    Record<string, ProfileResourceSummary>
  >({});
  const [skillSettings, setSkillSettings] = useState<AgentEnvSettings>({
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
  const [skillUsage, setSkillUsage] = useState<Record<string, string[]>>({});
  const [mcpUsage, setMcpUsage] = useState<Record<string, string[]>>({});
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [preview, setPreview] = useState<ActivationPreview>();
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview>();
  const [rollbackError, setRollbackError] = useState<string>();
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>("library");
  const [activeLibraryTab, setActiveLibraryTab] = useState<LibraryTab>("skills");
  const [skillLibraryViewState, setSkillLibraryViewState] = useState(
    defaultSkillLibraryViewState
  );
  const [mcpLibraryViewState, setMcpLibraryViewState] = useState(
    defaultMcpLibraryViewState
  );
  const [skillLibraryTool, setSkillLibraryTool] = useState<"import" | "discoveries">();
  const [skillUpdateCheckStatus, setSkillUpdateCheckStatus] =
    useState<SkillUpdateCheckStatus>();
  const [isProfileDirty, setIsProfileDirty] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [profileSaveStatus, setProfileSaveStatus] = useState("");
  const [settingsSaveStatus, setSettingsSaveStatus] = useState("");
  const [targetRefreshStatus, setTargetRefreshStatus] = useState<"refreshing" | "refreshed">();
  const [profileSearch, setProfileSearch] = useState("");
  const [activeComposerSection, setActiveComposerSection] =
    useState<ComposerSection>();
  const [isTargetMenuOpen, setIsTargetMenuOpen] = useState(false);
  const [isProfileActionsOpen, setIsProfileActionsOpen] = useState(false);
  const [profileDialogMode, setProfileDialogMode] = useState<ProfileDialogMode>();
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
  const profileApplyControlRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const targetMenuButtonRef = useRef<HTMLButtonElement>(null);
  const profileActionsButtonRef = useRef<HTMLButtonElement>(null);
  const profileSearchInputRef = useRef<HTMLInputElement>(null);
  const skillSearchInputRef = useRef<HTMLInputElement>(null);
  const mcpSearchInputRef = useRef<HTMLInputElement>(null);
  const profileFlowRequestRef = useRef(0);
  const activeProfileFlowRequestRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
  const rollbackReturnFocusRef = useRef<HTMLElement | null>(null);
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

  const refreshProfiles = async () => {
    const [
      targetItems,
      targetStateItems,
      profileItems,
      backupItems,
      skillItems,
      mcpItems,
      skillUpdateItems,
      skillInventoryItems,
      settings,
      githubStatus
    ] = await Promise.all([
      window.agentEnv.listTargets(),
      window.agentEnv.listTargetStates(),
      window.agentEnv.listProfiles(),
      window.agentEnv.listBackups(),
      window.agentEnv.listSkillLibrary(),
      window.agentEnv.listMcpLibrary(),
      window.agentEnv.checkSkillLibraryUpdates(),
      window.agentEnv.scanSkillInventory(),
      window.agentEnv.readSettings(),
      window.agentEnv.readGitHubAuthStatus()
    ]);
    const profileDetails = await Promise.all(
      profileItems.map((profile) => window.agentEnv.readProfile(profile.id))
    );
    const usage: Record<string, string[]> = {};
    const nextMcpUsage: Record<string, string[]> = {};
    const nextProfileResourceCounts: Record<string, ProfileResourceSummary> = {};
    for (const profile of profileDetails) {
      const profileTarget = targetItems.find(
        (targetItem) => targetItem.id === profile.manifest.targetId
      );
      if (profileTarget) {
        nextProfileResourceCounts[profile.id] = summarizeProfile(profile, profileTarget);
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
    setLibrarySkills(skillItems);
    setMcpServers(mcpItems);
    setSkillUpdates(skillUpdateItems);
    setSkillInventory(skillInventoryItems);
    setSkillSettings(settings);
    setGithubAuthStatus(githubStatus);
    setSkillUsage(usage);
    setMcpUsage(nextMcpUsage);
    setProfileResourceCounts(nextProfileResourceCounts);
    setSelectedTargetId((current) => current ?? targetItems[0]?.id);
    return { targetItems, profileItems, backupItems, skillUpdateItems };
  };

  useEffect(() => {
    let isMounted = true;

    refreshProfiles()
      .then(async ({ profileItems, targetItems }) => {
        if (!isMounted || profileItems.length === 0) {
          return;
        }

        const initialTargetId = targetItems[0]?.id;
        const initialProfile =
          profileItems.find((profile) => !initialTargetId || profile.targetId === initialTargetId) ??
          profileItems[0];
        setSelectedTargetId(initialProfile.targetId);
        setSelectedProfileId(initialProfile.id);
        setActiveComposerSection(undefined);
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

  const selectProfile = async (profileId: string) => {
    const requestId = ++profileFlowRequestRef.current;
    activeProfileFlowRequestRef.current = requestId;
    const isDifferentProfile = profileId !== selectedProfileId;
    const profileSummary = profiles.find((profile) => profile.id === profileId);
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    setRollbackPreview(undefined);
    if (isDifferentProfile) {
      setDraftProfile(undefined);
      setIsProfileDirty(false);
      setProfileSaveStatus("");
    }
    setActiveComposerSection(undefined);
    setActiveWorkspace("profiles");
    setSelectedProfileId(profileId);
    if (profileSummary) {
      setSelectedTargetId(profileSummary.targetId);
    }
    try {
      const profile = await window.agentEnv.readProfile(profileId);
      if (requestId !== profileFlowRequestRef.current) {
        return;
      }
      setSelectedTargetId(profile.manifest.targetId);
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

  const updateDraftProfile = (profile: ProfileDetail) => {
    invalidateProfileFlow();
    setDraftProfile(profile);
    setIsProfileDirty(true);
    setProfileSaveStatus("Unsaved changes");
    setSkillUpdateCheckStatus(undefined);
    setPreview(undefined);
    setRollbackPreview(undefined);
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
    profileSearchRef: profileSearchInputRef,
    skillSearchRef: skillSearchInputRef,
    mcpSearchRef: mcpSearchInputRef
  });

  const openCreateProfileDialog = () => {
    const targetId = selectedTargetId ?? targets[0]?.id;
    if (!targetId) {
      setError("No target available");
      return;
    }
    setProfileForm({ targetId, name: "", description: "" });
    setProfileDialogMode("create");
    setActiveWorkspace("profiles");
    setIsProfileActionsOpen(false);
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
    setProfileDialogMode("edit");
    setIsProfileActionsOpen(false);
  };

  const submitProfileDialog = async () => {
    const name = profileForm.name.trim();
    const description = profileForm.description.trim();
    if (!profileDialogMode || !name) {
      setError("Profile name is required");
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      if (profileDialogMode === "create") {
        const saved = await window.agentEnv.createProfile({
          targetId: profileForm.targetId,
          name,
          description
        });
        await refreshProfiles();
        setSelectedTargetId(saved.manifest.targetId);
        setSelectedProfileId(saved.id);
        setDraftProfile(saved);
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
      setPreview(undefined);
      setRollbackPreview(undefined);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const duplicateSelectedProfile = async () => {
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

  const closeProfileDialog = () => {
    setProfileDialogMode(undefined);
    setDeleteProfileDialogOpen(false);
    setPreview(undefined);
    setRollbackPreview(undefined);
  };

  const selectTarget = (targetId: string) => {
    setIsTargetMenuOpen(false);
    targetMenuButtonRef.current?.focus();
    if (targetId === selectedTargetId) {
      return;
    }

    invalidateProfileFlow();
    setSelectedTargetId(targetId);
    setSelectedProfileId(undefined);
    setDraftProfile(undefined);
    setIsProfileDirty(false);
    setProfileSaveStatus("");
    setPreview(undefined);
    setRollbackPreview(undefined);
    setActiveComposerSection(undefined);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (profileDialogMode || deleteProfileDialogOpen) {
        closeProfileDialog();
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
    deleteProfileDialogOpen,
    isProfileActionsOpen,
    isTargetMenuOpen,
    profileDialogMode,
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
  const targetProfiles = profiles.filter(
    (profile) => !selectedTargetId || profile.targetId === selectedTargetId
  );
  const normalizedProfileSearch = profileSearch.trim().toLowerCase();
  const visibleProfiles = targetProfiles
    .filter((profile) => {
      if (normalizedProfileSearch.length === 0) {
        return true;
      }

      return `${profile.name} ${profile.description}`.toLowerCase().includes(normalizedProfileSearch);
    })
    .sort((left, right) => {
      if (left.id === selectedProfileId) return -1;
      if (right.id === selectedProfileId) return 1;
      return left.name.localeCompare(right.name);
    });
  const activeTargetName = selectedTarget?.name ?? draftProfile?.manifest.targetId ?? "target";
  const targetStateById = new Map(targetStates.map((state) => [state.targetId, state]));
  const selectedTargetState = targetStates.find((state) => state.targetId === selectedTarget?.id);
  const validationRows = draftProfile
    ? createValidationRows(draftProfile, selectedTarget, preview)
    : [];
  const localValidationErrors = validationRows
    .filter(
      (row) =>
        row.level === "error" && row.label !== "Target access" && row.label !== "Live conflicts"
    )
    .map((row) => row.detail ?? `${row.label} is invalid`);
  const resourceSummary =
    draftProfile && selectedTarget
      ? summarizeProfile(draftProfile, selectedTarget)
      : undefined;
  const readinessInput = {
    profile: draftProfile,
    target: selectedTarget,
    targetState: selectedTargetState,
    isDirty: isProfileDirty,
    localValidationErrors,
    preview
  };
  const readiness = deriveProfileReadiness(readinessInput);
  const applyActionLabel = deriveApplyActionLabel(readinessInput);
  const ReadinessIcon =
    readiness.status === "ready" || readiness.status === "unmanaged"
      ? CheckCircle2
      : readiness.status === "dirty"
        ? RefreshCw
        : TriangleAlert;
  const selectedTargetIcon = selectedTarget ? targetIconFor(selectedTarget) : undefined;
  const applySafetyTitle =
    readiness.status === "unmanaged"
      ? "Review before apply"
      : readiness.status === "ready"
        ? "Ready to review"
        : readiness.status === "no-profile"
          ? "Profile required"
          : readiness.status === "no-target"
            ? "Target required"
            : readiness.status === "dirty"
              ? "Save required"
              : "Review required";
  const applySafetyMessage =
    readiness.status === "unmanaged" || readiness.status === "ready"
      ? "Preview shows every replacement before a backup is created."
      : readiness.message;
  const readinessTitle =
    readiness.status === "ready" || readiness.status === "unmanaged"
      ? `${selectedTarget?.name ?? "Target"} ready`
      : readiness.label;
  const selectedProfileApplication = draftProfile
    ? findRecentProfileApplication(draftProfile.id, targetStates, targets)
    : undefined;
  const applyDisabled = !draftProfile || !selectedTarget || busy;
  const applyDescription = !draftProfile
    ? "Select a profile before previewing changes"
    : !selectedTarget
      ? "Select a target before previewing changes"
      : busy
        ? "An action is in progress"
        : readiness.message;
  const canApply = Boolean(
    preview &&
      preview.errors.length === 0 &&
      localValidationErrors.length === 0 &&
      !rollbackPreview &&
      (selectedTarget?.health.canWrite ?? false)
  );

  const updateCount = skillUpdates.filter((update) => update.updateAvailable).length;
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
      const nextPreview = await window.agentEnv.previewApply(draftProfile.id);
      if (requestId !== profileFlowRequestRef.current) {
        return;
      }
      const rendererBlockers = [
        ...(!selectedTarget?.health.canWrite
          ? [selectedTarget?.health.summary || `${selectedTarget?.name ?? "Target"} is unavailable`]
          : []),
        ...localValidationErrors
      ];
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
      const result = await window.agentEnv.applyProfile(draftProfile.id, preview.id);
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

  const importUnmanagedSkill = async (sourcePath: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await window.agentEnv.importSkillToLibrary(sourcePath);
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
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
      setSkillUpdateCheckStatus(summarizeSkillUpdateResult(id, skillUpdateItems));
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
      await window.agentEnv.removeSkillFromLibrary(id);
      await refreshProfiles();
      setSkillUpdateCheckStatus({
        state: "success",
        message: `Deleted ${id} from library`
      });
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

  const updateAllLibrarySkills = async (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }

    setBusy(true);
    setError(undefined);
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

  const checkSkillUpdates = async () => {
    setBusy(true);
    setError(undefined);
    setProfileSaveStatus("");
    setSkillUpdateCheckStatus({ state: "checking", message: "Checking library updates..." });
    try {
      const { skillUpdateItems } = await refreshProfiles();
      setSkillUpdateCheckStatus(summarizeSkillUpdateChecks(skillUpdateItems));
      const rateLimitError = skillUpdateItems.find(
        (item) => item.error && isGitHubRateLimitError(item.error)
      )?.error;
      if (rateLimitError && githubAuthStatus.state !== "signed-in") {
        setError(rateLimitError);
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setSkillUpdateCheckStatus({ state: "error", message: "Update check failed" });
    } finally {
      setBusy(false);
    }
  };

  const openSkillDiscoveries = async () => {
    setSkillLibraryTool("discoveries");
    setBusy(true);
    setError(undefined);
    try {
      setSkillInventory(await window.agentEnv.scanSkillInventory());
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
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

  const importGitHubSkill = async (input: { url: string; id?: string }) => {
    setBusy(true);
    setError(undefined);
    try {
      await window.agentEnv.importGitHubSkillToLibrary(input);
      setSelectedSkillUpdatePlan(undefined);
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
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

  const previewLibrarySkillUpdate = async (id: string) => {
    setBusy(true);
    setError(undefined);
    setProfileSaveStatus("");
    setSkillUpdateCheckStatus({ state: "checking", message: `Checking ${id}...` });
    try {
      const updatePlan = await window.agentEnv.previewLibrarySkillUpdate(id);
      setSelectedSkillUpdatePlan(updatePlan);
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
        setSkillUpdateCheckStatus({
          state: "success",
          message: updatePlan.updateAvailable
            ? `1 update available for ${id}`
            : `${id} is up to date`
        });
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
      setError(message);
      setSkillUpdateCheckStatus({ state: "error", message: `${id} check failed` });
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
      await refreshProfiles();
      setSettingsSaveStatus("Settings saved");
    } catch (unknownError) {
      setSettingsSaveStatus("");
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

  const needsManagementCount = skillInventory.filter((skill) => skill.status !== "managed").length;
  const dismissAppFeedback = () => {
    setError(undefined);
    setSkillUpdateCheckStatus(undefined);
    setProfileSaveStatus("");
    setSettingsSaveStatus("");
    setTargetRefreshStatus(undefined);
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
        title: showGitHubRecovery ? "GitHub request limited" : "Action failed",
        message: showGitHubRecovery
          ? "Anonymous GitHub requests are limited. Connect your account and try again."
          : error,
        action: showGitHubRecovery
          ? { label: "Connect GitHub", onClick: openGitHubConnectionSettings }
          : undefined
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
        : settingsSaveStatus
          ? {
              kind: settingsSaveStatus === "Settings saved" ? "success" : "loading",
              title: settingsSaveStatus
            }
        : undefined;
  const profileApplyControl = (
    <div className="profile-apply-control" ref={profileApplyControlRef}>
      <span className="profile-apply-split">
        <button
          className="profile-apply-button"
          type="button"
          aria-label={applyActionLabel}
          aria-describedby="profile-apply-description"
          title={applyActionLabel}
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
          <strong>{applyActionLabel}</strong>
        </button>
        <button
          ref={targetMenuButtonRef}
          className="profile-target-menu-button"
          type="button"
          aria-expanded={isTargetMenuOpen}
          aria-haspopup="menu"
          aria-label="Select apply target"
          title="Select apply target"
          onClick={() => {
            setIsProfileActionsOpen(false);
            setIsTargetMenuOpen((current) => !current);
          }}
        >
          <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </span>
      {isTargetMenuOpen ? (
        <div className="profile-target-menu" role="menu" aria-label="Profile targets">
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
      <span id="profile-apply-description" hidden>
        {applyDescription}
      </span>
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
        onWorkspaceSelect={(workspace) => {
          libraryScroll.captureScroll();
          setActiveWorkspace(workspace);
        }}
        onLibraryTabSelect={(tab) => {
          libraryScroll.captureScroll();
          setActiveLibraryTab(tab);
        }}
      />

      <section
        ref={libraryScroll.setScrollOwner}
        className="editor-panel"
        aria-label={
          activeWorkspace === "library"
            ? "Library workspace"
            : activeWorkspace === "profiles"
              ? "Profile editor"
              : `${activeWorkspace} workspace`
        }
      >
        <AppFeedback feedback={appFeedback} onDismiss={dismissAppFeedback} />
        {activeWorkspace === "library" ? (
          <>
            <header className="page-header library-page-header">
              <div>
                <h2 aria-label={`Library/${activeLibraryTab === "skills" ? "Skills" : "MCP Servers"}`}>
                  <span>Library</span>
                  <span className="breadcrumb-separator">/</span>
                  <span>{activeLibraryTab === "skills" ? "Skills" : "MCP Servers"}</span>
                  <InfoTip label="Library is the shared resource layer. Profiles reference these skills and MCP servers instead of duplicating files in every profile." />
                </h2>
              </div>
              <div className="page-actions">
                {activeLibraryTab === "skills" ? (
                  <>
                    <button
                      className="primary-inline-action"
                      type="button"
                      onClick={() => setSkillLibraryTool("import")}
                    >
                      <Plus size={16} strokeWidth={2.4} />
                      Import Skill
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => {
                        void openSkillDiscoveries();
                      }}
                    >
                      <ScanLine size={15} strokeWidth={2.2} />
                      Scan local Skills
                    </button>
                  </>
                ) : null}
              </div>
            </header>
            <section
              className={`metric-strip metric-strip--compact metric-strip--${activeLibraryTab}`}
              aria-label="Library summary"
            >
              {activeLibraryTab === "mcp" ? (
                <div className="metric-tile">
                  <span className="metric-icon metric-icon--purple" aria-hidden="true">
                    <Network size={21} strokeWidth={2.2} />
                  </span>
                  <div>
                    <strong>{mcpServers.length}</strong>
                    <small>MCP Servers</small>
                    <span>Shared across profiles</span>
                  </div>
                </div>
              ) : null}
              {activeLibraryTab === "skills" ? (
                <>
                  <div className="metric-tile">
                    <span className="metric-icon metric-icon--green" aria-hidden="true">
                      <RefreshCw size={21} strokeWidth={2.2} />
                    </span>
                    <div>
                      <strong>{updateCount}</strong>
                      <small>Updates</small>
                      <span>{skillUpdates.length} tracked sources</span>
                    </div>
                  </div>
                  <button className="metric-tile metric-tile--button" type="button" onClick={() => { void openSkillDiscoveries(); }}>
                    <span className="metric-icon metric-icon--slate" aria-hidden="true"><HardDrive size={21} strokeWidth={2.2} /></span>
                    <div><strong>{needsManagementCount}</strong><small>Needs attention</small><span>Local target skills</span></div>
                  </button>
                </>
              ) : (
                <>
                  <div className="metric-tile">
                    <span className="metric-icon metric-icon--amber" aria-hidden="true"><FolderKanban size={21} strokeWidth={2.2} /></span>
                    <div><strong>{Object.keys(mcpUsage).length}</strong><small>In use</small><span>Across {profiles.length} profiles</span></div>
                  </div>
                  <div className="metric-tile">
                    <span className="metric-icon metric-icon--blue" aria-hidden="true"><MonitorCheck size={21} strokeWidth={2.2} /></span>
                    <div><strong>{readyTargetCount}</strong><small>Ready targets</small><span>{readyTargetCount}/{targets.length || 0} available</span></div>
                  </div>
                </>
              )}
            </section>
            {activeLibraryTab === "skills" ? (
              <SkillLibraryPanel
                librarySkills={librarySkills}
                skillUpdates={skillUpdates}
                skillInventory={skillInventory}
                selectedUpdatePlan={selectedSkillUpdatePlan}
                skillUsage={skillUsage}
                activeTool={skillLibraryTool}
                onCloseTool={() => setSkillLibraryTool(undefined)}
                onSelectLocalSkillFolder={() => window.agentEnv.selectSkillFolder()}
                onImportUnmanaged={importUnmanagedSkill}
                onImportGitHubSkill={importGitHubSkill}
                onManageTargetSkill={manageTargetSkill}
                onSetUpdateSource={setSkillUpdateSource}
                onPreviewLibrarySkillUpdate={previewLibrarySkillUpdate}
                onUpdateLibrarySkill={updateLibrarySkill}
                onUpdateAllLibrarySkills={updateAllLibrarySkills}
                onRemoveLibrarySkill={removeLibrarySkill}
                onCheckUpdates={checkSkillUpdates}
                onIgnoreSkillGroup={(skillKey) => {
                  void ignoreSkillGroup(skillKey);
                }}
                onUnignoreSkillGroup={(skillKey) => {
                  void unignoreSkillGroup(skillKey);
                }}
                updateCheckStatus={skillUpdateCheckStatus}
                viewState={skillLibraryViewState}
                onViewStateChange={(next) => {
                  libraryScroll.resetScrollNow();
                  setSkillLibraryViewState(next);
                }}
                searchInputRef={skillSearchInputRef}
              />
            ) : (
              <McpLibraryPanel
                mcpServers={mcpServers}
                mcpUsage={mcpUsage}
                viewState={mcpLibraryViewState}
                onViewStateChange={(next) => {
                  libraryScroll.resetScrollNow();
                  setMcpLibraryViewState(next);
                }}
                searchInputRef={mcpSearchInputRef}
                onSave={saveMcpServer}
                onRemove={removeMcpServer}
              />
            )}
          </>
        ) : activeWorkspace === "profiles" ? (
          <>
            <header className="page-header profile-page-header">
              <div className="profile-page-heading">
                <h2 aria-label="Profiles">Profiles</h2>
                <p>Compose reusable environments and apply them safely to local agent targets.</p>
              </div>
              <div className="profile-page-actions" ref={profilePageActionsRef}>
                <button
                  className="profile-new-button"
                  type="button"
                  onClick={openCreateProfileDialog}
                >
                  <Plus size={15} strokeWidth={2.3} aria-hidden="true" />
                  New Profile
                </button>
                <div className="profile-save-control">
                  <button
                    ref={saveButtonRef}
                    className="save-button"
                    type="button"
                    disabled={busy || !isProfileDirty}
                    onClick={saveSelectedProfile}
                  >
                    Save
                  </button>
                </div>
                <button
                  ref={profileActionsButtonRef}
                  className="icon-action"
                  type="button"
                  aria-expanded={isProfileActionsOpen}
                  aria-haspopup="menu"
                  aria-label="More profile actions"
                  title="More profile actions"
                  disabled={!selectedProfileId}
                  onClick={() => {
                    setIsTargetMenuOpen(false);
                    setIsProfileActionsOpen((current) => !current);
                  }}
                >
                  <MoreHorizontal size={16} strokeWidth={2.2} />
                </button>
                {isProfileActionsOpen ? (
                  <div className="profile-actions-menu" role="menu" aria-label="Profile actions">
                    <button type="button" role="menuitem" onClick={duplicateSelectedProfile}>
                      <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
                      <span>Duplicate profile</span>
                    </button>
                    <button
                      className="is-danger"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setDeleteProfileDialogOpen(true);
                        setIsProfileActionsOpen(false);
                      }}
                    >
                      <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
                      <span>Delete profile</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </header>
            <section
              className={`profile-readiness-strip profile-readiness-strip--${readiness.status}`}
              role="status"
              aria-label="Profile readiness"
            >
              <div className="profile-readiness-strip__state">
                <span className="profile-readiness-strip__icon" aria-hidden="true">
                  <ReadinessIcon size={18} strokeWidth={2.3} />
                </span>
                <span className="profile-readiness-strip__copy">
                  <strong>{readinessTitle}</strong>
                  <span>{readiness.message}</span>
                </span>
              </div>
              <div className="profile-readiness-strip__attention">
                <span className="profile-readiness-strip__attention-icon" aria-hidden="true">
                  <ShieldCheck size={18} strokeWidth={2.25} />
                </span>
                <span className="profile-readiness-strip__copy">
                  <strong>{applySafetyTitle}</strong>
                  <span>{applySafetyMessage}</span>
                </span>
                {readiness.remediationLabel ? (
                  <button type="button" disabled={busy} onClick={runReadinessRemediation}>
                    {readiness.remediationLabel}
                  </button>
                ) : null}
              </div>
            </section>
            <section className="profile-workbench" aria-label="Profiles">
              <aside className="profile-index" aria-label="Profile list">
                <div className="profile-list-toolbar">
                  <label className="profile-search">
                    <Search size={15} strokeWidth={2.2} aria-hidden="true" />
                    <input
                      ref={profileSearchInputRef}
                      aria-label="Search profiles"
                      placeholder="Search Profile name..."
                      value={profileSearch}
                      onChange={(event) => setProfileSearch(event.currentTarget.value)}
                    />
                  </label>
                </div>
                <div className="profile-list">
                  {isLoading ? (
                    <div className="inline-state inline-state--loading" role="status">
                      <span className="inline-state__icon" aria-hidden="true" />
                      <span>Loading profiles</span>
                    </div>
                  ) : null}
                  {!isLoading && visibleProfiles.length === 0 ? (
                    <div className="inline-state">
                      <span className="inline-state__icon" aria-hidden="true">
                        <Search size={15} strokeWidth={2.2} />
                      </span>
                      <span>No profiles match this view</span>
                    </div>
                  ) : null}
                  {visibleProfiles.map((profile, index) => {
                    const counts = profileResourceCounts[profile.id];
                    const recentApplication = findRecentProfileApplication(
                      profile.id,
                      targetStates,
                      targets
                    );
                    const isSelected = profile.id === selectedProfileId;
                    return (
                    <button
                      className={`profile-row${isSelected ? " is-active" : ""}`}
                      type="button"
                      aria-current={isSelected ? "page" : undefined}
                      key={profile.id}
                      onClick={() => selectProfile(profile.id)}
                    >
                      <span className={`profile-row__icon profile-row__icon--${isSelected ? "selected" : index % 5}`} aria-hidden="true">
                        <Rocket size={18} strokeWidth={2.2} />
                      </span>
                      <span className="profile-row__content">
                        <span className="profile-row__title">
                          {profile.name}
                          {isSelected && isProfileDirty ? <strong>Unsaved</strong> : null}
                        </span>
                        <small>{profile.description || "No description"}</small>
                        <span className="profile-row__stats">
                          <span>{counts?.skills.count ?? 0} Skills</span>
                          <span>{counts?.mcp.count ?? 0} MCP</span>
                          <span>
                            {plural(counts?.instructions.count ?? 0, "Instruction")}
                          </span>
                        </span>
                        {recentApplication?.state.lastAppliedAt ? (
                          <span className="profile-row__recent">
                            <span>
                              Last applied to {recentApplication.target?.name ?? recentApplication.state.targetId}
                            </span>
                            <time dateTime={recentApplication.state.lastAppliedAt}>
                              {formatShortDate(recentApplication.state.lastAppliedAt)}
                            </time>
                          </span>
                        ) : null}
                      </span>
                    </button>
                    );
                  })}
                </div>
              </aside>
              <div className="profile-editor-surface">
                {draftProfile ? (
                  <>
                    <header className="profile-hero">
                      <div className="profile-hero__icon" aria-hidden="true">
                        <Rocket size={30} strokeWidth={2.2} />
                      </div>
                      <div className="profile-hero__body">
                        <div className="profile-hero__title">
                          <h2>{draftProfile.manifest.name}</h2>
                          <button
                            className="icon-action"
                            type="button"
                            aria-label="Edit profile"
                            title="Edit profile"
                            onClick={openEditProfileDialog}
                          >
                            <Pencil size={15} strokeWidth={2.2} />
                          </button>
                        </div>
                        <p className="profile-description">
                          {draftProfile.manifest.description || "No description"}
                        </p>
                        <div className="profile-hero__meta">
                          <span className="success-pill">
                            Compatible with {selectedTarget?.name ?? draftProfile.manifest.targetId}
                          </span>
                          <span className="profile-hero__recent">
                            <Monitor size={14} strokeWidth={2.2} aria-hidden="true" />
                            {selectedProfileApplication?.state.lastAppliedAt
                              ? `Last applied ${formatShortDate(selectedProfileApplication.state.lastAppliedAt)}`
                              : "Not applied yet"}
                          </span>
                        </div>
                      </div>
                      {profileApplyControl}
                    </header>
            <section className="profile-composer" aria-label="Profile composer">
              <header className="profile-composer__header">
                <div>
                  <h3>Profile Composer</h3>
                  <p>Combine instructions, reusable skills, and MCP servers.</p>
                </div>
              </header>
              <ProfileComposerSection
                id="instructions"
                icon={<BookOpenText size={18} strokeWidth={2.2} />}
                title="Instructions"
                description="Agent instructions and rule files"
                count={resourceSummary?.instructions.count ?? 0}
                chipNames={
                  resourceSummary?.instructions.count
                    ? [selectedTarget?.instructionsLabel ?? "Instructions"]
                    : []
                }
                expanded={activeComposerSection === "instructions"}
                onToggle={() => toggleComposerSection("instructions")}
              >
                <AgentsEditor
                  label={selectedTarget?.instructionsLabel ?? "Instructions"}
                  value={draftProfile.instructions}
                  onChange={(instructions) => {
                    updateDraftProfile({ ...draftProfile, instructions });
                  }}
                />
              </ProfileComposerSection>
              <ProfileComposerSection
                id="skills"
                icon={<Database size={18} strokeWidth={2.2} />}
                title="Skills"
                description="Reusable skills and workflows"
                count={resourceSummary?.skills.count ?? 0}
                chipNames={resourceSummary?.skills.names ?? []}
                expanded={activeComposerSection === "skills"}
                onToggle={() => toggleComposerSection("skills")}
              >
                <SkillsEditor
                  mode="skills"
                  value={draftProfile.assetPolicy ?? emptyAssetPolicy}
                  configText={draftProfile.configText}
                  configLanguage={selectedTarget?.configLanguage}
                  preview={preview}
                  librarySkills={librarySkills}
                  mcpServers={mcpServers}
                  onChange={(assetPolicy) => {
                    updateDraftProfile({ ...draftProfile, assetPolicy });
                  }}
                />
              </ProfileComposerSection>
              <ProfileComposerSection
                id="mcp"
                icon={<Network size={18} strokeWidth={2.2} />}
                title="MCP Servers"
                description="External tools and service connections"
                count={resourceSummary?.mcp.count ?? 0}
                chipNames={resourceSummary?.mcp.names ?? []}
                expanded={activeComposerSection === "mcp"}
                onToggle={() => toggleComposerSection("mcp")}
              >
                <SkillsEditor
                  mode="mcp"
                  value={draftProfile.assetPolicy ?? emptyAssetPolicy}
                  configText={draftProfile.configText}
                  configLanguage={selectedTarget?.configLanguage}
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
                title="Advanced"
                description="Raw config, overrides, validation, and history"
                count={draftProfile.assetPolicy.disabledSkillPaths.length}
                chipNames={draftProfile.assetPolicy.disabledSkillPaths}
                expanded={activeComposerSection === "advanced"}
                onToggle={() => toggleComposerSection("advanced")}
              >
                <McpEditor
                  label={selectedTarget?.configLabel ?? "Config"}
                  value={draftProfile.configText}
                  onChange={(configText) => {
                    updateDraftProfile({ ...draftProfile, configText });
                  }}
                />
                <SkillsEditor
                  mode="advanced"
                  value={draftProfile.assetPolicy ?? emptyAssetPolicy}
                  configText={draftProfile.configText}
                  configLanguage={selectedTarget?.configLanguage}
                  preview={preview}
                  librarySkills={librarySkills}
                  mcpServers={mcpServers}
                  onChange={(assetPolicy) => {
                    updateDraftProfile({ ...draftProfile, assetPolicy });
                  }}
                />
                <section className="validation-panel" aria-label="Validation">
                  <div className="section-title">Validation</div>
                  <div className="validation-grid">
                    {validationRows.map((row) => (
                      <div className={`check-row check-row--${row.level}`} key={row.label}>
                        <span>
                          {row.label}
                          {row.detail ? <small>{row.detail}</small> : null}
                        </span>
                        <strong>{row.value}</strong>
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
                  backups={backups}
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
                title="Rollback preview"
                confirmLabel="Restore backup"
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
                title={`Apply preview for ${activeTargetName}`}
                confirmDisabled={!canApply || busy}
                onCancel={() => setPreview(undefined)}
                onConfirm={applySelectedProfile}
              />
            ) : null}
                  </>
                ) : (
                  <div className="profile-empty-surface">
                    <div className="empty-state">
                      <h2>No profile selected</h2>
                      <p className="muted">Choose a profile or create one.</p>
                    </div>
                    {profileApplyControl}
                  </div>
                )}
              </div>
              {profileDialogMode ? (
                <div className="preview-modal-backdrop" onClick={closeProfileDialog}>
                  <section
                    className="profile-form-dialog"
                    role="dialog"
                    aria-label={profileDialogMode === "create" ? "New profile" : "Edit profile"}
                    aria-modal="true"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <header className="profile-dialog-header">
                      <div>
                        <div className="section-title">
                          {profileDialogMode === "create" ? "New profile" : "Edit profile"}
                        </div>
                        <p className="muted">
                          {profileDialogMode === "create"
                            ? "Create a target-specific environment profile."
                            : "Update the profile name and description."}
                        </p>
                      </div>
                    </header>
                    <div className="profile-form-grid">
                      {profileDialogMode === "create" ? (
                        <label>
                          <span>Target</span>
                          <select
                            aria-label="Profile target"
                            value={profileForm.targetId}
                            onChange={(event) =>
                              setProfileForm({ ...profileForm, targetId: event.currentTarget.value })
                            }
                          >
                            {targets.map((target) => (
                              <option value={target.id} key={target.id}>
                                {target.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label>
                        <span>Profile name</span>
                        <input
                          aria-label="Profile name"
                          value={profileForm.name}
                          onChange={(event) =>
                            setProfileForm({ ...profileForm, name: event.currentTarget.value })
                          }
                        />
                      </label>
                      <label>
                        <span>Description</span>
                        <textarea
                          aria-label="Description"
                          rows={3}
                          value={profileForm.description}
                          onChange={(event) =>
                            setProfileForm({ ...profileForm, description: event.currentTarget.value })
                          }
                        />
                      </label>
                    </div>
                    <footer className="preview-actions">
                      <button className="secondary-action" type="button" onClick={closeProfileDialog}>
                        Cancel
                      </button>
                      <button
                        className="primary-action"
                        type="button"
                        disabled={busy || profileForm.name.trim().length === 0}
                        onClick={submitProfileDialog}
                      >
                        {profileDialogMode === "create" ? "Create" : "Save"}
                      </button>
                    </footer>
                  </section>
                </div>
              ) : null}
              {deleteProfileDialogOpen && draftProfile ? (
                <div className="preview-modal-backdrop" onClick={closeProfileDialog}>
                  <section
                    className="profile-form-dialog profile-form-dialog--compact"
                    role="dialog"
                    aria-label="Delete profile"
                    aria-modal="true"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <header className="profile-dialog-header">
                      <div>
                        <div className="section-title">Delete profile</div>
                        <p className="muted">
                          Delete {draftProfile.manifest.name}? Applied target files and backups are not removed.
                        </p>
                      </div>
                    </header>
                    <footer className="preview-actions">
                      <button className="secondary-action" type="button" onClick={closeProfileDialog}>
                        Cancel
                      </button>
                      <button className="danger-action" type="button" disabled={busy} onClick={deleteSelectedProfile}>
                        Delete
                      </button>
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
            busy={busy}
            onRefresh={refreshTargets}
            onManageTarget={(targetId) => {
              selectTarget(targetId);
              setActiveWorkspace("profiles");
            }}
            onPreviewRollback={previewSelectedRollback}
            onCancelRollback={() => {
              setRollbackPreview(undefined);
              setRollbackError(undefined);
            }}
            onRestoreRollback={restoreSelectedRollback}
          />
        ) : activeWorkspace === "settings" ? (
          <section className="settings-page" aria-label="Settings">
            <header className="page-header">
              <div>
                <h2 aria-label="Settings">Settings</h2>
                <p>Local defaults and connected services.</p>
              </div>
            </header>
            <section className="resource-section settings-section" aria-labelledby="library-defaults-heading">
              <div className="settings-section-title">
                <div>
                  <div className="resource-heading" id="library-defaults-heading">Skills library</div>
                  <p className="settings-muted">Defaults used when installing managed skills.</p>
                </div>
              </div>
              <div className="resource-settings-grid">
                <label>
                  <span>Sync</span>
                  <select
                    aria-label="Global skill sync method"
                    value={skillSettings.skillSyncMethod}
                    onChange={(event) =>
                      updateSkillSettings({
                        skillSyncMethod: event.currentTarget.value as AgentEnvSettings["skillSyncMethod"]
                      })
                    }
                  >
                    <option value="symlink">Symlink</option>
                    <option value="copy">Copy</option>
                    <option value="auto">Auto</option>
                  </select>
                </label>
                <label>
                  <span>Storage</span>
                  <select
                    aria-label="Global skill storage location"
                    value={skillSettings.skillStorageLocation}
                    onChange={(event) =>
                      updateSkillSettings({
                        skillStorageLocation: event.currentTarget.value as AgentEnvSettings["skillStorageLocation"]
                      })
                    }
                  >
                    <option value="appData">App data</option>
                    <option value="agents">~/.agents/skills</option>
                  </select>
                </label>
                <div className="settings-toggle-field">
                  <span>Auto-check</span>
                  <button
                    className={`settings-switch${skillSettings.skillAutoCheckEnabled ? " is-on" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={skillSettings.skillAutoCheckEnabled}
                    aria-label="Skill auto update check"
                    disabled={busy}
                    onClick={() =>
                      updateSkillSettings({
                        skillAutoCheckEnabled: !skillSettings.skillAutoCheckEnabled
                      })
                    }
                  >
                    <span className="settings-switch__track" aria-hidden="true">
                      <span />
                    </span>
                    <strong>{skillSettings.skillAutoCheckEnabled ? "Enabled" : "Disabled"}</strong>
                  </button>
                </div>
                <label>
                  <span>Check interval</span>
                  <input
                    aria-label="Skill auto check interval minutes"
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
                </label>
              </div>
            </section>
            <section
              className="resource-section github-settings-section"
              id="github-connection-settings"
              tabIndex={-1}
              aria-label="GitHub OAuth settings"
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
                        ? `Connected as ${githubAuthStatus.user.login}`
                        : githubDeviceLogin
                          ? "Authorize AgentEnv Manager in your browser"
                          : "Connect for reliable GitHub imports and update checks"}
                    </p>
                  </div>
                </div>
                <div className="github-settings-actions">
                  {githubAuthStatus.state === "signed-in" ? (
                    <button disabled={busy || githubLoginChecking} onClick={signOutGitHub} type="button">
                      Sign out
                    </button>
                  ) : !githubDeviceLogin ? (
                    <button
                      className="primary-button"
                      disabled={busy || githubLoginChecking}
                      onClick={startGitHubLogin}
                      type="button"
                    >
                      <GitFork size={15} strokeWidth={2.2} aria-hidden="true" />
                      {githubLoginChecking ? "Connecting..." : "Sign in with GitHub"}
                    </button>
                  ) : null}
                </div>
              </div>
              {githubDeviceLogin ? (
                <div className="github-device-card">
                  <button
                    className={`github-device-code${githubCodeCopied ? " is-copied" : ""}`}
                    type="button"
                    aria-label={`Copy GitHub device code ${githubDeviceLogin.userCode}`}
                    onClick={copyGitHubDeviceCode}
                  >
                    <span>Device code</span>
                    <strong>{githubDeviceLogin.userCode}</strong>
                    <span className="github-device-copy-state">
                      {githubCodeCopied ? <CheckCircle2 size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                      {githubCodeCopied ? "Copied" : "Copy"}
                    </span>
                  </button>
                  <div className="github-device-status" role="status" aria-live="polite">
                    <RefreshCw className={githubLoginChecking ? "is-spinning" : ""} size={15} aria-hidden="true" />
                    <span>{githubLoginMessage || "Waiting for authorization. This page updates automatically."}</span>
                  </div>
                  <div className="github-device-actions">
                    <button
                      className="primary-button"
                      onClick={() => window.agentEnv.openGitHubDevicePage(githubDeviceLogin.verificationUri)}
                      type="button"
                    >
                      <ExternalLink size={15} aria-hidden="true" />
                      Open GitHub
                    </button>
                    <button disabled={githubLoginChecking} onClick={() => void pollGitHubLogin()} type="button">
                      Check now
                    </button>
                  </div>
                </div>
              ) : null}
              {githubAuthStatus.state === "signed-in" ? (
                <div className="github-connected-row" role="status">
                  <span className="github-connected-indicator" aria-hidden="true" />
                  <strong>Connected</strong>
                  {githubAuthStatus.rateLimit ? (
                    <span>
                      {githubAuthStatus.rateLimit.remaining.toLocaleString()} of {githubAuthStatus.rateLimit.limit.toLocaleString()} API requests remaining · resets {formatShortDate(githubAuthStatus.rateLimit.resetAt)}
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
          </section>
        ) : rollbackPreview ? (
          <PreviewDialog preview={rollbackPreview} title="Rollback preview" />
        ) : (
          <div className="empty-state">
            <h2>No profile selected</h2>
          </div>
        )}
      </section>

    </main>
  );
};
