import { readFile } from "node:fs/promises";
import { z } from "zod";
import { SafeIdSchema } from "../shared/schemas";
import type { AgentEnvPaths } from "./paths";
import type { McpLibraryEntry, SaveMcpServerInput } from "../shared/types";
import { writeAtomic } from "./fileUtils";

const McpServerSchema = z
  .object({
    id: SafeIdSchema,
    name: z.string().min(1),
    transport: z.enum(["stdio", "http", "sse"]),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    url: z.string().optional(),
    env: z.record(z.string(), z.string()).default({})
  })
  .superRefine((value, context) => {
    if (value.transport === "stdio" && !value.command) {
      context.addIssue({
        code: "custom",
        message: "stdio MCP servers require a command",
        path: ["command"]
      });
    }
    if ((value.transport === "http" || value.transport === "sse") && !value.url) {
      context.addIssue({
        code: "custom",
        message: `${value.transport} MCP servers require a URL`,
        path: ["url"]
      });
    }
    if ((value.transport === "http" || value.transport === "sse") && value.url) {
      try {
        const url = new URL(value.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error("unsupported protocol");
        }
      } catch {
        context.addIssue({
          code: "custom",
          message: "remote MCP servers require an http or https URL",
          path: ["url"]
        });
      }
    }
  });

const McpLibraryFileSchema = z.array(McpServerSchema).default([]);
const EnvironmentNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export interface McpLibraryStore {
  listServers(): Promise<McpLibraryEntry[]>;
  saveServer(input: SaveMcpServerInput): Promise<McpLibraryEntry>;
  removeServer(id: string): Promise<void>;
}

const readServers = async (path: string): Promise<McpLibraryEntry[]> => {
  try {
    return McpLibraryFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const writeServers = async (path: string, servers: McpLibraryEntry[]) => {
  await writeAtomic(
    path,
    `${JSON.stringify(
      servers.sort((a, b) => a.name.localeCompare(b.name)),
      null,
      2
    )}\n`,
  );
};

export const createMcpLibraryStore = (paths: AgentEnvPaths): McpLibraryStore => {
  const listServers = async () => readServers(paths.mcpLibraryPath);

  const saveServer = async (input: SaveMcpServerInput): Promise<McpLibraryEntry> => {
    const existingId = input.existingId ? SafeIdSchema.parse(input.existingId) : undefined;
    const { existingId: _existingId, ...definition } = input;
    const server = McpServerSchema.parse(definition);
    const envEntries = Object.entries(server.env ?? {});
    if (server.transport !== "stdio" && envEntries.length > 0) {
      throw new Error("Remote MCP credentials must be configured in the Target");
    }
    for (const [name, sourceName] of envEntries) {
      EnvironmentNameSchema.parse(name);
      EnvironmentNameSchema.parse(sourceName);
      if (name !== sourceName) {
        throw new Error("MCP environment references must use the same variable name");
      }
    }
    const servers = await listServers();
    const existingServer = servers.find((item) => item.id === server.id);
    if (existingId && existingId !== server.id) {
      throw new Error("MCP server ID cannot be changed after creation");
    }
    if (existingId && !existingServer) {
      throw new Error(`MCP server no longer exists: ${existingId}`);
    }
    if (!existingId && existingServer) {
      throw new Error(`MCP server ID already exists: ${server.id}`);
    }
    const nextServers = servers
      .filter((item) => item.id !== server.id)
      .concat(server);
    await writeServers(paths.mcpLibraryPath, nextServers);
    return server;
  };

  const removeServer = async (id: string) => {
    const safeId = SafeIdSchema.parse(id);
    const servers = await listServers();
    await writeServers(
      paths.mcpLibraryPath,
      servers.filter((server) => server.id !== safeId)
    );
  };

  return { listServers, saveServer, removeServer };
};
