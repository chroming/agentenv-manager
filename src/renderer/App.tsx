import { useEffect, useState } from "react";
import type {
  ActivationPreview,
  AssetPolicy,
  BackupSummary,
  ProfileDetail,
  ProfileSummary,
  RollbackPreview,
  SaveProfileInput,
  TargetDescriptor
} from "../shared/types";
import { ActivationPanel } from "./components/ActivationPanel";
import { AgentsEditor } from "./components/AgentsEditor";
import { McpEditor } from "./components/McpEditor";
import { PreviewDialog } from "./components/PreviewDialog";
import { ProfileSidebar } from "./components/ProfileSidebar";
import { SkillsEditor } from "./components/SkillsEditor";

const emptyAssetPolicy: AssetPolicy = {
  ownedDirs: [],
  disabledSkillPaths: []
};

type EditorTab = "instructions" | "config" | "assets" | "validation";

const editorTabs: Array<{ id: EditorTab; label: string }> = [
  { id: "instructions", label: "Instructions" },
  { id: "config", label: "Config" },
  { id: "assets", label: "Assets" },
  { id: "validation", label: "Validation" }
];

const getLivePathLabel = (targetId?: string) => {
  if (targetId === "opencode") {
    return "~/.config/opencode";
  }

  if (targetId === "codex") {
    return "sandboxed Codex home";
  }

  return "target workspace";
};

const toSaveInput = (profile: ProfileDetail): SaveProfileInput => ({
  manifest: profile.manifest,
  instructions: profile.instructions,
  configText: profile.configText,
  assetPolicy: profile.assetPolicy
});

export const App = () => {
  const [targets, setTargets] = useState<TargetDescriptor[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [preview, setPreview] = useState<ActivationPreview>();
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview>();
  const [activeTab, setActiveTab] = useState<EditorTab>("instructions");
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refreshProfiles = async () => {
    const [targetItems, profileItems, backupItems] = await Promise.all([
      window.agentEnv.listTargets(),
      window.agentEnv.listProfiles(),
      window.agentEnv.listBackups()
    ]);
    setTargets(targetItems);
    setProfiles(profileItems);
    setBackups(backupItems);
    setSelectedTargetId((current) => current ?? targetItems[0]?.id);
  };

  useEffect(() => {
    let isMounted = true;

    refreshProfiles()
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
  const activeTabPanelId = `editor-panel-${activeTab}`;

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

  return (
    <main className="app-shell">
      <ProfileSidebar
        targets={targets}
        profiles={visibleProfiles}
        selectedProfileId={selectedProfileId}
        selectedTargetId={selectedTargetId}
        isLoading={isLoading}
        onTargetSelect={(targetId) => {
          setSelectedTargetId(targetId);
          setSelectedProfileId(undefined);
          setDraftProfile(undefined);
          setPreview(undefined);
          setRollbackPreview(undefined);
          setActiveTab("instructions");
        }}
        onSelect={selectProfile}
        onCreate={createProfile}
      />

      <section className="editor-panel" aria-label="Profile editor">
        {error ? <p className="error">{error}</p> : null}
        {draftProfile ? (
          <>
            <header className="editor-header">
              <div className="editor-title">
                <p className="eyebrow">{activeTargetName} Environment</p>
                <h2>{draftProfile.manifest.name}</h2>
                <p className="target-path">
                  Live path: {getLivePathLabel(draftProfile.manifest.targetId)}
                </p>
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
              {activeTab === "assets" ? (
                <SkillsEditor
                  value={draftProfile.assetPolicy ?? emptyAssetPolicy}
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
                  {preview?.errors.length ? (
                    preview.errors.map((item) => (
                      <p className="error" key={item}>
                        {item}
                      </p>
                    ))
                  ) : (
                    <div className="validation-grid">
                      <div className="check-row">
                        <span>No literal secrets found</span>
                        <strong>OK</strong>
                      </div>
                      <div className="check-row">
                        <span>No unmanaged MCP conflict</span>
                        <strong>{preview ? "OK" : "Pending"}</strong>
                      </div>
                      <div className="check-row">
                        <span>Backup before apply</span>
                        <strong>Enabled</strong>
                      </div>
                    </div>
                  )}
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

      <ActivationPanel
        selectedProfileId={draftProfile?.id}
        targetName={activeTargetName}
        preview={preview}
        rollbackPreview={rollbackPreview}
        backups={backups}
        busy={busy}
        onPreview={previewSelectedProfile}
        onApply={applySelectedProfile}
        onPreviewRollback={previewSelectedRollback}
        onRestoreRollback={restoreSelectedRollback}
      />
    </main>
  );
};
