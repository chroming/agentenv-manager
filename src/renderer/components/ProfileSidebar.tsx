import type { ProfileSummary } from "../../shared/types";

interface ProfileSidebarProps {
  profiles: ProfileSummary[];
  selectedProfileId?: string;
  isLoading: boolean;
  onSelect(profileId: string): void;
  onCreate(): void;
}

export const ProfileSidebar = ({
  profiles,
  selectedProfileId,
  isLoading,
  onSelect,
  onCreate
}: ProfileSidebarProps) => (
  <aside className="sidebar" aria-label="Profiles">
    <div className="sidebar__header">
      <h1>AgentEnv</h1>
      <button type="button" onClick={onCreate}>
        New
      </button>
    </div>
    <div className="profile-list">
      {isLoading ? <p className="muted">Loading profiles...</p> : null}
      {!isLoading && profiles.length === 0 ? (
        <p className="muted">No profiles</p>
      ) : null}
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
