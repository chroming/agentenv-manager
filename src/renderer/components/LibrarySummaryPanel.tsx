import type { AgentEnvSettings, SkillLibraryEntry, SkillUpdateInfo } from "../../shared/types";

interface LibrarySummaryPanelProps {
  librarySkills: SkillLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  skillSettings: AgentEnvSettings;
}

export const LibrarySummaryPanel = ({
  librarySkills,
  skillUpdates,
  skillSettings
}: LibrarySummaryPanelProps) => {
  const updateCount = skillUpdates.filter((update) => update.updateAvailable).length;
  const githubCount = librarySkills.filter((skill) => skill.sourceType === "github").length;
  const localCount = librarySkills.filter((skill) => skill.sourceType === "local").length;
  const failedChecks = skillUpdates.filter((update) => update.error).length;

  return (
    <aside className="activation-panel library-summary-panel" aria-label="Library summary">
      <div className="activation-header">
        <p className="section-title">Library</p>
        <h2>Skills</h2>
      </div>
      <div className={`status-card${failedChecks > 0 ? " is-blocked" : ""}`}>
        <span className={`status-dot${updateCount === 0 && failedChecks === 0 ? " is-ready" : ""}`} />
        <div>
          <strong>
            {failedChecks > 0
              ? `${failedChecks} check failed`
              : updateCount > 0
                ? `${updateCount} update available`
                : "Library current"}
          </strong>
          <small>
            {librarySkills.length} skill{librarySkills.length === 1 ? "" : "s"} in the shared library
          </small>
        </div>
      </div>
      <section className="safety-checks" aria-label="Library inventory">
        <div className="section-title">Inventory</div>
        <div className="check-row">
          <span>Total skills</span>
          <strong>{librarySkills.length}</strong>
        </div>
        <div className="check-row">
          <span>GitHub tracked</span>
          <strong>{githubCount}</strong>
        </div>
        <div className="check-row">
          <span>Local only</span>
          <strong>{localCount}</strong>
        </div>
      </section>
      <section className="safety-checks" aria-label="Library settings summary">
        <div className="section-title">Settings</div>
        <div className="check-row">
          <span>Sync</span>
          <strong>{skillSettings.skillSyncMethod}</strong>
        </div>
        <div className="check-row">
          <span>Storage</span>
          <strong>{skillSettings.skillStorageLocation}</strong>
        </div>
      </section>
    </aside>
  );
};
