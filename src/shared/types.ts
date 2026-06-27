export interface ProfileSummary {
  id: string;
  name: string;
  description: string;
}

export interface AgentEnvApi {
  listProfiles(): Promise<ProfileSummary[]>;
}
