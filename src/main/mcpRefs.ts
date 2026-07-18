import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser";
import type { AssetPolicy } from "../shared/schemas";
import type { McpLibraryEntry, ProfileDetail } from "../shared/types";

const formattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n"
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const parseJsoncObject = (content: string, label: string) => {
  const errors: ParseError[] = [];
  const parsed = parse(content.trim().length > 0 ? content : "{}", errors, {
    allowTrailingComma: true
  });
  if (errors.length > 0) {
    throw new Error(
      `${label}: ${errors.map((error) => printParseErrorCode(error.error)).join(", ")}`
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label}: expected a JSON object`);
  }
  return parsed;
};

const setJsoncProperty = (content: string, path: string[], value: unknown) =>
  applyEdits(
    content.trim().length > 0 ? content : "{}\n",
    modify(content.trim().length > 0 ? content : "{}\n", path, value, {
      formattingOptions,
      getInsertionIndex: (properties) => properties.length
    })
  );

const quoteToml = (value: string) => JSON.stringify(value);

const quoteTomlKey = (value: string) =>
  /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);

export const jsonMcpEnvironment = (
  server: McpLibraryEntry,
  referenceFor: (sourceName: string) => string
) => {
  if (server.transport !== "stdio" || !server.env || Object.keys(server.env).length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(server.env).map(([key, sourceName]) => [
      key,
      referenceFor(sourceName)
    ])
  );
};

const serverForCodexToml = (name: string, server: McpLibraryEntry) => {
  const lines = [`[mcp_servers.${quoteTomlKey(name)}]`];
  if (server.transport === "stdio") {
    lines.push(`command = ${quoteToml(server.command ?? "")}`);
    if ((server.args ?? []).length > 0) {
      lines.push(`args = ${JSON.stringify(server.args)}`);
    }
  } else if (server.url) {
    lines.push(`url = ${quoteToml(server.url)}`);
  }
  if (server.transport === "stdio" && server.env && Object.keys(server.env).length > 0) {
    const envEntries = Object.entries(server.env).sort(([a], [b]) => a.localeCompare(b));
    const alias = envEntries.find(([key, sourceName]) => key !== sourceName);
    if (alias) {
      throw new Error(
        `Codex MCP environment reference ${alias[0]} must use the same source variable name`
      );
    }
    lines.push(`env_vars = ${JSON.stringify(envEntries.map(([name]) => name))}`);
  }
  return `${lines.join("\n")}\n`;
};

const resolveMcpRefs = (
  assetPolicy: AssetPolicy,
  mcpLibrary: McpLibraryEntry[]
): Array<{ targetName: string; server: McpLibraryEntry }> => {
  const byId = new Map(mcpLibrary.map((server) => [server.id, server]));
  return (assetPolicy.mcpRefs ?? []).map((ref) => {
    const server = byId.get(ref.libraryId);
    if (!server) {
      throw new Error(`MCP library server does not exist: ${ref.libraryId}`);
    }
    return { targetName: ref.targetName, server };
  });
};

export const materializeJsonMcpRefs = (
  profile: ProfileDetail,
  mcpLibrary: McpLibraryEntry[],
  format: {
    property: string;
    serializeServer(server: McpLibraryEntry): unknown;
  }
) => {
  const resolved = resolveMcpRefs(profile.assetPolicy, mcpLibrary);
  if (resolved.length === 0) {
    return profile;
  }

  const config = parseJsoncObject(profile.configText, "Invalid profile config");
  const property = format.property;
  const existing = isRecord(config[property]) ? config[property] : {};
  const merged = { ...existing };
  for (const { targetName, server } of resolved) {
    merged[targetName] = format.serializeServer(server);
  }

  return {
    ...profile,
    configText: setJsoncProperty(profile.configText, [property], merged)
  };
};

export const materializeTomlMcpRefs = (
  profile: ProfileDetail,
  mcpLibrary: McpLibraryEntry[]
) => {
  const resolved = resolveMcpRefs(profile.assetPolicy, mcpLibrary);
  if (resolved.length === 0) {
    return profile;
  }

  const libraryToml = resolved
    .map(({ targetName, server }) => serverForCodexToml(targetName, server))
    .join("\n");
  return {
    ...profile,
    configText: [profile.configText.trimEnd(), libraryToml.trimEnd()]
      .filter(Boolean)
      .join("\n\n") + "\n"
  };
};
