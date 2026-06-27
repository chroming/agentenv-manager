import type {
  AgentEnvSettings,
  McpLibraryEntry,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo
} from "../../shared/types";

interface LibrarySummaryPanelProps {
  activeTab: "skills" | "mcp";
  librarySkills: SkillLibraryEntry[];
  mcpServers: McpLibraryEntry[];
  skillUpdates: SkillUpdateInfo[];
  skillSettings: AgentEnvSettings;
  skillUsage: Record<string, string[]>;
  skillInventory: SkillInventoryEntry[];
  mcpUsage: Record<string, string[]>;
}

export const LibrarySummaryPanel = ({
  activeTab,
  librarySkills,
  mcpServers,
  skillUpdates,
  skillSettings,
  skillUsage,
  skillInventory,
  mcpUsage
}: LibrarySummaryPanelProps) => {
  const updateCount = skillUpdates.filter((update) => update.updateAvailable).length;
  const githubCount = librarySkills.filter((skill) => skill.sourceType === "github").length;
  const localCount = librarySkills.filter((skill) => skill.sourceType === "local").length;
  const failedChecks = skillUpdates.filter((update) => update.error).length;
  const stdioCount = mcpServers.filter((server) => server.transport === "stdio").length;
  const remoteCount = mcpServers.filter((server) => server.transport !== "stdio").length;
  const usedMcpCount = mcpServers.filter((server) => (mcpUsage[server.id] ?? []).length > 0).length;
  const selectedSkill = librarySkills[0];
  const selectedUpdate = selectedSkill ? skillUpdates.find((update) => update.id === selectedSkill.id) : undefined;
  const selectedInstalls = selectedSkill
    ? skillInventory.filter((skill) => skill.libraryId === selectedSkill.id || skill.id === selectedSkill.id)
    : [];

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
        <p className="section-title">Resource inspector</p>
        <h2>{selectedSkill?.name ?? "Skills"}</h2>
      </div>
      {selectedSkill ? (
        <>
          <section className="inspector-section" aria-label="Resource overview">
            <div className="section-title">Overview</div>
            <p>{selectedSkill.description || selectedSkill.id}</p>
            <a href={selectedSkill.source} title={selectedSkill.source}>
              {selectedSkill.source ?? selectedSkill.path}
            </a>
          </section>
          <section className="safety-checks" aria-label="Source monitor">
            <div className="section-title">Source monitor</div>
            <div className="check-row">
              <span>Source</span>
              <strong>{selectedSkill.sourceType}</strong>
            </div>
            <div className="check-row">
              <span>Auto update</span>
              <strong>{selectedSkill.source ? "Enabled" : "Manual"}</strong>
            </div>
            <div className="check-row">
              <span>Last updated</span>
              <strong>{new Date(selectedSkill.updatedAt).toLocaleDateString()}</strong>
            </div>
          </section>
          <section className="safety-checks" aria-label="Profiles using selected resource">
            <div className="section-title">Used by profiles</div>
            {(skillUsage[selectedSkill.id] ?? []).length === 0 ? (
              <p className="muted">Not used by any profile</p>
            ) : null}
            {(skillUsage[selectedSkill.id] ?? []).map((profile) => (
              <div className="check-row" key={profile}>
                <span>{profile}</span>
                <strong>Profile</strong>
              </div>
            ))}
          </section>
          <section className="safety-checks" aria-label="Targets with selected resource">
            <div className="section-title">Installed on targets</div>
            {selectedInstalls.length === 0 ? <p className="muted">Not installed on targets</p> : null}
            {selectedInstalls.map((install) => (
              <div className="check-row" key={install.path}>
                <span>{install.foundIn.join(", ")}</span>
                <strong>{install.status}</strong>
              </div>
            ))}
          </section>
          <section className={`status-card${selectedUpdate?.error ? " is-blocked" : ""}`} aria-label="Update preview summary">
            <span className={`status-dot${selectedUpdate?.updateAvailable ? "" : " is-ready"}`} />
            <div>
              <strong>
                {selectedUpdate?.error
                  ? "Check failed"
                  : selectedUpdate?.updateAvailable
                    ? "Update available"
                    : "No update pending"}
              </strong>
              <small>{selectedUpdate?.latestRevision ?? "Current library version"}</small>
            </div>
          </section>
        </>
      ) : (
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
      )}
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
