import { describe, expect, it } from "vitest";
import {
  extractMcpServerNames,
  findUnmanagedMcpConflicts,
  setMcpServerEnabled,
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

  it("toggles only the enabled field of an existing MCP definition", () => {
    const original = [
      'model = "gpt-5"',
      "",
      "[mcp_servers.context7]",
      'url = "https://example.com/mcp"',
      'bearer_token_env_var = "MCP_TOKEN"',
      "enabled = false",
      ""
    ].join("\n");

    const result = setMcpServerEnabled(original, "context7", true);

    expect(result).toMatchObject({ found: true, changed: true });
    expect(result.content).toContain('url = "https://example.com/mcp"');
    expect(result.content).toContain('bearer_token_env_var = "MCP_TOKEN"');
    expect(result.content).toContain("enabled = true");
    expect(result.content).not.toContain("enabled = false");
  });

  it("adds enabled to a quoted MCP table without rewriting its definition", () => {
    const original = [
      '[mcp_servers."node_repl"]',
      'command = "node"',
      'args = ["server.js"]',
      ""
    ].join("\n");

    const result = setMcpServerEnabled(original, "node_repl", false);

    expect(result).toMatchObject({ found: true, changed: true });
    expect(result.content).toContain('[mcp_servers."node_repl"]');
    expect(result.content).toContain('args = ["server.js"]');
    expect(result.content).toContain("enabled = false");
  });

  it("handles escaped characters in quoted MCP table names", () => {
    const original = [
      '[mcp_servers."escaped\\\\name"]',
      'command = "node"',
      ""
    ].join("\n");

    const result = setMcpServerEnabled(original, "escaped\\name", true);

    expect(result).toMatchObject({ found: true, changed: true });
    expect(result.content).toContain('[mcp_servers."escaped\\\\name"]');
    expect(result.content).toContain("enabled = true");
  });

  it("does not change config when the MCP definition is missing or already matches", () => {
    const original = "[mcp_servers.context7]\nenabled = true\n";

    expect(setMcpServerEnabled(original, "missing", false)).toEqual({
      content: original,
      found: false,
      changed: false
    });
    expect(setMcpServerEnabled(original, "context7", true)).toEqual({
      content: original,
      found: true,
      changed: false
    });
  });
});
