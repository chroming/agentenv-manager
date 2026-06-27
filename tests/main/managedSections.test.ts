import { describe, expect, it } from "vitest";
import {
  replaceManagedSection,
  stripManagedSection
} from "../../src/main/managedSections";

describe("managed sections", () => {
  it("inserts a missing section at the end", () => {
    expect(
      replaceManagedSection(
        'model = "gpt"\n',
        "mcp",
        '[mcp_servers.x]\ncommand = "npx"\n'
      )
    ).toContain("# BEGIN AgentEnv Manager: mcp");
  });

  it("replaces only the requested section", () => {
    const input = [
      'model = "gpt"',
      "# BEGIN AgentEnv Manager: mcp",
      "[mcp_servers.old]",
      'command = "old"',
      "# END AgentEnv Manager: mcp",
      "# keep me"
    ].join("\n");

    const output = replaceManagedSection(
      input,
      "mcp",
      '[mcp_servers.new]\ncommand = "new"\n'
    );

    expect(output).toContain("[mcp_servers.new]");
    expect(output).not.toContain("[mcp_servers.old]");
    expect(output).toContain("# keep me");
  });

  it("strips a managed section for unmanaged conflict checks", () => {
    const input = [
      "[mcp_servers.unmanaged]",
      'command = "npx"',
      "# BEGIN AgentEnv Manager: mcp",
      "[mcp_servers.managed]",
      'command = "node"',
      "# END AgentEnv Manager: mcp"
    ].join("\n");

    const output = stripManagedSection(input, "mcp");

    expect(output).toContain("[mcp_servers.unmanaged]");
    expect(output).not.toContain("[mcp_servers.managed]");
  });

  it("throws on malformed section markers", () => {
    expect(() =>
      replaceManagedSection(
        "# BEGIN AgentEnv Manager: mcp\n[mcp_servers.x]\n",
        "mcp",
        ""
      )
    ).toThrow("Malformed AgentEnv managed section");
  });
});
