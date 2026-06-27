// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillsEditor } from "../../src/renderer/components/SkillsEditor";
import type { ActivationPreview, AssetPolicy } from "../../src/shared/types";

const emptyPolicy: AssetPolicy = {
  ownedDirs: [],
  ownedFiles: [],
  skillRefs: [],
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
  it("adds and edits switchable skills", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SkillsEditor
        value={emptyPolicy}
        configText="{}"
        configLanguage="jsonc"
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(screen.queryByRole("button", { name: "Add agent" })).not.toBeInTheDocument();

    expect(onChange).toHaveBeenLastCalledWith({
      ownedDirs: [
        {
          kind: "skill",
          source: "skills/new-skill",
          targetName: "agentenv-new-skill"
        }
      ],
      ownedFiles: [],
      skillRefs: [],
      disabledSkillPaths: []
    });

    const nextPolicy = onChange.mock.lastCall?.[0] as AssetPolicy;
    rerender(
      <SkillsEditor
        value={nextPolicy}
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
      disabledSkillPaths: []
    });
  });

  it("lists shared library skills and preserves them during skill edits", () => {
    const onChange = vi.fn();
    const onImportUnmanaged = vi.fn();
    const onUpdateLibrarySkill = vi.fn();
    const onSettingsChange = vi.fn();
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
          }
        ]}
        unmanagedSkills={[
          {
            id: "legacy-reviewer",
            name: "Legacy Reviewer",
            description: "Found on disk",
            path: "/tmp/opencode/skills/legacy-reviewer",
            foundIn: ["opencode"]
          }
        ]}
        skillSettings={{
          skillSyncMethod: "symlink",
          skillStorageLocation: "appData"
        }}
        skillUsage={{ "shared-reviewer": ["Daily Coding"] }}
        onImportUnmanaged={onImportUnmanaged}
        onUpdateLibrarySkill={onUpdateLibrarySkill}
        onSkillSettingsChange={onSettingsChange}
        onChange={onChange}
      />
    );

    expect(screen.getByRole("group", { name: "Skill agentenv-reviewer" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Agent reviewer.toml" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Library skill agentenv-shared-reviewer" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add library skill" }));

    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      skillRefs: [
        mixedPolicy.skillRefs[0],
        {
          libraryId: "shared-reviewer",
          targetName: "agentenv-shared-reviewer"
        }
      ]
    });

    expect(screen.getByRole("region", { name: "Skill library" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Library item shared-reviewer" })).toHaveTextContent(
      "Daily Coding"
    );
    fireEvent.click(screen.getByRole("button", { name: "Update shared-reviewer" }));
    expect(onUpdateLibrarySkill).toHaveBeenCalledWith("shared-reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Import legacy-reviewer" }));
    expect(onImportUnmanaged).toHaveBeenCalledWith("/tmp/opencode/skills/legacy-reviewer");
    fireEvent.change(screen.getByLabelText("Skill sync method"), {
      target: { value: "copy" }
    });
    expect(onSettingsChange).toHaveBeenCalledWith({ skillSyncMethod: "copy" });
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
    expect(within(inventory).getByRole("group", { name: "MCP context7" })).toBeInTheDocument();
    expect(within(inventory).getByText("https://mcp.context7.com/mcp")).toBeInTheDocument();
    expect(within(inventory).getByRole("group", { name: "MCP filesystem" })).toBeInTheDocument();
    expect(
      within(inventory).getByText("npx -y @modelcontextprotocol/server-filesystem")
    ).toBeInTheDocument();
    expect(within(inventory).getAllByText("MCP")).toHaveLength(2);
    expect(within(inventory).getAllByText("Managed")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "MCP servers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Disabled Skill Paths" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
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
