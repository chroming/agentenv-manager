import { useEffect, useState } from "react";
import type {
  ActivationPreview,
  AssetPolicy,
  BackupSummary,
  ProfileDetail,
  ProfileSummary,
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
    setPreview(undefined);
  };

  const selectedTarget = targets.find(
    (target) => target.id === (draftProfile?.manifest.targetId ?? selectedTargetId)
  );
  const visibleProfiles = profiles.filter(
    (profile) => !selectedTargetId || profile.targetId === selectedTargetId
  );

  const previewSelectedProfile = async () => {
    setBusy(true);
    setError(undefined);
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
        }}
        onSelect={selectProfile}
        onCreate={createProfile}
      />

      <section className="editor-panel" aria-label="Profile editor">
        {error ? <p className="error">{error}</p> : null}
        {draftProfile ? (
          <>
            <header className="editor-header">
              <div>
                <p className="eyebrow">
                  {selectedTarget?.name ?? draftProfile.manifest.targetId} Environment
                </p>
                <h2>{draftProfile.manifest.name}</h2>
              </div>
              <button type="button" disabled={busy} onClick={saveDraft}>
                Save
              </button>
            </header>
            <div className="editor-grid">
              <AgentsEditor
                label={selectedTarget?.instructionsLabel ?? "Instructions"}
                value={draftProfile.instructions}
                onChange={(instructions) => {
                  setDraftProfile({ ...draftProfile, instructions });
                  setPreview(undefined);
                }}
              />
              <McpEditor
                label={selectedTarget?.configLabel ?? "Config"}
                value={draftProfile.configText}
                onChange={(configText) => {
                  setDraftProfile({ ...draftProfile, configText });
                  setPreview(undefined);
                }}
              />
              <SkillsEditor
                value={draftProfile.assetPolicy ?? emptyAssetPolicy}
                onChange={(assetPolicy) => {
                  setDraftProfile({ ...draftProfile, assetPolicy });
                  setPreview(undefined);
                }}
              />
              <PreviewDialog preview={preview} />
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>No profile selected</h2>
          </div>
        )}
      </section>

      <ActivationPanel
        selectedProfileId={draftProfile?.id}
        preview={preview}
        backups={backups}
        busy={busy}
        onPreview={previewSelectedProfile}
        onApply={applySelectedProfile}
      />
    </main>
  );
};
