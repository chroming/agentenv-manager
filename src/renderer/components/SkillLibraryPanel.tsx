import { useState } from "react";
import type {
  AgentEnvSettings,
  GitHubSkillImportInput,
  SkillLibraryEntry,
  SkillUpdateInfo,
  UnmanagedSkillEntry
} from "../../shared/types";

interface SkillLibraryPanelProps {
  librarySkills: SkillLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  unmanagedSkills: UnmanagedSkillEntry[];
  skillSettings: AgentEnvSettings;
  skillUsage: Record<string, string[]>;
  onImportUnmanaged(sourcePath: string): void;
  onImportGitHubSkill(input: GitHubSkillImportInput): void;
  onUpdateLibrarySkill(id: string): void;
  onUpdateAllAvailable(): void;
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
  unmanagedSkills,
  skillSettings,
  skillUsage,
  onImportUnmanaged,
  onImportGitHubSkill,
  onUpdateLibrarySkill,
  onUpdateAllAvailable,
  onCheckUpdates,
  onSkillSettingsChange
}: SkillLibraryPanelProps) => {
  const [githubUrl, setGithubUrl] = useState("");
  const [githubId, setGithubId] = useState("");
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
          <button
            className="secondary-action"
            type="button"
            disabled={availableUpdateCount === 0}
            onClick={onUpdateAllAvailable}
          >
            Update all
          </button>
        </div>
      </div>

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
                </div>
                <div className="library-row__actions">
                  <strong className="resource-status">{updateLabel}</strong>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => onUpdateLibrarySkill(skill.id)}
                  >
                    Update {skill.id}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {unmanagedSkills.length > 0 ? (
        <section className="resource-section" aria-label="Found skills">
          <div>
            <div className="resource-heading">Found On Targets</div>
            <p className="muted">Move existing target skills into the shared library.</p>
          </div>
          <div className="resource-list resource-list--unmanaged">
            {unmanagedSkills.map((skill) => (
              <div
                aria-label={`Unmanaged skill ${skill.id}`}
                className="resource-row"
                key={skill.path}
                role="group"
              >
                <span className="resource-chip">Found</span>
                <div className="resource-row__main">
                  <span>{skill.name}</span>
                  <small>{skill.description || skill.id}</small>
                  <small title={skill.path}>{skill.foundIn.join(", ")} · {skill.path}</small>
                </div>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => onImportUnmanaged(skill.path)}
                >
                  Import {skill.id}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
};
