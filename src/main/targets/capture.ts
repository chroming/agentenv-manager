import type { McpLibraryEntry } from "../../shared/types";

const sensitiveKey = /(api[_-]?key|token|secret|password|authorization|credential)/i;
const sensitiveValue = /^(Bearer\s+|sk-[A-Za-z0-9_-]{12,})/i;
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const omitted = Symbol("omitted");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const sanitizeCapturedJson = (
  value: Record<string, unknown>,
  prefix = "config"
): { value: Record<string, unknown>; excluded: string[] } => {
  const excluded: string[] = [];
  const sanitize = (input: unknown, path: string): unknown | typeof omitted => {
    if (Array.isArray(input)) {
      return input
        .map((item, index) => sanitize(item, `${path}[${index}]`))
        .filter((item) => item !== omitted);
    }
    if (isRecord(input)) {
      return Object.fromEntries(
        Object.entries(input).flatMap(([key, child]) => {
          const childPath = `${path}.${key}`;
          if (sensitiveKey.test(key)) {
            excluded.push(childPath);
            return [];
          }
          const sanitized = sanitize(child, childPath);
          return sanitized === omitted ? [] : [[key, sanitized]];
        })
      );
    }
    if (typeof input === "string" && sensitiveValue.test(input)) {
      excluded.push(path);
      return omitted;
    }
    return input;
  };

  return { value: sanitize(value, prefix) as Record<string, unknown>, excluded };
};

const slug = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "mcp-server";
};

const envReferences = (
  value: unknown,
  syntax: "opencode" | "claude"
): Record<string, string> | undefined => {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!envName.test(name) || typeof raw !== "string") return undefined;
    const match = syntax === "opencode" ? raw.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/) : raw.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
    if (!match || match[1] !== name) return undefined;
    result[name] = name;
  }
  return result;
};

export const captureJsonMcpServers = (
  value: unknown,
  syntax: "opencode" | "claude"
): { servers: McpLibraryEntry[]; excluded: string[] } => {
  if (!isRecord(value)) return { servers: [], excluded: [] };
  const servers: McpLibraryEntry[] = [];
  const excluded: string[] = [];

  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      excluded.push(name);
      continue;
    }
    const type = typeof raw.type === "string" ? raw.type : undefined;
    const url = typeof raw.url === "string" ? raw.url : undefined;
    if (url && (type === "remote" || type === "http" || type === "sse" || !type)) {
      const unsupportedKeys = Object.keys(raw).filter(
        (key) => !new Set(["type", "url", "enabled"]).has(key)
      );
      if (unsupportedKeys.length > 0 || raw.enabled === false) {
        excluded.push(name);
        continue;
      }
      servers.push({
        id: slug(name),
        name,
        transport: type === "sse" ? "sse" : "http",
        url,
        args: [],
        env: {}
      });
      continue;
    }

    const commandValue = raw.command;
    const unsupportedKeys = Object.keys(raw).filter(
      (key) => !new Set(["type", "command", "args", "environment", "env", "enabled"]).has(key)
    );
    const commandParts = Array.isArray(commandValue)
      ? commandValue.filter((item): item is string => typeof item === "string")
      : typeof commandValue === "string"
        ? [commandValue, ...(Array.isArray(raw.args) ? raw.args.filter((item): item is string => typeof item === "string") : [])]
        : [];
    const env = envReferences(raw.environment ?? raw.env, syntax);
    if (commandParts.length === 0 || env === undefined || unsupportedKeys.length > 0 || raw.enabled === false) {
      excluded.push(name);
      continue;
    }
    servers.push({
      id: slug(name),
      name,
      transport: "stdio",
      command: commandParts[0],
      args: commandParts.slice(1),
      env
    });
  }

  return { servers, excluded };
};

export const sameJsonValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
