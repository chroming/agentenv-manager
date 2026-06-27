import { useEffect, useState } from "react";
import type { ProfileSummary } from "../shared/types";

export const App = () => {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    window.agentEnv
      .listProfiles()
      .then((items) => {
        if (isMounted) {
          setProfiles(items);
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

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Profiles">
        <div className="sidebar__header">
          <h1>AgentEnv</h1>
          <button type="button" disabled>
            New
          </button>
        </div>
        <div className="profile-list">
          {isLoading ? <p className="muted">Loading profiles...</p> : null}
          {!isLoading && profiles.length === 0 ? (
            <p className="muted">No profiles yet.</p>
          ) : null}
          {profiles.map((profile) => (
            <button className="profile-row" type="button" key={profile.id}>
              <span>{profile.name}</span>
              <small>{profile.description}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="editor-panel" aria-label="Profile editor">
        <header>
          <p className="eyebrow">Global Codex Environment</p>
          <h2>Select a profile to edit</h2>
        </header>
        <div className="empty-state">
          <p>Profiles will manage global AGENTS.md, MCP servers, and skill policy.</p>
        </div>
      </section>

      <aside className="activation-panel" aria-label="Activation">
        <h2>Activation</h2>
        <div className="status-card">
          <span className="status-dot" />
          <div>
            <strong>Preview required</strong>
            <p>Changes will be shown before any live Codex file is touched.</p>
          </div>
        </div>
        <button type="button" disabled>
          Preview
        </button>
        <button type="button" disabled>
          Apply
        </button>
      </aside>
    </main>
  );
};
