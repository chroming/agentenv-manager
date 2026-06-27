import { useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  BookOpenText,
  FolderKanban,
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
  Trash2
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
  ManageTargetSkillInput,
  McpLibraryEntry,
  SaveMcpServerInput,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdateSourceInput,
  TargetInfo
} from "../shared/types";
import { AgentsEditor } from "./components/AgentsEditor";
import { HistoryView } from "./components/HistoryView";
import { McpEditor } from "./components/McpEditor";
import { McpLibraryPanel } from "./components/McpLibraryPanel";
import { PreviewDialog } from "./components/PreviewDialog";
import { ProfileSidebar, type AppWorkspace, type LibraryTab } from "./components/ProfileSidebar";
import { SkillLibraryPanel } from "./components/SkillLibraryPanel";
import { SkillsEditor } from "./components/SkillsEditor";

const emptyAssetPolicy: AssetPolicy = {
  ownedDirs: [],
  ownedFiles: [],
  skillRefs: [],
  mcpRefs: [],
  disabledSkillPaths: []
};

type EditorTab = "overview" | "instructions" | "config" | "resources" | "validation";
type ProfileDialogMode = "create" | "edit";

const editorTabs: Array<{ id: EditorTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "instructions", label: "Instructions" },
  { id: "config", label: "Config" },
  { id: "resources", label: "Resources" },
  { id: "validation", label: "Validation" }
];

const toSaveInput = (profile: ProfileDetail): SaveProfileInput => ({
  manifest: profile.manifest,
  instructions: profile.instructions,
  configText: profile.configText,
  assetPolicy: profile.assetPolicy
});

const managedSurfaceLabel = (key: string) => (key === "assets" ? "skills" : key);

const targetStatusLabel: Record<TargetInfo["health"]["status"], string> = {
  ready: "Ready",
  "needs-setup": "Needs setup",
  missing: "Missing",
  guarded: "Guarded"
};

const countProfileResources = (profile: ProfileDetail) => {
  const ownedSkills =
    profile.assetPolicy.ownedDirs.filter((entry) => entry.kind === "skill").length +
    profile.assetPolicy.ownedFiles.filter((entry) => entry.kind === "skill").length;
  const ownedAgents =
    profile.assetPolicy.ownedDirs.filter((entry) => entry.kind === "agent").length +
    profile.assetPolicy.ownedFiles.filter((entry) => entry.kind === "agent").length;
  const librarySkills = profile.assetPolicy.skillRefs.length;
  const mcpServers = profile.assetPolicy.mcpRefs.length;

  return {
    agents: ownedAgents,
    skills: ownedSkills + librarySkills,
    librarySkills,
    mcpServers,
    disabledSkills: profile.assetPolicy.disabledSkillPaths.length,
    total: ownedAgents + ownedSkills + librarySkills + mcpServers
  };
};

type ProfileResourceSummary = ReturnType<typeof countProfileResources>;

const formatShortDate = (value?: string) => {
  if (!value) {
    return "No activity";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
};

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
  const [skillUsage, setSkillUsage] = useState<Record<string, string[]>>({});
  const [mcpUsage, setMcpUsage] = useState<Record<string, string[]>>({});
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [preview, setPreview] = useState<ActivationPreview>();
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview>();
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>("library");
  const [activeLibraryTab, setActiveLibraryTab] = useState<LibraryTab>("skills");
  const [skillLibraryTool, setSkillLibraryTool] = useState<"import" | "discoveries">();
  const [profileSearch, setProfileSearch] = useState("");
  const [activeTab, setActiveTab] = useState<EditorTab>("overview");
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

  const refreshProfiles = async () => {
    const [
      targetItems,
      profileItems,
      backupItems,
      skillItems,
      mcpItems,
      skillUpdateItems,
      skillInventoryItems,
      settings
    ] = await Promise.all([
      window.agentEnv.listTargets(),
      window.agentEnv.listProfiles(),
      window.agentEnv.listBackups(),
      window.agentEnv.listSkillLibrary(),
      window.agentEnv.listMcpLibrary(),
      window.agentEnv.checkSkillLibraryUpdates(),
      window.agentEnv.scanSkillInventory(),
      window.agentEnv.readSettings()
    ]);
    const profileDetails = await Promise.all(
      profileItems.map((profile) => window.agentEnv.readProfile(profile.id))
    );
    const usage: Record<string, string[]> = {};
    const nextMcpUsage: Record<string, string[]> = {};
    const nextProfileResourceCounts: Record<string, ProfileResourceSummary> = {};
    for (const profile of profileDetails) {
      nextProfileResourceCounts[profile.id] = countProfileResources(profile);
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
    setProfiles(profileItems);
    setBackups(backupItems);
    setLibrarySkills(skillItems);
    setMcpServers(mcpItems);
    setSkillUpdates(skillUpdateItems);
    setSkillInventory(skillInventoryItems);
    setSkillSettings(settings);
    setSkillUsage(usage);
    setMcpUsage(nextMcpUsage);
    setProfileResourceCounts(nextProfileResourceCounts);
    setSelectedTargetId((current) => current ?? targetItems[0]?.id);
    return { targetItems, profileItems, backupItems };
  };

  useEffect(() => {
    let isMounted = true;

    refreshProfiles()
      .then(async ({ profileItems }) => {
        if (!isMounted || profileItems.length !== 1) {
          return;
        }

        const [onlyProfile] = profileItems;
        setSelectedProfileId(onlyProfile.id);
        setActiveTab("overview");
        const profile = await window.agentEnv.readProfile(onlyProfile.id);
        if (isMounted) {
          setDraftProfile(profile);
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
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    setRollbackPreview(undefined);
    setActiveTab("overview");
    setActiveWorkspace("profiles");
    setSelectedProfileId(profileId);
    try {
      const profile = await window.agentEnv.readProfile(profileId);
      setDraftProfile(profile);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!draftProfile) {
      return undefined;
    }

    const saved = await window.agentEnv.saveProfile(toSaveInput(draftProfile));
    setDraftProfile(saved);
    await refreshProfiles();
    return saved;
  };

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
        const saved = await window.agentEnv.saveProfile(toSaveInput(updatedProfile));
        await refreshProfiles();
        setSelectedProfileId(saved.id);
        setDraftProfile(saved);
      }
      setActiveTab("overview");
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
    try {
      const saved = await window.agentEnv.duplicateProfile(selectedProfileId);
      await refreshProfiles();
      setSelectedTargetId(saved.manifest.targetId);
      setSelectedProfileId(saved.id);
      setDraftProfile(saved);
      setActiveTab("overview");
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
    setSelectedTargetId(targetId);
    setSelectedProfileId(undefined);
    setDraftProfile(undefined);
    setPreview(undefined);
    setRollbackPreview(undefined);
    setActiveTab("overview");
    setIsTargetMenuOpen(false);
  };

  const selectedTarget = targets.find(
    (target) => target.id === (draftProfile?.manifest.targetId ?? selectedTargetId)
  );
  const targetProfiles = profiles.filter(
    (profile) => !selectedTargetId || profile.targetId === selectedTargetId
  );
  const normalizedProfileSearch = profileSearch.trim().toLowerCase();
  const visibleProfiles = targetProfiles.filter((profile) => {
    if (normalizedProfileSearch.length === 0) {
      return true;
    }

    return `${profile.name} ${profile.description}`.toLowerCase().includes(normalizedProfileSearch);
  });
  const activeTargetName = selectedTarget?.name ?? draftProfile?.manifest.targetId ?? "target";
  const activeTabPanelId = `editor-panel-${activeTab}`;
  const managedSurfaces = draftProfile
    ? Object.entries(draftProfile.manifest.managed)
        .filter(([, enabled]) => enabled)
        .map(([key]) => managedSurfaceLabel(key))
        .join(" / ")
    : "";
  const managedSurfaceCount = draftProfile
    ? Object.values(draftProfile.manifest.managed).filter(Boolean).length
    : 0;
  const resourceSummary = draftProfile ? countProfileResources(draftProfile) : undefined;
  const validationRows = draftProfile
    ? createValidationRows(draftProfile, selectedTarget, preview)
    : [];
  const canApply = Boolean(
    preview &&
      preview.errors.length === 0 &&
      !rollbackPreview &&
      (selectedTarget?.health.canWrite ?? false)
  );

  const totalResources = librarySkills.length + mcpServers.length;
  const updateCount = skillUpdates.filter((update) => update.updateAvailable).length;
  const readyTargetCount = targets.filter((target) => target.health.status === "ready").length;

  const previewSelectedProfile = async () => {
    setBusy(true);
    setError(undefined);
    setRollbackPreview(undefined);
    try {
      const saved = await saveDraft();
      if (!saved) {
        return;
      }
      const nextPreview = await window.agentEnv.previewApply(saved.id);
      setPreview(nextPreview);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const applySelectedProfile = async () => {
    if (!draftProfile || !preview) {
      return;
    }

    setBusy(true);
    setError(undefined);
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
    setBusy(true);
    setError(undefined);
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
    try {
      const result = await window.agentEnv.rollback(rollbackPreview.backupId);
      if (!result.ok) {
        setError(result.errors.join("\n"));
        return;
      }
      setRollbackPreview(undefined);
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
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
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
      await refreshProfiles();
      if (failures.length > 0) {
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
    try {
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
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
    try {
      const updatePlan = await window.agentEnv.previewLibrarySkillUpdate(id);
      setSelectedSkillUpdatePlan(updatePlan);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const updateSkillSettings = async (input: Partial<AgentEnvSettings>) => {
    setBusy(true);
    setError(undefined);
    try {
      const nextSettings = await window.agentEnv.updateSettings(input);
      setSkillSettings(nextSettings);
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
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

  const totalInstalledSkills = new Set(
    skillInventory.flatMap((skill) => skill.foundIn.map((targetId) => `${targetId}:${skill.id}`))
  ).size;
  const githubSkillCount = librarySkills.filter((skill) => skill.sourceType === "github").length;
  const localSkillCount = librarySkills.filter((skill) => skill.sourceType === "local").length;
  const usedSkillCount = librarySkills.filter((skill) => (skillUsage[skill.id] ?? []).length > 0).length;
  const needsManagementCount = skillInventory.filter((skill) => skill.status !== "managed").length;

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
        onWorkspaceSelect={setActiveWorkspace}
        onLibraryTabSelect={setActiveLibraryTab}
        onCreate={openCreateProfileDialog}
      />

      <section
        className="editor-panel"
        aria-label={
          activeWorkspace === "library"
            ? "Library workspace"
            : activeWorkspace === "profiles"
              ? "Profile editor"
              : `${activeWorkspace} workspace`
        }
      >
        {error ? <p className="error">{error}</p> : null}
        {activeWorkspace === "library" ? (
          <>
            <header className="page-header library-page-header">
              <div>
                <h2>
                  <span>Library</span>
                  <span className="breadcrumb-separator">/</span>
                  <span>{activeLibraryTab === "skills" ? "Skills" : "MCP Servers"}</span>
                </h2>
                <p className="muted">
                  Manage reusable resources, track updates, and reuse them across profiles and targets.
                </p>
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
            <section className="metric-strip" aria-label="Library command center">
              <div className="metric-tile">
                <span className="metric-icon metric-icon--purple" aria-hidden="true">
                  {activeLibraryTab === "skills" ? (
                    <BookOpenText size={21} strokeWidth={2.2} />
                  ) : (
                    <Network size={21} strokeWidth={2.2} />
                  )}
                </span>
                <div>
                  <strong>{activeLibraryTab === "skills" ? librarySkills.length : mcpServers.length}</strong>
                  <small>{activeLibraryTab === "skills" ? "Total Skills" : "MCP Servers"}</small>
                  <span>{activeLibraryTab === "skills" ? `${localSkillCount} local · ${githubSkillCount} GitHub` : `${totalResources} library resources`}</span>
                </div>
              </div>
              <div className="metric-tile">
                <span className="metric-icon metric-icon--green" aria-hidden="true">
                  <RefreshCw size={21} strokeWidth={2.2} />
                </span>
                <div>
                  <strong>{updateCount}</strong>
                  <small>Updates</small>
                  <span>{skillUpdates.length} tracked checks</span>
                </div>
              </div>
              <div className="metric-tile">
                <span className="metric-icon metric-icon--amber" aria-hidden="true">
                  <FolderKanban size={21} strokeWidth={2.2} />
                </span>
                <div>
                  <strong>{activeLibraryTab === "skills" ? usedSkillCount : Object.keys(mcpUsage).length}</strong>
                  <small>In use</small>
                  <span>Across {profiles.length} profiles</span>
                </div>
              </div>
              <div className="metric-tile">
                <span className="metric-icon metric-icon--blue" aria-hidden="true">
                  <MonitorCheck size={21} strokeWidth={2.2} />
                </span>
                <div>
                  <strong>{activeLibraryTab === "skills" ? totalInstalledSkills : readyTargetCount}</strong>
                  <small>Installs</small>
                  <span>{activeLibraryTab === "skills" ? "Target copies" : `${readyTargetCount}/${targets.length || 0} ready`}</span>
                </div>
              </div>
              {activeLibraryTab === "skills" ? (
                <button
                  className="metric-tile metric-tile--button"
                  type="button"
                  onClick={() => {
                    void openSkillDiscoveries();
                  }}
                >
                  <span className="metric-icon metric-icon--slate" aria-hidden="true">
                    <HardDrive size={21} strokeWidth={2.2} />
                  </span>
                  <div>
                    <strong>{needsManagementCount}</strong>
                    <small>Unmanaged</small>
                    <span>Target skills</span>
                  </div>
                </button>
              ) : null}
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
                onCheckUpdates={checkSkillUpdates}
              />
            ) : (
              <McpLibraryPanel
                mcpServers={mcpServers}
                mcpUsage={mcpUsage}
                onSave={saveMcpServer}
                onRemove={removeMcpServer}
              />
            )}
          </>
        ) : activeWorkspace === "profiles" ? (
          <>
            <header className="page-header profile-page-header">
              <div>
                <h2>Profiles</h2>
                <p className="muted">Manage reusable work environments and apply them to local agent targets.</p>
              </div>
              <div className="profile-page-actions">
                <div className="profile-apply-control">
                  <span>Apply to</span>
                  <span className="profile-apply-split">
                    <button
                      className="profile-apply-button"
                      type="button"
                      aria-label={`Apply to ${selectedTarget?.name ?? "Target"}`}
                      disabled={!selectedProfileId || busy}
                      onClick={previewSelectedProfile}
                    >
                      <Monitor size={17} strokeWidth={2.2} aria-hidden="true" />
                      <strong>{selectedTarget?.name ?? "Target"}</strong>
                    </button>
                    <button
                      className="profile-target-menu-button"
                      type="button"
                      aria-expanded={isTargetMenuOpen}
                      aria-haspopup="menu"
                      aria-label="Select apply target"
                      onClick={() => setIsTargetMenuOpen((current) => !current)}
                    >
                      <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                  </span>
                  {isTargetMenuOpen ? (
                    <div className="profile-target-menu" role="menu" aria-label="Profile targets">
                      {targets.map((target) => (
                        <button
                          className={target.id === selectedTargetId ? "is-selected" : ""}
                          type="button"
                          role="menuitemradio"
                          aria-checked={target.id === selectedTargetId}
                          key={target.id}
                          onClick={() => selectTarget(target.id)}
                        >
                          <Monitor size={16} strokeWidth={2.2} aria-hidden="true" />
                          <span>{target.name}</span>
                          {target.id === selectedTargetId ? (
                            <CheckCircle2 size={15} strokeWidth={2.2} aria-hidden="true" />
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  className="icon-action"
                  type="button"
                  aria-expanded={isProfileActionsOpen}
                  aria-haspopup="menu"
                  aria-label="More profile actions"
                  disabled={!selectedProfileId}
                  onClick={() => setIsProfileActionsOpen((current) => !current)}
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
            <section className="profile-workbench" aria-label="Profiles">
              <aside className="profile-index" aria-label="Profile list">
                <div className="profile-list-toolbar">
                  <label className="profile-search">
                    <Search size={15} strokeWidth={2.2} aria-hidden="true" />
                    <input
                      aria-label="Search profiles"
                      placeholder="Search Profile name..."
                      value={profileSearch}
                      onChange={(event) => setProfileSearch(event.currentTarget.value)}
                    />
                  </label>
                </div>
                <div className="profile-list">
                  {isLoading ? <p className="muted">Loading profiles...</p> : null}
                  {!isLoading && visibleProfiles.length === 0 ? <p className="muted">No profiles</p> : null}
                  {visibleProfiles.map((profile, index) => {
                    const counts = profileResourceCounts[profile.id];
                    return (
                    <button
                      className={`profile-row${profile.id === selectedProfileId ? " is-active" : ""}`}
                      type="button"
                      key={profile.id}
                      onClick={() => selectProfile(profile.id)}
                    >
                      <span className={`profile-row__icon profile-row__icon--${index % 5}`} aria-hidden="true">
                        <Rocket size={18} strokeWidth={2.2} />
                      </span>
                      <span className="profile-row__content">
                        <span className="profile-row__title">
                          {profile.name}
                          <strong>{selectedTarget?.name ?? profile.targetId}</strong>
                        </span>
                        <small>{profile.description || "No description"}</small>
                        <span className="profile-row__stats">
                          <span>{counts?.skills ?? 0} Skills</span>
                          <span>{counts?.mcpServers ?? 0} MCP</span>
                          <span>1 Instructions</span>
                        </span>
                      </span>
                    </button>
                    );
                  })}
                </div>
                <button className="profile-new-button" type="button" onClick={openCreateProfileDialog}>
                  <Plus size={15} strokeWidth={2.3} />
                  New Profile
                </button>
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
                            aria-label="Edit profile details"
                            onClick={openEditProfileDialog}
                          >
                            <Pencil size={15} strokeWidth={2.2} />
                          </button>
                        </div>
                        <p className="profile-description">
                          {draftProfile.manifest.description || "No description"}
                        </p>
                        <div className="profile-hero__meta">
                          <span className="success-pill">{activeTargetName}</span>
                          <span>
                            <CalendarDays size={14} strokeWidth={2.2} />
                            Local profile
                          </span>
                          <span>
                            <RefreshCw size={14} strokeWidth={2.2} />
                            {formatShortDate(backups[0]?.createdAt)}
                          </span>
                        </div>
                      </div>
                    </header>
            <div className="tab-list" role="tablist" aria-label="Profile sections">
              {editorTabs.map((tab) => (
                <button
                  className={`tab-button${activeTab === tab.id ? " is-active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`editor-panel-${tab.id}`}
                  id={`editor-tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {activeTab !== "overview" ? (
              <section className="profile-editor-actions" aria-label="Profile edit actions">
                <div>
                  <strong>Unsaved profile edits</strong>
                  <small>Save changes before applying this profile.</small>
                </div>
                <button className="save-button" type="button" disabled={busy} onClick={saveDraft}>
                  Save
                </button>
              </section>
            ) : null}
            <div
              className="editor-grid"
              id={activeTabPanelId}
              role="tabpanel"
              aria-labelledby={`editor-tab-${activeTab}`}
            >
              {activeTab === "overview" ? (
                <section className="profile-overview" aria-label="Profile overview">
                  <section className="profile-overview-section" aria-label="Resource overview">
                    <div className="profile-section-heading">Resource overview</div>
                    <div className="resource-overview-grid">
                      <div className="resource-overview-card">
                        <span className="resource-overview-icon resource-overview-icon--purple">
                          <BookOpenText size={21} strokeWidth={2.2} />
                        </span>
                        <div>
                          <strong>{draftProfile.manifest.managed.instructions ? 1 : 0}</strong>
                          <span>Instructions</span>
                          <small>From profile</small>
                        </div>
                      </div>
                      <div className="resource-overview-card">
                        <span className="resource-overview-icon resource-overview-icon--green">
                          <Database size={21} strokeWidth={2.2} />
                        </span>
                        <div>
                          <strong>{resourceSummary?.skills ?? 0}</strong>
                          <span>Skills</span>
                          <small>{resourceSummary?.librarySkills ?? 0} from Library</small>
                        </div>
                      </div>
                      <div className="resource-overview-card">
                        <span className="resource-overview-icon resource-overview-icon--blue">
                          <Network size={21} strokeWidth={2.2} />
                        </span>
                        <div>
                          <strong>{resourceSummary?.mcpServers ?? 0}</strong>
                          <span>MCP Servers</span>
                          <small>From Library</small>
                        </div>
                      </div>
                      <div className="resource-overview-card">
                        <span className="resource-overview-icon resource-overview-icon--amber">
                          <Settings2 size={21} strokeWidth={2.2} />
                        </span>
                        <div>
                          <strong>{managedSurfaceCount}</strong>
                          <span>Managed areas</span>
                          <small>{managedSurfaces || "None"}</small>
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="profile-overview-section" aria-label="Target compatibility">
                    <div className="profile-section-heading">Target compatibility</div>
                    <div className="compatibility-grid">
                      {targets.map((target) => {
                        const directTarget = target.id === draftProfile.manifest.targetId;
                        const tone = directTarget ? target.health.status : "guarded";
                        return (
                          <div className="compatibility-item" key={target.id}>
                            <span className={`compatibility-icon compatibility-icon--${tone}`}>
                              <Monitor size={20} strokeWidth={2.2} />
                            </span>
                            <div>
                              <strong>{target.name}</strong>
                              <small>
                                {directTarget
                                  ? target.health.status === "ready"
                                    ? "Direct apply"
                                    : targetStatusLabel[target.health.status]
                                  : "Target-specific profile required"}
                              </small>
                            </div>
                            {directTarget && target.health.status === "ready" ? (
                              <CheckCircle2 size={15} strokeWidth={2.2} />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                  <section className="profile-overview-section recent-apply-section">
                    <div className="profile-section-heading">Recent application records</div>
                    <HistoryView
                      backups={backups}
                      busy={busy}
                      rollbackPreview={rollbackPreview}
                      onPreviewRollback={previewSelectedRollback}
                      onRestoreRollback={restoreSelectedRollback}
                    />
                  </section>
                </section>
              ) : null}
              {activeTab === "instructions" ? (
                <AgentsEditor
                  label={selectedTarget?.instructionsLabel ?? "Instructions"}
                  value={draftProfile.instructions}
                  onChange={(instructions) => {
                    setDraftProfile({ ...draftProfile, instructions });
                    setPreview(undefined);
                    setRollbackPreview(undefined);
                  }}
                />
              ) : null}
              {activeTab === "config" ? (
                <McpEditor
                  label={selectedTarget?.configLabel ?? "Config"}
                  value={draftProfile.configText}
                  onChange={(configText) => {
                    setDraftProfile({ ...draftProfile, configText });
                    setPreview(undefined);
                    setRollbackPreview(undefined);
                  }}
                />
              ) : null}
              {activeTab === "resources" ? (
                <SkillsEditor
                  value={draftProfile.assetPolicy ?? emptyAssetPolicy}
                  configText={draftProfile.configText}
                  configLanguage={selectedTarget?.configLanguage}
                  preview={preview}
                  librarySkills={librarySkills}
                  mcpServers={mcpServers}
                  onChange={(assetPolicy) => {
                    setDraftProfile({ ...draftProfile, assetPolicy });
                    setPreview(undefined);
                    setRollbackPreview(undefined);
                  }}
                />
              ) : null}
              {activeTab === "validation" ? (
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
              ) : null}
            </div>
            {rollbackPreview ? (
              <PreviewDialog preview={rollbackPreview} title="Rollback preview" />
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
                  <div className="empty-state">
                    <h2>No profile selected</h2>
                    <p className="muted">Choose a profile from the list or create a new one.</p>
                  </div>
                )}
              </div>
              {profileDialogMode ? (
                <div className="preview-modal-backdrop">
                  <section className="profile-form-dialog" role="dialog" aria-label={profileDialogMode === "create" ? "New profile" : "Edit profile"} aria-modal="true">
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
                <div className="preview-modal-backdrop">
                  <section className="profile-form-dialog profile-form-dialog--compact" role="dialog" aria-label="Delete profile" aria-modal="true">
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
          <section className="target-page" aria-label="Targets">
            <header className="page-header">
              <div>
                <h2>Targets</h2>
                <p className="muted">Local agent runtimes that receive managed resources.</p>
              </div>
            </header>
            <div className="target-grid">
              {targets.map((target) => (
                <article
                  aria-label={`Target ${target.name}`}
                  className="target-card"
                  key={target.id}
                >
                  <div className="target-card__header">
                    <div>
                      <strong>{target.name}</strong>
                      <small>{target.description}</small>
                    </div>
                    <span className={`target-badge target-badge--${target.health.status}`}>
                      {targetStatusLabel[target.health.status]}
                    </span>
                  </div>
                  <code title={target.paths.configDir}>{target.paths.configDir}</code>
                  <div className="target-checks">
                    {target.health.checks.map((check) => (
                      <div className="target-check" key={check.id}>
                        <div>
                          <span>{check.label}</span>
                          <code title={check.path}>{check.path}</code>
                        </div>
                        <strong>{check.exists ? (check.writable ? "Writable" : "Read-only") : "Missing"}</strong>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : activeWorkspace === "activity" ? (
          <section className="activity-page" aria-label="Activity">
            <header className="page-header">
              <div>
                <h2>Activity</h2>
                <p className="muted">Backups, rollback previews, and recent safety checkpoints.</p>
              </div>
            </header>
            <HistoryView
              backups={backups}
              busy={busy}
              rollbackPreview={rollbackPreview}
              onPreviewRollback={previewSelectedRollback}
              onRestoreRollback={restoreSelectedRollback}
            />
            {rollbackPreview ? <PreviewDialog preview={rollbackPreview} title="Rollback preview" /> : null}
          </section>
        ) : activeWorkspace === "settings" ? (
          <section className="settings-page" aria-label="Settings">
            <header className="page-header">
              <div>
                <h2>Settings</h2>
                <p className="muted">Global library storage and target install defaults.</p>
              </div>
            </header>
            <section className="resource-section">
              <div>
                <div className="resource-heading">Library install defaults</div>
                <p className="muted">These settings control how library skills are placed onto targets.</p>
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
                <label>
                  <span>Auto-check</span>
                  <select
                    aria-label="Skill auto update check"
                    value={skillSettings.skillAutoCheckEnabled ? "enabled" : "disabled"}
                    onChange={(event) =>
                      updateSkillSettings({
                        skillAutoCheckEnabled: event.currentTarget.value === "enabled"
                      })
                    }
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </label>
                <label>
                  <span>Check interval</span>
                  <input
                    aria-label="Skill auto check interval minutes"
                    min={5}
                    max={1440}
                    step={5}
                    type="number"
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
          </section>
        ) : rollbackPreview ? (
          <PreviewDialog preview={rollbackPreview} title="Rollback preview" />
        ) : (
          <div className="empty-state">
            <h2>No profile selected</h2>
          </div>
        )}
      </section>

      {activeWorkspace !== "library" && activeWorkspace !== "profiles" ? (
        <aside className="activation-panel library-summary-panel" aria-label="Workspace summary">
          <div className="activation-header">
            <p className="section-title">{activeWorkspace}</p>
            <h2>{activeWorkspace === "targets" ? "Runtime health" : activeWorkspace === "activity" ? "Safety log" : "Global defaults"}</h2>
          </div>
          <section className="safety-checks">
            <div className="check-row">
              <span>Targets ready</span>
              <strong>{readyTargetCount}/{targets.length || 0}</strong>
            </div>
            <div className="check-row">
              <span>Backups</span>
              <strong>{backups.length}</strong>
            </div>
            <div className="check-row">
              <span>Library resources</span>
              <strong>{totalResources}</strong>
            </div>
          </section>
        </aside>
      ) : null}
    </main>
  );
};
