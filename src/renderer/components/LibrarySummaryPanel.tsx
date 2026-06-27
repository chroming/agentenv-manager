import type {
  AgentEnvSettings,
  McpLibraryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo
} from "../../shared/types";

interface LibrarySummaryPanelProps {
  activeTab: "skills" | "mcp";
  librarySkills: SkillLibraryEntry[];
  mcpServers: McpLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  skillSettings: AgentEnvSettings;
  mcpUsage: Record<string, string[]>;
}

export const LibrarySummaryPanel = ({
  activeTab,
  librarySkills,
  mcpServers,
  skillUpdates,
  skillSettings,
  mcpUsage
}: LibrarySummaryPanelProps) => {
  const updateCount = skillUpdates.filter((update) => update.updateAvailable).length;
  const githubCount = librarySkills.filter((skill) => skill.sourceType === "github").length;
  const localCount = librarySkills.filter((skill) => skill.sourceType === "local").length;
  const failedChecks = skillUpdates.filter((update) => update.error).length;
  const stdioCount = mcpServers.filter((server) => server.transport === "stdio").length;
  const remoteCount = mcpServers.filter((server) => server.transport !== "stdio").length;
  const usedMcpCount = mcpServers.filter((server) => (mcpUsage[server.id] ?? []).length > 0).length;

  if (activeTab === "mcp") {
    return (
      <aside className="activation-panel library-summary-panel" aria-label="Library summary">
        <div className="activation-header">
          <p className="section-title">Library</p>
          <h2>MCP Servers</h2>
        </div>
        <div className="status-card">
          <span className="status-dot is-ready" />
          <div>
            <strong>
              {mcpServers.length} shared MCP server{mcpServers.length === 1 ? "" : "s"}
            </strong>
            <small>Secrets stay in environment variables, not the library.</small>
          </div>
        </div>
        <section className="safety-checks" aria-label="MCP inventory">
          <div className="section-title">Inventory</div>
          <div className="check-row">
            <span>Total servers</span>
            <strong>{mcpServers.length}</strong>
          </div>
          <div className="check-row">
            <span>Local command</span>
            <strong>{stdioCount}</strong>
          </div>
          <div className="check-row">
            <span>Remote URL</span>
            <strong>{remoteCount}</strong>
          </div>
          <div className="check-row">
            <span>Used by profiles</span>
            <strong>{usedMcpCount}</strong>
          </div>
        </section>
        <section className="safety-checks" aria-label="MCP safety summary">
          <div className="section-title">Safety</div>
          <div className="check-row">
            <span>Secret values</span>
            <strong>Env only</strong>
          </div>
          <div className="check-row">
            <span>Apply path</span>
            <strong>Previewed</strong>
          </div>
        </section>
      </aside>
    );
  }

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
