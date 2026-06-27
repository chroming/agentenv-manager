import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { SafeIdSchema } from "../shared/schemas";
import type { AgentEnvPaths } from "./paths";
import type { McpLibraryEntry, SaveMcpServerInput } from "../shared/types";

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
  });

const McpLibraryFileSchema = z.array(McpServerSchema).default([]);

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
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    `${JSON.stringify(
      servers.sort((a, b) => a.name.localeCompare(b.name)),
      null,
      2
    )}\n`,
    "utf8"
  );
};

export const createMcpLibraryStore = (paths: AgentEnvPaths): McpLibraryStore => {
  const listServers = async () => readServers(paths.mcpLibraryPath);

  const saveServer = async (input: SaveMcpServerInput): Promise<McpLibraryEntry> => {
    const server = McpServerSchema.parse(input);
    const servers = await listServers();
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
