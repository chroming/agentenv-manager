import * as TOML from "@iarna/toml";
import { stripManagedSection } from "./managedSections";

export type TomlValidationResult =
  | { ok: true }
  | { ok: false; message: string };

const parseToml = (content: string): Record<string, unknown> =>
  TOML.parse(content) as Record<string, unknown>;

export const validateToml = (content: string): TomlValidationResult => {
  try {
    parseToml(content);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
};

export const extractMcpServerNames = (content: string): string[] => {
  const parsed = parseToml(content);
  const mcpServers = parsed.mcp_servers;

  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return [];
  }

  return Object.keys(mcpServers).sort((a, b) => a.localeCompare(b));
};

export const findUnmanagedMcpConflicts = (
  liveConfig: string,
  profileMcpToml: string,
  allowMatching = false
): string[] => {
  const unmanagedLiveConfig = stripManagedSection(liveConfig, "mcp");
  const liveParsed = parseToml(unmanagedLiveConfig);
  const profileParsed = parseToml(profileMcpToml);
  const liveServers =
    liveParsed.mcp_servers && typeof liveParsed.mcp_servers === "object"
      ? (liveParsed.mcp_servers as Record<string, unknown>)
      : {};
  const profileServers =
    profileParsed.mcp_servers && typeof profileParsed.mcp_servers === "object"
      ? (profileParsed.mcp_servers as Record<string, unknown>)
      : {};
  const liveNames = new Set(Object.keys(liveServers));
  const profileNames = Object.keys(profileServers).sort((a, b) => a.localeCompare(b));

  return profileNames.filter(
    (name) =>
      liveNames.has(name) &&
      !(allowMatching && JSON.stringify(liveServers[name]) === JSON.stringify(profileServers[name]))
  );
};
