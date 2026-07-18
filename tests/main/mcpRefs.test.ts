import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import { createClaudeCodeTargetAdapter } from "../../src/main/targets/claudeCodeTarget";
import { createCodexTargetAdapter } from "../../src/main/targets/codexTarget";
import { createOpenCodeTargetAdapter } from "../../src/main/targets/opencodeTarget";
import type { McpLibraryEntry, ProfileDetail } from "../../src/shared/types";

const makeProfile = (targetId: string): ProfileDetail => ({
  id: "daily-coding",
  manifest: {
    id: "daily-coding",
    targetId,
    name: "Daily Coding",
    description: "Test profile",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  },
  instructions: "",
  configText: targetId === "codex" ? "" : "{}\n",
  assetPolicy: {
    ownedDirs: [],
    ownedFiles: [],
    skillRefs: [],
    mcpRefs: [{ libraryId: "local-search", targetName: "local_search" }],
    disabledSkillPaths: []
  }
});

const stdioServer: McpLibraryEntry = {
  id: "local-search",
  name: "Local Search",
  transport: "stdio",
  command: "node",
  args: ["server.js"],
  env: { SEARCH_TOKEN: "SEARCH_TOKEN" }
};

describe("MCP library reference materialization", () => {
  it("writes OpenCode environment substitutions without secret values", () => {
    const result = createOpenCodeTargetAdapter().materializeMcpRefs(
      makeProfile("opencode"),
      [stdioServer]
    );
    expect(parse(result.configText)).toMatchObject({
      mcp: {
        local_search: {
          type: "local",
          command: ["node", "server.js"],
          environment: { SEARCH_TOKEN: "{env:SEARCH_TOKEN}" }
        }
      }
    });
  });

  it("writes Claude Code environment substitutions without secret values", () => {
    const result = createClaudeCodeTargetAdapter().materializeMcpRefs(
      makeProfile("claude-code"),
      [stdioServer]
    );
    expect(parse(result.configText)).toMatchObject({
      mcpServers: {
        local_search: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
          env: { SEARCH_TOKEN: "${SEARCH_TOKEN}" }
        }
      }
    });
  });

  it("writes Codex parent environment forwarding without secret values", () => {
    const result = createCodexTargetAdapter().materializeMcpRefs(
      makeProfile("codex"),
      [stdioServer]
    );
    expect(result.configText).toContain("[mcp_servers.local_search]");
    expect(result.configText).toContain('env_vars = ["SEARCH_TOKEN"]');
    expect(result.configText).not.toContain("env = {");
  });

  it("does not serialize stdio environment references into remote MCP definitions", () => {
    const remoteServer: McpLibraryEntry = {
      ...stdioServer,
      transport: "http",
      command: undefined,
      args: [],
      url: "https://example.com/mcp"
    };
    const result = createOpenCodeTargetAdapter().materializeMcpRefs(
      makeProfile("opencode"),
      [remoteServer]
    );
    expect(parse(result.configText).mcp.local_search).toEqual({
      type: "remote",
      url: "https://example.com/mcp"
    });
  });
});
