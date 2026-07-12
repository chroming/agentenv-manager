import * as TOML from "@iarna/toml";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import type {
  ProfileDetail,
  SkillLibraryEntry,
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

export const listProfileApplications = (
  profileId: string,
  targetStates: readonly TargetManagementState[],
  targets: readonly TargetInfo[]
): RecentProfileApplication[] =>
  targetStates
    .filter((state) => state.activeProfileId === profileId)
    .map((state) => ({
      state,
      target: targets.find((target) => target.id === state.targetId)
    }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.state.lastAppliedAt ?? "");
      const rightTime = Date.parse(right.state.lastAppliedAt ?? "");
      if (Number.isFinite(leftTime) || Number.isFinite(rightTime)) {
        return (Number.isFinite(rightTime) ? rightTime : 0) -
          (Number.isFinite(leftTime) ? leftTime : 0);
      }
      return (left.target?.name ?? left.state.targetId).localeCompare(
        right.target?.name ?? right.state.targetId
      );
    });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const unique = (names: readonly string[]): string[] => [...new Set(names)];

type ProfileTargetSchema = Pick<TargetInfo, "id" | "configLanguage">;

const jsoncMcpNames = (
  configText: string,
  property: "mcp" | "mcpServers"
): string[] => {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(configText.trim() || "{}", errors, { allowTrailingComma: true });
  if (errors.length > 0 || !isRecord(parsed)) {
    return [];
  }

  return isRecord(parsed[property]) ? Object.keys(parsed[property]) : [];
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
  target: ProfileTargetSchema
): string[] => {
  if (target.id === "opencode" && target.configLanguage === "jsonc") {
    return jsoncMcpNames(configText, "mcp");
  }
  if (target.id === "claude-code" && target.configLanguage === "jsonc") {
    return jsoncMcpNames(configText, "mcpServers");
  }
  if (target.id === "codex" && target.configLanguage === "toml") {
    return tomlMcpNames(configText);
  }
  return [];
};

export const summarizeProfile = (
  profile: Pick<ProfileDetail, "manifest" | "instructions" | "configText" | "assetPolicy">,
  target: ProfileTargetSchema,
  librarySkills: readonly Pick<SkillLibraryEntry, "id" | "globallyEnabled">[] = []
): ProfileResourceSummary => {
  const globallyDisabledIds = new Set(
    librarySkills.filter((skill) => skill.globallyEnabled === false).map((skill) => skill.id)
  );
  const profileOwnedSkills = [...profile.assetPolicy.ownedDirs, ...profile.assetPolicy.ownedFiles]
    .filter((asset) => asset.kind === "skill")
    .map((asset) => asset.targetName);
  const skillNames = unique([
    ...profileOwnedSkills,
    ...profile.assetPolicy.skillRefs
      .filter(
        (skill) => skill.enabled !== false && !globallyDisabledIds.has(skill.libraryId)
      )
      .map((skill) => skill.targetName)
  ]);
  const mcpNames = unique([
    ...profile.assetPolicy.mcpRefs.map((server) => server.targetName),
    ...rawMcpNames(profile.configText, target)
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
  return listProfileApplications(profileId, targetStates, targets).find(
    (application) => Number.isFinite(Date.parse(application.state.lastAppliedAt ?? ""))
  );
};
