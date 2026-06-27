import { useEffect, useState } from "react";
import type {
  ActivationPreview,
  BackupSummary,
  ProfileDetail,
  ProfileSummary,
  SaveProfileInput,
  SkillsPolicy
} from "../shared/types";
import { ActivationPanel } from "./components/ActivationPanel";
import { AgentsEditor } from "./components/AgentsEditor";
import { McpEditor } from "./components/McpEditor";
import { PreviewDialog } from "./components/PreviewDialog";
import { ProfileSidebar } from "./components/ProfileSidebar";
import { SkillsEditor } from "./components/SkillsEditor";

const emptySkillsPolicy: SkillsPolicy = {
  ownedSkillDirs: [],
  disabledSkillPaths: []
};

const toSaveInput = (profile: ProfileDetail): SaveProfileInput => ({
  manifest: profile.manifest,
  agentsMd: profile.agentsMd,
  mcpToml: profile.mcpToml,
  skillsPolicy: profile.skillsPolicy
});

const createDraftProfile = (id: string): ProfileDetail => ({
  id,
  manifest: {
    id,
    name: "New Profile",
    description: "",
    version: 1,
    managed: { agents: true, mcp: true, skills: true }
  },
  agentsMd: "# Agent Instructions\n",
  mcpToml: "",
  skillsPolicy: emptySkillsPolicy
});

export const App = () => {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [preview, setPreview] = useState<ActivationPreview>();
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refreshProfiles = async () => {
    const [profileItems, backupItems] = await Promise.all([
      window.agentEnv.listProfiles(),
      window.agentEnv.listBackups()
    ]);
    setProfiles(profileItems);
    setBackups(backupItems);
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
    const id = `profile-${Date.now()}`;
    const saved = await window.agentEnv.saveProfile(toSaveInput(createDraftProfile(id)));
    await refreshProfiles();
    setSelectedProfileId(saved.id);
    setDraftProfile(saved);
    setPreview(undefined);
  };

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
        profiles={profiles}
        selectedProfileId={selectedProfileId}
        isLoading={isLoading}
        onSelect={selectProfile}
        onCreate={createProfile}
      />

      <section className="editor-panel" aria-label="Profile editor">
        {error ? <p className="error">{error}</p> : null}
        {draftProfile ? (
          <>
            <header className="editor-header">
              <div>
                <p className="eyebrow">Global Codex Environment</p>
                <h2>{draftProfile.manifest.name}</h2>
              </div>
              <button type="button" disabled={busy} onClick={saveDraft}>
                Save
              </button>
            </header>
            <div className="editor-grid">
              <AgentsEditor
                value={draftProfile.agentsMd}
                onChange={(agentsMd) => {
                  setDraftProfile({ ...draftProfile, agentsMd });
                  setPreview(undefined);
                }}
              />
              <McpEditor
                value={draftProfile.mcpToml}
                onChange={(mcpToml) => {
                  setDraftProfile({ ...draftProfile, mcpToml });
                  setPreview(undefined);
                }}
              />
              <SkillsEditor
                value={draftProfile.skillsPolicy}
                onChange={(skillsPolicy) => {
                  setDraftProfile({ ...draftProfile, skillsPolicy });
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
