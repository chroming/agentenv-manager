// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillsEditor } from "../../src/renderer/components/SkillsEditor";
import type { ActivationPreview, AssetPolicy } from "../../src/shared/types";

const emptyPolicy: AssetPolicy = {
  ownedDirs: [],
  ownedFiles: [],
  skillRefs: [],
  mcpRefs: [],
  disabledSkillPaths: []
};

const mixedPolicy: AssetPolicy = {
  ownedDirs: [
    {
      kind: "skill",
      source: "skills/reviewer",
      targetName: "agentenv-reviewer"
    },
    {
      kind: "agent",
      source: "agents/planner",
      targetName: "planner"
    }
  ],
  ownedFiles: [
    {
      kind: "agent",
      source: "agents/reviewer.toml",
      targetName: "reviewer.toml"
    }
  ],
  skillRefs: [
    {
      libraryId: "shared-reviewer",
      targetName: "agentenv-shared-reviewer"
    }
  ],
  mcpRefs: [
    {
      libraryId: "context7",
      targetName: "context7"
    }
  ],
  disabledSkillPaths: []
};

const configWithMcp = `{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp"
    },
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem"]
    }
  }
}`;

const codexTomlWithMcp = `[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
`;

const preview: ActivationPreview = {
  id: "preview-1",
  profileId: "daily-coding",
  targetId: "opencode",
  createdAt: "2026-06-30T00:00:00.000Z",
  warnings: [],
  errors: [],
  changes: [],
  liveFingerprints: {},
  targetState: {
    managedConfigKeys: [],
    managedMcpNames: ["context7", "filesystem"]
  }
};

afterEach(() => {
  cleanup();
});

describe("SkillsEditor", () => {
  it("does not expose the incomplete profile-owned skill creation flow", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        value={emptyPolicy}
        configText="{}"
        configLanguage="jsonc"
        onChange={onChange}
      />
    );

    expect(screen.queryByRole("button", { name: "Add skill" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("edits existing profile-owned skills without offering new profile-owned skill creation", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        value={{
          ...emptyPolicy,
          ownedDirs: [
            {
              kind: "skill",
              source: "skills/new-skill",
              targetName: "agentenv-new-skill"
            }
          ]
        }}
        configText="{}"
        configLanguage="jsonc"
        onChange={onChange}
      />
    );
    const row = screen.getByRole("group", { name: "Skill agentenv-new-skill" });

    fireEvent.change(within(row).getByLabelText("Source"), {
      target: { value: "skills/reviewer" }
    });
    fireEvent.change(within(row).getByLabelText("Target name"), {
      target: { value: "agentenv-reviewer" }
    });

    expect(onChange).toHaveBeenLastCalledWith({
      ownedDirs: [
        {
          kind: "skill",
          source: "skills/new-skill",
          targetName: "agentenv-reviewer"
        }
      ],
      ownedFiles: [],
      skillRefs: [],
      mcpRefs: [],
      disabledSkillPaths: []
    });
  });

  it("adds multiple shared library skills from a chooser and preserves existing resources", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        value={mixedPolicy}
        configText="{}"
        configLanguage="jsonc"
        librarySkills={[
          {
            id: "shared-reviewer",
            name: "Shared Reviewer",
            description: "Review code",
            path: "/tmp/skills-library/shared-reviewer",
            sourceType: "local",
            source: "/tmp/source/shared-reviewer",
            contentHash: "abc123",
            updatedAt: "2026-07-02T00:00:00.000Z"
          },
          {
            id: "github-reviewer",
            name: "GitHub Reviewer",
            description: "Review from GitHub",
            path: "/tmp/skills-library/github-reviewer",
            sourceType: "github",
            source: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
            remoteRef: "main",
            remoteRevision: "revision-1",
            contentHash: "def456",
            updatedAt: "2026-07-02T00:00:00.000Z"
          }
        ]}
        mcpServers={[
          {
            id: "context7",
            name: "Context7",
            transport: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            env: {}
          }
        ]}
        onChange={onChange}
      />
    );

    expect(screen.getByRole("group", { name: "Skill agentenv-reviewer" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Agent reviewer.toml" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Library skill agentenv-shared-reviewer" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "MCP context7" })).toHaveTextContent("Library");

    fireEvent.click(screen.getByRole("button", { name: "Add library skill" }));
    const skillDialog = screen.getByRole("dialog", { name: "Add library skills" });
    expect(within(skillDialog).getByLabelText("Shared Reviewer")).toBeDisabled();
    fireEvent.click(within(skillDialog).getByLabelText("GitHub Reviewer"));
    fireEvent.click(within(skillDialog).getByRole("button", { name: "Add selected skills" }));

    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      skillRefs: [
        mixedPolicy.skillRefs[0],
        {
          libraryId: "github-reviewer",
          targetName: "agentenv-github-reviewer"
        }
      ],
      mcpRefs: mixedPolicy.mcpRefs
    });

    fireEvent.click(screen.getByRole("button", { name: "Add library MCP" }));
    const mcpDialog = screen.getByRole("dialog", { name: "Add library MCP servers" });
    expect(within(mcpDialog).getByLabelText("Context7")).toBeDisabled();
    expect(within(mcpDialog).getByText("All library MCP servers are already attached.")).toBeInTheDocument();
  });

  it("adds multiple reusable MCP servers from a chooser", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        value={emptyPolicy}
        configText="{}"
        configLanguage="jsonc"
        mcpServers={[
          {
            id: "context7",
            name: "Context7",
            transport: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            env: {}
          },
          {
            id: "docs",
            name: "Docs Search",
            transport: "http",
            url: "https://example.com/mcp"
          }
        ]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add library MCP" }));
    const mcpDialog = screen.getByRole("dialog", { name: "Add library MCP servers" });
    fireEvent.click(within(mcpDialog).getByLabelText("Context7"));
    fireEvent.click(within(mcpDialog).getByLabelText("Docs Search"));
    fireEvent.click(within(mcpDialog).getByRole("button", { name: "Add selected MCP servers" }));

    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyPolicy,
      mcpRefs: [
        {
          libraryId: "context7",
          targetName: "context7"
        },
        {
          libraryId: "docs",
          targetName: "docs"
        }
      ]
    });
  });

  it("lists skills and MCP servers as profile resources", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        value={mixedPolicy}
        configText={configWithMcp}
        configLanguage="jsonc"
        preview={preview}
        onChange={onChange}
      />
    );

    expect(screen.getByRole("region", { name: "Resources" })).toBeInTheDocument();
    const inventory = screen.getByRole("region", { name: "Resource inventory" });
    expect(within(inventory).getByRole("group", { name: "Skill agentenv-reviewer" })).toBeInTheDocument();
    expect(within(inventory).getByRole("group", { name: "Agent reviewer.toml" })).toBeInTheDocument();
    expect(within(inventory).getByRole("group", { name: "Library skill agentenv-shared-reviewer" })).toBeInTheDocument();
    const mcpRows = within(inventory).getAllByRole("group", { name: "MCP context7" });
    expect(mcpRows).toHaveLength(2);
    expect(mcpRows[0]).toHaveTextContent("Library");
    expect(mcpRows[1]).toHaveTextContent("Raw config");
    expect(within(inventory).getByText("https://mcp.context7.com/mcp")).toBeInTheDocument();
    expect(within(inventory).getByRole("group", { name: "MCP filesystem" })).toBeInTheDocument();
    expect(
      within(inventory).getByText("npx -y @modelcontextprotocol/server-filesystem")
    ).toBeInTheDocument();
    expect(within(inventory).getAllByText("MCP")).toHaveLength(3);
    expect(within(inventory).getAllByText("Managed")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "MCP servers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Disabled Skill Paths" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByRole("region", { name: "Advanced resource settings" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Disabled Skill Paths" })).toBeInTheDocument();
  });

  it("lists Codex TOML MCP servers as profile resources", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        value={emptyPolicy}
        configText={codexTomlWithMcp}
        configLanguage="toml"
        preview={{
          ...preview,
          targetId: "codex",
          targetState: {
            managedConfigKeys: [],
            managedMcpNames: ["context7", "figma"]
          }
        }}
        onChange={onChange}
      />
    );

    const inventory = screen.getByRole("region", { name: "Resource inventory" });
    expect(within(inventory).getByRole("group", { name: "MCP context7" })).toBeInTheDocument();
    expect(within(inventory).getByText("npx -y @upstash/context7-mcp")).toBeInTheDocument();
    expect(within(inventory).getByRole("group", { name: "MCP figma" })).toBeInTheDocument();
    expect(within(inventory).getByText("https://mcp.figma.com/mcp")).toBeInTheDocument();
  });
});
