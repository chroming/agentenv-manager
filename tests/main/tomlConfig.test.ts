import { describe, expect, it } from "vitest";
import {
  extractMcpServerNames,
  findUnmanagedMcpConflicts,
  validateToml
} from "../../src/main/tomlConfig";

describe("toml config utilities", () => {
  it("accepts valid TOML", () => {
    expect(validateToml('[mcp_servers.context7]\ncommand = "npx"\n')).toEqual({
      ok: true
    });
  });

  it("returns an error for invalid TOML", () => {
    const result = validateToml("[mcp_servers.context7\n");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("extracts MCP server names", () => {
    expect(
      extractMcpServerNames(
        '[mcp_servers.context7]\ncommand = "npx"\n[mcp_servers.figma]\nurl = "https://example.com"\n'
      )
    ).toEqual(["context7", "figma"]);
  });

  it("detects unmanaged MCP conflicts", () => {
    const liveConfig = '[mcp_servers.context7]\ncommand = "npx"\n';
    const profileMcp = '[mcp_servers.context7]\ncommand = "node"\n';

    expect(findUnmanagedMcpConflicts(liveConfig, profileMcp)).toEqual([
      "context7"
    ]);
  });

  it("ignores MCP servers already inside the managed section", () => {
    const liveConfig = [
      "# BEGIN AgentEnv Manager: mcp",
      "[mcp_servers.context7]",
      'command = "npx"',
      "# END AgentEnv Manager: mcp"
    ].join("\n");
    const profileMcp = '[mcp_servers.context7]\ncommand = "node"\n';

    expect(findUnmanagedMcpConflicts(liveConfig, profileMcp)).toEqual([]);
  });
});
