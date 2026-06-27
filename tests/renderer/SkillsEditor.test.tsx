// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillsEditor } from "../../src/renderer/components/SkillsEditor";
import type { ActivationPreview, AssetPolicy } from "../../src/shared/types";

const emptyPolicy: AssetPolicy = {
  ownedDirs: [],
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
      disabledSkillPaths: []
    });
  });

  it("hides advanced agent resources while preserving them during skill edits", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        value={mixedPolicy}
        configText="{}"
        configLanguage="jsonc"
        onChange={onChange}
      />
    );

    expect(screen.getByRole("group", { name: "Skill agentenv-reviewer" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /agent planner/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

    expect(onChange).toHaveBeenLastCalledWith({
      ownedDirs: [
        mixedPolicy.ownedDirs[0],
        mixedPolicy.ownedDirs[1],
        {
          kind: "skill",
          source: "skills/new-skill",
          targetName: "agentenv-new-skill"
        }
      ],
      disabledSkillPaths: []
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
});
