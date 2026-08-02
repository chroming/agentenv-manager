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

const decodeMcpTableName = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const mcpTableHeader =
  /^\s*\[\s*mcp_servers\.("(?:\\.|[^"\\])*"|'[^']*'|[A-Za-z0-9_-]+)\s*\]\s*(?:#.*)?$/;

export const setMcpServerEnabled = (
  content: string,
  name: string,
  enabled: boolean
): { content: string; found: boolean; changed: boolean } => {
  const validation = validateToml(content);
  if (!validation.ok) {
    throw new Error(`Invalid live config.toml: ${validation.message}`);
  }
  const lines = content.split("\n");
  const tableIndex = lines.findIndex((line) => {
    const match = line.match(mcpTableHeader);
    return match ? decodeMcpTableName(match[1]) === name : false;
  });
  if (tableIndex < 0) {
    return { content, found: false, changed: false };
  }
  let endIndex = tableIndex + 1;
  while (endIndex < lines.length && !/^\s*\[/.test(lines[endIndex])) {
    endIndex += 1;
  }
  const enabledIndex = lines.findIndex(
    (line, index) =>
      index > tableIndex && index < endIndex && /^\s*enabled\s*=/.test(line)
  );
  const nextLine = `enabled = ${enabled ? "true" : "false"}`;
  if (enabledIndex >= 0) {
    if (lines[enabledIndex].trim() === nextLine) {
      return { content, found: true, changed: false };
    }
    lines[enabledIndex] = nextLine;
  } else {
    lines.splice(tableIndex + 1, 0, nextLine);
  }
  const nextContent = lines.join("\n");
  const nextValidation = validateToml(nextContent);
  if (!nextValidation.ok) {
    throw new Error(`Invalid planned config.toml: ${nextValidation.message}`);
  }
  return {
    content: nextContent,
    found: true,
    changed: nextContent !== content
  };
};
