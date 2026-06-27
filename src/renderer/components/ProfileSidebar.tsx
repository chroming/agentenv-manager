import type { ProfileSummary, TargetDescriptor } from "../../shared/types";

interface ProfileSidebarProps {
  targets: TargetDescriptor[];
  profiles: ProfileSummary[];
  selectedProfileId?: string;
  selectedTargetId?: string;
  isLoading: boolean;
  onTargetSelect(targetId: string): void;
  onSelect(profileId: string): void;
  onCreate(): void;
}

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

  return (
    <aside className="sidebar" aria-label="Profiles">
      <div className="sidebar__header">
        <div>
          <h1>AgentEnv</h1>
          <p className="muted">Local agent environments</p>
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
