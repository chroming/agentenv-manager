import * as TOML from "@iarna/toml";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import type {
  ProfileDetail,
  TargetInfo,
  TargetManagementState
} from "../shared/types";

export interface ProfileResourceSummary {
  instructions: { count: 0 | 1 };
  skills: { count: number; names: string[] };
  mcp: { count: number; names: string[] };
}

export interface RecentProfileApplication {
  state: TargetManagementState;
  target?: TargetInfo;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const unique = (names: readonly string[]): string[] => [...new Set(names)];

const jsoncMcpNames = (configText: string): string[] => {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(configText.trim() || "{}", errors, { allowTrailingComma: true });
  if (errors.length > 0 || !isRecord(parsed)) {
    return [];
  }

  const mcpNames = isRecord(parsed.mcp) ? Object.keys(parsed.mcp) : [];
  const mcpServerNames = isRecord(parsed.mcpServers) ? Object.keys(parsed.mcpServers) : [];
  return unique([...mcpNames, ...mcpServerNames]);
};

const tomlMcpNames = (configText: string): string[] => {
  try {
    const parsed = TOML.parse(configText) as Record<string, unknown>;
    return isRecord(parsed.mcp_servers) ? Object.keys(parsed.mcp_servers) : [];
  } catch {
    return [];
  }
};

const rawMcpNames = (
  configText: string,
  configLanguage: TargetInfo["configLanguage"]
): string[] => {
  if (configLanguage === "jsonc") {
    return jsoncMcpNames(configText);
  }
  if (configLanguage === "toml") {
    return tomlMcpNames(configText);
  }
  return [];
};

export const summarizeProfile = (
  profile: Pick<ProfileDetail, "manifest" | "instructions" | "configText" | "assetPolicy">,
  configLanguage: TargetInfo["configLanguage"]
): ProfileResourceSummary => {
  const profileOwnedSkills = [...profile.assetPolicy.ownedDirs, ...profile.assetPolicy.ownedFiles]
    .filter((asset) => asset.kind === "skill")
    .map((asset) => asset.targetName);
  const skillNames = unique([
    ...profileOwnedSkills,
    ...profile.assetPolicy.skillRefs.map((skill) => skill.targetName)
  ]);
  const mcpNames = unique([
    ...profile.assetPolicy.mcpRefs.map((server) => server.targetName),
    ...rawMcpNames(profile.configText, configLanguage)
  ]);

  return {
    instructions: {
      count:
        profile.manifest.managed.instructions && profile.instructions.trim().length > 0 ? 1 : 0
    },
    skills: { count: skillNames.length, names: skillNames },
    mcp: { count: mcpNames.length, names: mcpNames }
  };
};

export const findRecentProfileApplication = (
  profileId: string,
  targetStates: readonly TargetManagementState[],
  targets: readonly TargetInfo[]
): RecentProfileApplication | undefined => {
  const state = targetStates.reduce<TargetManagementState | undefined>((newest, candidate) => {
    if (candidate.activeProfileId !== profileId || !candidate.lastAppliedAt) {
      return newest;
    }

    const candidateTime = Date.parse(candidate.lastAppliedAt);
    if (!Number.isFinite(candidateTime)) {
      return newest;
    }

    if (!newest || candidateTime > Date.parse(newest.lastAppliedAt ?? "")) {
      return candidate;
    }
    return newest;
  }, undefined);

  if (!state) {
    return undefined;
  }

  return {
    state,
    target: targets.find((target) => target.id === state.targetId)
  };
};
