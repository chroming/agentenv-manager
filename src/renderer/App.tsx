import { useEffect, useState } from "react";
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
  SkillLibraryEntry,
  SkillUpdateInfo,
  TargetInfo,
  UnmanagedSkillEntry
} from "../shared/types";
import { ActivationPanel } from "./components/ActivationPanel";
import { AgentsEditor } from "./components/AgentsEditor";
import { LibrarySummaryPanel } from "./components/LibrarySummaryPanel";
import { McpEditor } from "./components/McpEditor";
import { PreviewDialog } from "./components/PreviewDialog";
import { ProfileSidebar } from "./components/ProfileSidebar";
import { SkillLibraryPanel } from "./components/SkillLibraryPanel";
import { SkillsEditor } from "./components/SkillsEditor";

const emptyAssetPolicy: AssetPolicy = {
  ownedDirs: [],
  ownedFiles: [],
  skillRefs: [],
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
  const [skillUpdates, setSkillUpdates] = useState<SkillUpdateInfo[]>([]);
  const [unmanagedSkills, setUnmanagedSkills] = useState<UnmanagedSkillEntry[]>([]);
  const [skillSettings, setSkillSettings] = useState<AgentEnvSettings>({
    skillSyncMethod: "symlink",
    skillStorageLocation: "appData"
  });
  const [skillUsage, setSkillUsage] = useState<Record<string, string[]>>({});
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [preview, setPreview] = useState<ActivationPreview>();
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview>();
  const [activeWorkspace, setActiveWorkspace] = useState<"profile" | "skill-library">("profile");
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
      skillUpdateItems,
      unmanagedItems,
      settings
    ] = await Promise.all([
      window.agentEnv.listTargets(),
      window.agentEnv.listProfiles(),
      window.agentEnv.listBackups(),
      window.agentEnv.listSkillLibrary(),
      window.agentEnv.checkSkillLibraryUpdates(),
      window.agentEnv.scanUnmanagedSkills(),
      window.agentEnv.readSettings()
    ]);
    const profileDetails = await Promise.all(
      profileItems.map((profile) => window.agentEnv.readProfile(profile.id))
    );
    const usage: Record<string, string[]> = {};
    for (const profile of profileDetails) {
      for (const skillRef of profile.assetPolicy.skillRefs ?? []) {
        usage[skillRef.libraryId] = (usage[skillRef.libraryId] ?? []).concat(
          profile.manifest.name
        );
      }
    }
    setTargets(targetItems);
    setProfiles(profileItems);
    setBackups(backupItems);
    setLibrarySkills(skillItems);
    setSkillUpdates(skillUpdateItems);
    setUnmanagedSkills(unmanagedItems);
    setSkillSettings(settings);
    setSkillUsage(usage);
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
    setActiveWorkspace("profile");
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
    setActiveWorkspace("profile");
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
      await refreshProfiles();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setBusy(false);
    }
  };

  const updateAvailableLibrarySkills = async () => {
    const skillIds = skillUpdates
      .filter((update) => update.updateAvailable)
      .map((update) => update.id);
    if (skillIds.length === 0) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      for (const id of skillIds) {
        await window.agentEnv.updateLibrarySkill(id);
      }
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
      await refreshProfiles();
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

  return (
    <main className="app-shell">
      <ProfileSidebar
        targets={targets}
        profiles={visibleProfiles}
        selectedProfileId={selectedProfileId}
        selectedTargetId={selectedTargetId}
        isLoading={isLoading}
        activeWorkspace={activeWorkspace}
        onWorkspaceSelect={setActiveWorkspace}
        onTargetSelect={(targetId) => {
          setSelectedTargetId(targetId);
          setSelectedProfileId(undefined);
          setDraftProfile(undefined);
          setPreview(undefined);
          setRollbackPreview(undefined);
          setActiveTab("instructions");
          setActiveWorkspace("profile");
        }}
        onSelect={selectProfile}
        onCreate={createProfile}
      />

      <section
        className="editor-panel"
        aria-label={activeWorkspace === "skill-library" ? "Skill library workspace" : "Profile editor"}
      >
        {error ? <p className="error">{error}</p> : null}
        {activeWorkspace === "skill-library" ? (
          <SkillLibraryPanel
            librarySkills={librarySkills}
            skillUpdates={skillUpdates}
            unmanagedSkills={unmanagedSkills}
            skillSettings={skillSettings}
            skillUsage={skillUsage}
            onImportUnmanaged={importUnmanagedSkill}
            onImportGitHubSkill={importGitHubSkill}
            onUpdateLibrarySkill={updateLibrarySkill}
            onUpdateAllAvailable={updateAvailableLibrarySkills}
            onCheckUpdates={checkSkillUpdates}
            onSkillSettingsChange={updateSkillSettings}
          />
        ) : draftProfile ? (
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
        ) : rollbackPreview ? (
          <PreviewDialog preview={rollbackPreview} title="Rollback preview" />
        ) : (
          <div className="empty-state">
            <h2>No profile selected</h2>
          </div>
        )}
      </section>

      {activeWorkspace === "skill-library" ? (
        <LibrarySummaryPanel
          librarySkills={librarySkills}
          skillUpdates={skillUpdates}
          skillSettings={skillSettings}
        />
      ) : (
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
      )}
    </main>
  );
};
