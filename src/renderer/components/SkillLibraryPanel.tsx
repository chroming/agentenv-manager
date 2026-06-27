import { useState } from "react";
import type {
  AgentEnvSettings,
  GitHubSkillImportInput,
  ManageTargetSkillInput,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillSourceType,
  SkillUpdateInfo,
  SkillUpdatePlan,
  SkillUpdateSourceInput
} from "../../shared/types";

interface SkillLibraryPanelProps {
  librarySkills: SkillLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  skillInventory: SkillInventoryEntry[];
  selectedUpdatePlan?: SkillUpdatePlan;
  skillSettings: AgentEnvSettings;
  skillUsage: Record<string, string[]>;
  onImportUnmanaged(sourcePath: string): void;
  onImportGitHubSkill(input: GitHubSkillImportInput): void;
  onManageTargetSkill(input: ManageTargetSkillInput): void;
  onSetUpdateSource(input: SkillUpdateSourceInput): void;
  onPreviewLibrarySkillUpdate(id: string): void;
  onUpdateLibrarySkill(id: string): void;
  onCheckUpdates(): void;
  onSkillSettingsChange(input: Partial<AgentEnvSettings>): void;
}

const sourceLabel = (skill: SkillLibraryEntry) => {
  if (skill.sourceType === "github") {
    return skill.source ?? "GitHub source";
  }
  if (skill.sourceType === "local") {
    return skill.source ?? skill.path;
  }
  return skill.source ?? skill.sourceType;
};

export const SkillLibraryPanel = ({
  librarySkills,
  skillUpdates,
  skillInventory,
  selectedUpdatePlan,
  skillSettings,
  skillUsage,
  onImportUnmanaged,
  onImportGitHubSkill,
  onManageTargetSkill,
  onSetUpdateSource,
  onPreviewLibrarySkillUpdate,
  onUpdateLibrarySkill,
  onCheckUpdates,
  onSkillSettingsChange
}: SkillLibraryPanelProps) => {
  const [githubUrl, setGithubUrl] = useState("");
  const [githubId, setGithubId] = useState("");
  const [sourceDrafts, setSourceDrafts] = useState<
    Record<string, { sourceType: SkillSourceType; source: string }>
  >({});
  const updatesById = new Map(skillUpdates.map((update) => [update.id, update]));
  const availableUpdateCount = skillUpdates.filter((update) => update.updateAvailable).length;

  const importGitHubSkill = () => {
    const url = githubUrl.trim();
    if (!url) {
      return;
    }
    onImportGitHubSkill({
      url,
      id: githubId.trim() || undefined
    });
    setGithubUrl("");
    setGithubId("");
  };

  return (
    <section className="skill-library-panel" aria-label="Skill library">
      <div className="asset-editor-header">
        <div>
          <div className="section-title">Skill Library</div>
          <p className="muted">Reusable skills live once here, then profiles reference them.</p>
        </div>
        <div className="asset-editor-actions">
          <button className="secondary-action" type="button" onClick={onCheckUpdates}>
            Check updates
          </button>
        </div>
      </div>

      <section className="resource-section" aria-label="Library skills">
        <div className="library-section-title-row">
          <div>
            <div className="resource-heading">Skills</div>
            <p className="muted">
              {librarySkills.length === 0
                ? "No shared skills yet."
                : `${librarySkills.length} shared skill${librarySkills.length === 1 ? "" : "s"}`}
            </p>
          </div>
          {availableUpdateCount > 0 ? (
            <strong className="resource-status">{availableUpdateCount} update available</strong>
          ) : null}
        </div>
        <div className="resource-list library-list">
          {librarySkills.length === 0 ? (
            <p className="muted">Import a skill from a folder or GitHub to start the library.</p>
          ) : null}
          {librarySkills.map((skill) => {
            const updateInfo = updatesById.get(skill.id);
            const sourceDraft = sourceDrafts[skill.id] ?? {
              sourceType: skill.sourceType,
              source: sourceLabel(skill)
            };
            const updateLabel = updateInfo?.error
              ? "Check failed"
              : updateInfo?.updateAvailable
                ? "Update available"
                : skill.sourceType === "github" && updateInfo
                  ? "Up to date"
                  : skill.sourceType === "local"
                    ? "Local only"
                    : skill.sourceType;
            return (
              <div
                aria-label={`Library item ${skill.id}`}
                className="resource-row library-row"
                key={skill.id}
                role="group"
              >
                <span className={`resource-chip resource-chip--${skill.sourceType}`}>
                  {skill.sourceType}
                </span>
                <div className="resource-row__main">
                  <span>{skill.name}</span>
                  <small>{skill.description || skill.id}</small>
                  <small title={sourceLabel(skill)}>{sourceLabel(skill)}</small>
                  <small>
                    {(skillUsage[skill.id] ?? []).length > 0
                      ? `Used by ${(skillUsage[skill.id] ?? []).join(", ")}`
                      : "Not used by any profile"}
                  </small>
                  <div className="library-source-editor">
                    <select
                      aria-label={`Update source type for ${skill.id}`}
                      value={sourceDraft.sourceType}
                      onChange={(event) =>
                        setSourceDrafts({
                          ...sourceDrafts,
                          [skill.id]: {
                            ...sourceDraft,
                            sourceType: event.currentTarget.value as SkillSourceType
                          }
                        })
                      }
                    >
                      <option value="local">Local folder</option>
                      <option value="github">GitHub directory</option>
                    </select>
                    <input
                      aria-label={`Update source for ${skill.id}`}
                      placeholder={
                        sourceDraft.sourceType === "github"
                          ? "https://github.com/owner/repo/tree/main/path/to/skill"
                          : "/path/to/skill"
                      }
                      value={sourceDraft.source}
                      onChange={(event) =>
                        setSourceDrafts({
                          ...sourceDrafts,
                          [skill.id]: { ...sourceDraft, source: event.currentTarget.value }
                        })
                      }
                    />
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={!sourceDraft.source.trim()}
                      onClick={() =>
                        onSetUpdateSource({
                          id: skill.id,
                          sourceType: sourceDraft.sourceType,
                          source: sourceDraft.source.trim()
                        })
                      }
                    >
                      Save source for {skill.id}
                    </button>
                  </div>
                </div>
                <div className="library-row__actions">
                  <strong className="resource-status">{updateLabel}</strong>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => onPreviewLibrarySkillUpdate(skill.id)}
                  >
                    Preview update {skill.id}
                  </button>
                </div>
                {selectedUpdatePlan?.id === skill.id ? (
                  <section
                    className="library-update-preview"
                    aria-label={`Update preview for ${skill.id}`}
                  >
                    <div>
                      <strong>
                        {selectedUpdatePlan.errors.length > 0
                          ? "Update source needs attention"
                          : selectedUpdatePlan.updateAvailable
                            ? `${selectedUpdatePlan.changes.length} file change${
                                selectedUpdatePlan.changes.length === 1 ? "" : "s"
                              }`
                            : "No file changes"}
                      </strong>
                      <small>
                        {selectedUpdatePlan.latestRevision
                          ? `${selectedUpdatePlan.currentRevision ?? "current"} -> ${
                              selectedUpdatePlan.latestRevision
                            }`
                          : selectedUpdatePlan.source ?? "No source"}
                      </small>
                    </div>
                    {selectedUpdatePlan.errors.map((item) => (
                      <p className="error" key={item}>
                        {item}
                      </p>
                    ))}
                    {selectedUpdatePlan.changes.length > 0 ? (
                      <div className="update-change-list">
                        {selectedUpdatePlan.changes.map((change) => (
                          <details key={change.path}>
                            <summary>{change.path}</summary>
                            <pre>{change.diff}</pre>
                          </details>
                        ))}
                      </div>
                    ) : null}
                    <button
                      className="primary-action"
                      type="button"
                      disabled={
                        selectedUpdatePlan.errors.length > 0 ||
                        selectedUpdatePlan.changes.length === 0
                      }
                      onClick={() => onUpdateLibrarySkill(skill.id)}
                    >
                      Apply update {skill.id}
                    </button>
                  </section>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {skillInventory.length > 0 ? (
        <section className="resource-section" aria-label="Environment skills">
          <div>
            <div className="resource-heading">Environment skills</div>
            <p className="muted">Inspect target skills and move unmanaged folders into the shared library.</p>
          </div>
          <div className="resource-list resource-list--unmanaged">
            {skillInventory.map((skill) => (
              <div
                aria-label={`Environment skill ${skill.id}`}
                className="resource-row"
                key={skill.path}
                role="group"
              >
                <span className={`resource-chip resource-chip--${skill.status}`}>
                  {skill.status === "managed"
                    ? "Managed"
                    : skill.status === "library"
                      ? "Imported"
                      : "Unmanaged"}
                </span>
                <div className="resource-row__main">
                  <span>{skill.name}</span>
                  <small>{skill.description || skill.id}</small>
                  <small title={skill.path}>
                    {skill.foundIn.join(", ")}
                    {skill.libraryId ? ` · ${skill.libraryId}` : ""} · {skill.path}
                  </small>
                </div>
                {skill.status === "library" && skill.libraryId ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() =>
                      onManageTargetSkill({
                        targetId: skill.foundIn[0] ?? "",
                        targetName: skill.id,
                        libraryId: skill.libraryId ?? skill.id
                      })
                    }
                  >
                    Manage {skill.id}
                  </button>
                ) : null}
                {skill.status === "unmanaged" ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => onImportUnmanaged(skill.path)}
                  >
                    Import {skill.id}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="resource-section library-import-panel" aria-label="GitHub skill import">
        <div>
          <div className="resource-heading">Import from GitHub directory</div>
          <p className="muted">
            Paste a public GitHub skill folder URL. AgentEnv tracks the directory revision for
            future updates.
          </p>
        </div>
        <div className="library-import-grid">
          <label>
            <span>GitHub URL</span>
            <input
              aria-label="GitHub skill URL"
              placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Library ID</span>
            <input
              aria-label="GitHub skill library id"
              placeholder="Optional"
              value={githubId}
              onChange={(event) => setGithubId(event.currentTarget.value)}
            />
          </label>
          <button
            className="primary-action library-import-action"
            type="button"
            disabled={!githubUrl.trim()}
            onClick={importGitHubSkill}
          >
            Import from GitHub
          </button>
        </div>
      </section>

      <section className="resource-section" aria-label="Library storage settings">
        <div>
          <div className="resource-heading">Storage</div>
          <p className="muted">Choose how library skills are placed into each agent target.</p>
        </div>
        <div className="resource-settings-grid">
          <label>
            <span>Sync</span>
            <select
              aria-label="Skill sync method"
              value={skillSettings.skillSyncMethod}
              onChange={(event) =>
                onSkillSettingsChange({
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
              aria-label="Skill storage location"
              value={skillSettings.skillStorageLocation}
              onChange={(event) =>
                onSkillSettingsChange({
                  skillStorageLocation: event.currentTarget
                    .value as AgentEnvSettings["skillStorageLocation"]
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
  );
};
