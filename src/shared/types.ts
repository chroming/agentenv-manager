export interface ProfileSummary {
  id: string;
  name: string;
  description: string;
}

export type { ProfileManifest, SkillsPolicy } from "./schemas";
import type { ProfileManifest, SkillsPolicy } from "./schemas";

export interface AgentEnvApi {
  listProfiles(): Promise<ProfileSummary[]>;
}

export interface ProfileDetail {
  id: string;
  manifest: ProfileManifest;
  agentsMd: string;
  mcpToml: string;
  skillsPolicy: SkillsPolicy;
}
