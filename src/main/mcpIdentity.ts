import type { McpLibraryEntry } from "../shared/types";

export const semanticMcpDefinition = (server: McpLibraryEntry): string =>
  JSON.stringify({
    transport: server.transport,
    command: server.command,
    args: server.args ?? [],
    url: server.url,
    env: Object.fromEntries(
      Object.entries(server.env ?? {}).sort(([a], [b]) => a.localeCompare(b))
    )
  });
