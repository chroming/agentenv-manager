import type { ProfileSummary, TargetHealthStatus, TargetInfo } from "../../shared/types";

interface ProfileSidebarProps {
  targets: TargetInfo[];
  profiles: ProfileSummary[];
  selectedProfileId?: string;
  selectedTargetId?: string;
  isLoading: boolean;
  onTargetSelect(targetId: string): void;
  onSelect(profileId: string): void;
  onCreate(): void;
}

const targetStatusLabel: Record<TargetHealthStatus, string> = {
  ready: "Ready",
  "needs-setup": "Needs setup",
  missing: "Missing",
  guarded: "Guarded"
};

export const ProfileSidebar = ({
  targets,
  profiles,
  selectedProfileId,
  selectedTargetId,
  isLoading,
  onTargetSelect,
  onSelect,
  onCreate
}: ProfileSidebarProps) => {
  const selectedTarget = targets.find((target) => target.id === selectedTargetId);
  const selectedTargetStatus = selectedTarget
    ? targetStatusLabel[selectedTarget.health.status]
    : undefined;

  return (
    <aside className="sidebar" aria-label="Profiles">
      <div className="sidebar__header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">A</div>
          <div>
            <h1>AgentEnv</h1>
            <p className="muted">Local agent environments</p>
          </div>
        </div>
        <button className="create-button" type="button" onClick={onCreate}>
          New
        </button>
      </div>
      <label className="target-picker">
        <span>Target</span>
        <select
          value={selectedTargetId ?? ""}
          onChange={(event) => onTargetSelect(event.currentTarget.value)}
        >
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
        </select>
        {selectedTarget ? <small>{selectedTarget.description}</small> : null}
      </label>
      {selectedTarget ? (
        <section className="target-status" aria-label="Target status">
          <div className="target-status__summary">
            <strong className={`target-badge target-badge--${selectedTarget.health.status}`}>
              {selectedTargetStatus}
            </strong>
            {selectedTarget.health.summary !== selectedTargetStatus ? (
              <small>{selectedTarget.health.summary}</small>
            ) : null}
          </div>
          <details className="target-details">
            <summary>Target details</summary>
            <div className="target-checks">
              {selectedTarget.health.checks.map((check) => (
                <div className="target-check" key={check.id}>
                  <div>
                    <span>{check.label}</span>
                    <code title={check.path}>{check.path}</code>
                  </div>
                  <strong>
                    {check.exists ? (check.writable ? "Writable" : "Read-only") : "Missing"}
                  </strong>
                </div>
              ))}
            </div>
          </details>
        </section>
      ) : null}
      <div className="section-title">Profiles</div>
      <div className="profile-list">
        {isLoading ? <p className="muted">Loading profiles...</p> : null}
        {!isLoading && profiles.length === 0 ? <p className="muted">No profiles</p> : null}
        {profiles.map((profile) => (
          <button
            className={`profile-row${profile.id === selectedProfileId ? " is-active" : ""}`}
            type="button"
            key={profile.id}
            onClick={() => onSelect(profile.id)}
          >
            <span>{profile.name}</span>
            <small>{profile.description}</small>
          </button>
        ))}
      </div>
    </aside>
  );
};
