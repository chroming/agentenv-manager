import { useEffect, useState } from "react";
import {
  Database,
  BookOpenText,
  FolderKanban,
  HardDrive,
  MonitorCheck,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  ScanLine
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
import { ActivationPanel } from "./components/ActivationPanel";
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

type EditorTab = "instructions" | "config" | "resources" | "validation";

const editorTabs: Array<{ id: EditorTab; label: string }> = [
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

const targetReadinessDetail = (target?: TargetInfo) => {
  if (!target) {
    return "Target discovery is still loading.";
  }
  if (target.health.status === "ready") {
    return "Ready for preview and apply.";
  }
  return "Fix target access before applying.";
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
  const [skillSettings, setSkillSettings] = useState<AgentEnvSettings>({
    skillSyncMethod: "symlink",
    skillStorageLocation: "appData"
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
  const [activeTab, setActiveTab] = useState<EditorTab>("instructions");
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
    for (const profile of profileDetails) {
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
        setActiveTab("instructions");
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

  const selectProfile = async (profileId: string) => {
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    setRollbackPreview(undefined);
    setActiveTab("instructions");
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

  const createProfile = async () => {
    const targetId = selectedTargetId ?? targets[0]?.id;
    if (!targetId) {
      setError("No target available");
      return;
    }
    const saved = await window.agentEnv.createProfile(targetId);
    await refreshProfiles();
    setSelectedProfileId(saved.id);
    setDraftProfile(saved);
    setActiveTab("instructions");
    setActiveWorkspace("profiles");
    setPreview(undefined);
    setRollbackPreview(undefined);
  };

  const selectedTarget = targets.find(
    (target) => target.id === (draftProfile?.manifest.targetId ?? selectedTargetId)
  );
  const visibleProfiles = profiles.filter(
    (profile) => !selectedTargetId || profile.targetId === selectedTargetId
  );
  const activeTargetName = selectedTarget?.name ?? draftProfile?.manifest.targetId ?? "target";
  const activeTargetPath = selectedTarget?.paths.configDir ?? "target workspace";
  const activeTargetStatus = selectedTarget
    ? targetStatusLabel[selectedTarget.health.status]
    : "Pending";
  const activeTargetSummary =
    selectedTarget && selectedTarget.health.summary !== activeTargetStatus
      ? selectedTarget.health.summary
      : selectedTarget
        ? `${selectedTarget.name} target`
        : "Target pending";
  const activeTabPanelId = `editor-panel-${activeTab}`;
  const managedSurfaces = draftProfile
    ? Object.entries(draftProfile.manifest.managed)
        .filter(([, enabled]) => enabled)
        .map(([key]) => managedSurfaceLabel(key))
        .join(" / ")
    : "";
  const validationRows = draftProfile
    ? createValidationRows(draftProfile, selectedTarget, preview)
    : [];

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
    <main className={`app-shell${activeWorkspace === "library" ? " app-shell--library" : ""}`}>
      <ProfileSidebar
        targets={targets}
        profiles={profiles}
        isLoading={isLoading}
        activeWorkspace={activeWorkspace}
        activeLibraryTab={activeLibraryTab}
        onWorkspaceSelect={setActiveWorkspace}
        onLibraryTabSelect={setActiveLibraryTab}
        onCreate={createProfile}
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
                      onClick={() => setSkillLibraryTool("discoveries")}
                    >
                      <ScanLine size={15} strokeWidth={2.2} />
                      Scan local Skills
                    </button>
                  </>
                ) : (
                  <button className="primary-inline-action" type="button">
                    <Plus size={16} strokeWidth={2.4} />
                    New MCP server
                  </button>
                )}
                <button className="icon-action" type="button" aria-label="More library actions">
                  <MoreHorizontal size={16} strokeWidth={2.2} />
                </button>
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
                  <small>Target installs</small>
                  <span>{activeLibraryTab === "skills" ? "Installed instances" : `${readyTargetCount}/${targets.length || 0} targets ready`}</span>
                </div>
              </div>
              <button
                className="metric-tile metric-tile--button"
                type="button"
                onClick={() => setSkillLibraryTool("discoveries")}
              >
                <span className="metric-icon metric-icon--slate" aria-hidden="true">
                  {activeLibraryTab === "skills" ? (
                    <HardDrive size={21} strokeWidth={2.2} />
                  ) : (
                    <Database size={21} strokeWidth={2.2} />
                  )}
                </span>
                <div>
                  <strong>{needsManagementCount}</strong>
                  <small>Needs management</small>
                  <span>Imported target skills</span>
                </div>
              </button>
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
                onImportUnmanaged={importUnmanagedSkill}
                onImportGitHubSkill={importGitHubSkill}
                onManageTargetSkill={manageTargetSkill}
                onSetUpdateSource={setSkillUpdateSource}
                onPreviewLibrarySkillUpdate={previewLibrarySkillUpdate}
                onUpdateLibrarySkill={updateLibrarySkill}
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
            <header className="page-header">
              <div>
                <h2>Profiles</h2>
                <p className="muted">Compose reusable library resources into ready-to-apply environments.</p>
              </div>
              <label className="profile-target-filter">
                <span>Target</span>
                <select
                  aria-label="Profile target"
                  value={selectedTargetId ?? ""}
                  onChange={(event) => {
                    setSelectedTargetId(event.currentTarget.value);
                    setSelectedProfileId(undefined);
                    setDraftProfile(undefined);
                    setPreview(undefined);
                    setRollbackPreview(undefined);
                    setActiveTab("instructions");
                  }}
                >
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
              </label>
            </header>
            <section className="profile-workbench" aria-label="Profiles">
              <aside className="profile-index" aria-label="Profile list">
                <div className="section-title">Profiles</div>
                <div className="profile-list">
                  {isLoading ? <p className="muted">Loading profiles...</p> : null}
                  {!isLoading && visibleProfiles.length === 0 ? <p className="muted">No profiles</p> : null}
                  {visibleProfiles.map((profile) => (
                    <button
                      className={`profile-row${profile.id === selectedProfileId ? " is-active" : ""}`}
                      type="button"
                      key={profile.id}
                      onClick={() => selectProfile(profile.id)}
                    >
                      <span>{profile.name}</span>
                      <small>{profile.description}</small>
                    </button>
                  ))}
                </div>
              </aside>
              <div className="profile-editor-surface">
                {draftProfile ? (
                  <>
            <header className="editor-header">
              <div className="editor-title">
                <p className="eyebrow">{activeTargetName} Environment</p>
                <h2>{draftProfile.manifest.name}</h2>
                <section
                  className={`target-readiness target-readiness--${selectedTarget?.health.status ?? "pending"}`}
                  aria-label="Target readiness"
                >
                  <strong
                    className={`target-badge target-badge--${selectedTarget?.health.status ?? "needs-setup"}`}
                  >
                    {activeTargetStatus}
                  </strong>
                  <div className="target-readiness__main">
                    <span>{activeTargetSummary}</span>
                    <code title={activeTargetPath}>{activeTargetPath}</code>
                  </div>
                  <small>{targetReadinessDetail(selectedTarget)}</small>
                </section>
                <div className="editor-meta" aria-label="Profile metadata">
                  <span>{managedSurfaces || "No managed surfaces"}</span>
                </div>
              </div>
              <button className="save-button" type="button" disabled={busy} onClick={saveDraft}>
                Save
              </button>
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
            <div
              className="editor-grid"
              id={activeTabPanelId}
              role="tabpanel"
              aria-labelledby={`editor-tab-${activeTab}`}
            >
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
            <PreviewDialog
              preview={rollbackPreview ?? preview}
              title={rollbackPreview ? "Rollback preview" : "Preview"}
            />
                  </>
                ) : (
                  <div className="empty-state">
                    <h2>No profile selected</h2>
                    <p className="muted">Choose a profile from the list or create a new one.</p>
                  </div>
                )}
              </div>
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
                <article className="target-card" key={target.id}>
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

      {activeWorkspace === "profiles" ? (
        <ActivationPanel
          selectedProfileId={draftProfile?.id}
          targetName={activeTargetName}
          preview={preview}
          rollbackPreview={rollbackPreview}
          backups={backups}
          busy={busy}
          targetCanWrite={selectedTarget?.health.canWrite ?? false}
          targetWriteSummary={selectedTarget?.health.summary}
          onPreview={previewSelectedProfile}
          onApply={applySelectedProfile}
          onPreviewRollback={previewSelectedRollback}
          onRestoreRollback={restoreSelectedRollback}
        />
      ) : activeWorkspace !== "library" ? (
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
