// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillsEditor } from "../../src/renderer/components/SkillsEditor";
import type {
  ActivationPreview,
  AssetPolicy,
  McpLibraryEntry,
  SkillLibraryEntry
} from "../../src/shared/types";

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
  disabledSkillPaths: ["/tmp/disabled-skill"]
};

const librarySkills: SkillLibraryEntry[] = [
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
];

const mcpServers: McpLibraryEntry[] = [
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
];

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
  vi.restoreAllMocks();
});

describe("SkillsEditor", () => {
  it("preserves the full editor when mode is omitted", () => {
    render(
      <SkillsEditor
        value={mixedPolicy}
        configText={configWithMcp}
        configLanguage="jsonc"
        librarySkills={librarySkills}
        mcpServers={mcpServers}
        onChange={vi.fn()}
      />
    );

    const inventory = screen.getByRole("region", { name: "Resource inventory" });
    expect(
      within(inventory).getByRole("group", { name: "Skill agentenv-reviewer" })
    ).toBeInTheDocument();
    expect(
      within(inventory).getByRole("group", { name: "Agent reviewer.toml" })
    ).toBeInTheDocument();
    expect(within(inventory).getAllByRole("group", { name: "MCP context7" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add library skill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add library MCP" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByRole("textbox", { name: "Disabled Skill Paths" })).toHaveValue(
      "/tmp/disabled-skill"
    );
  });

  it("renders only skill resources in skills mode", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        mode="skills"
        value={mixedPolicy}
        configText={configWithMcp}
        configLanguage="jsonc"
        librarySkills={librarySkills}
        mcpServers={mcpServers}
        onChange={onChange}
      />
    );

    const inventory = screen.getByRole("region", { name: "Resource inventory" });
    const ownedSkill = within(inventory).getByRole("group", {
      name: "Skill agentenv-reviewer"
    });
    expect(ownedSkill).toBeInTheDocument();
    const librarySkill = within(inventory).getByRole("group", {
      name: "Library skill agentenv-shared-reviewer"
    });
    expect(librarySkill).toBeInTheDocument();
    expect(
      within(inventory).queryByRole("group", { name: "Agent reviewer.toml" })
    ).not.toBeInTheDocument();
    expect(within(inventory).queryByRole("group", { name: /MCP / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add library MCP" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Disabled Skill Paths" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add skill" })).not.toBeInTheDocument();

    fireEvent.change(within(ownedSkill).getByLabelText("Target name"), {
      target: { value: "agentenv-updated-reviewer" }
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      ownedDirs: [
        {
          ...mixedPolicy.ownedDirs[0],
          targetName: "agentenv-updated-reviewer"
        },
        mixedPolicy.ownedDirs[1]
      ]
    });

    fireEvent.click(screen.getByRole("button", { name: "Add library skill" }));
    const dialog = screen.getByRole("dialog", { name: "Add library skills" });
    expect(within(dialog).getByLabelText("Shared Reviewer")).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("GitHub Reviewer"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add selected skills" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      skillRefs: [
        mixedPolicy.skillRefs[0],
        {
          libraryId: "github-reviewer",
          targetName: "github-reviewer"
        }
      ]
    });

    fireEvent.click(within(ownedSkill).getByRole("button", { name: "Remove profile skill" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      ownedDirs: [mixedPolicy.ownedDirs[1]]
    });

    fireEvent.click(within(librarySkill).getByRole("button", { name: "Remove from profile" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      skillRefs: []
    });
  });

  it("renders only MCP resources in mcp mode", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        mode="mcp"
        value={mixedPolicy}
        configText={configWithMcp}
        configLanguage="jsonc"
        preview={preview}
        librarySkills={librarySkills}
        mcpServers={mcpServers}
        onChange={onChange}
      />
    );

    const inventory = screen.getByRole("region", { name: "Resource inventory" });
    const contextRows = within(inventory).getAllByRole("group", { name: "MCP context7" });
    expect(contextRows).toHaveLength(2);
    expect(contextRows[0]).toHaveTextContent("Library");
    expect(contextRows[1]).toHaveTextContent("Raw config");
    expect(within(inventory).getByRole("group", { name: "MCP filesystem" })).toHaveTextContent(
      "npx -y @modelcontextprotocol/server-filesystem"
    );
    expect(within(inventory).queryByRole("group", { name: /Skill / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add library skill" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Disabled Skill Paths" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add library MCP" }));
    const dialog = screen.getByRole("dialog", { name: "Add library MCP servers" });
    expect(within(dialog).getByLabelText("Context7")).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("Docs Search"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add selected MCP servers" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      mcpRefs: [
        mixedPolicy.mcpRefs[0],
        {
          libraryId: "docs",
          targetName: "docs"
        }
      ]
    });

    fireEvent.click(within(contextRows[0]).getByRole("button", { name: "Remove from profile" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      mcpRefs: []
    });
  });

  it("renders only disabled paths in advanced mode", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        mode="advanced"
        value={mixedPolicy}
        configText={configWithMcp}
        configLanguage="jsonc"
        librarySkills={librarySkills}
        mcpServers={mcpServers}
        onChange={onChange}
      />
    );

    const disabledPaths = screen.getByRole("textbox", { name: "Disabled Skill Paths" });
    expect(disabledPaths).toHaveValue("/tmp/disabled-skill");
    expect(screen.queryByRole("region", { name: "Resource inventory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add library/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Skill |MCP |Agent / })).not.toBeInTheDocument();

    fireEvent.change(disabledPaths, {
      target: { value: " /tmp/first \n\n/tmp/second " }
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      disabledSkillPaths: ["/tmp/first", "/tmp/second"]
    });
  });

  it("restores focus to resource picker triggers", () => {
    const cases = [
      { mode: "skills" as const, trigger: "Add library skill", dialog: "Add library skills" },
      { mode: "mcp" as const, trigger: "Add library MCP", dialog: "Add library MCP servers" }
    ];
    const closePaths = ["Escape", "Cancel", "backdrop", "selection"] as const;

    for (const picker of cases) {
      for (const closePath of closePaths) {
        const onChange = vi.fn();
        render(
          <SkillsEditor
            mode={picker.mode}
            value={emptyPolicy}
            configText="{}"
            configLanguage="jsonc"
            librarySkills={librarySkills.slice(1)}
            mcpServers={mcpServers.slice(1)}
            onChange={onChange}
          />
        );

        const trigger = screen.getByRole("button", { name: picker.trigger });
        fireEvent.click(trigger);
        const dialog = screen.getByRole("dialog", { name: picker.dialog });
        const cancel = within(dialog).getByRole("button", { name: "Cancel" });
        expect(cancel).toHaveFocus();

        if (closePath === "Escape") {
          fireEvent.keyDown(document, { key: "Escape" });
        } else if (closePath === "Cancel") {
          fireEvent.click(cancel);
        } else if (closePath === "backdrop") {
          fireEvent.click(dialog.parentElement as HTMLElement);
        } else if (picker.mode === "skills") {
          fireEvent.click(within(dialog).getByLabelText("GitHub Reviewer"));
          fireEvent.click(within(dialog).getByRole("button", { name: "Add selected skills" }));
        } else {
          fireEvent.click(within(dialog).getByLabelText("Docs Search"));
          fireEvent.click(within(dialog).getByRole("button", { name: "Add selected MCP servers" }));
        }

        expect(screen.queryByRole("dialog", { name: picker.dialog })).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
        expect(onChange).toHaveBeenCalledTimes(closePath === "selection" ? 1 : 0);
        cleanup();
      }
    }
  });

  it("cleans up an invalid picker when mode changes", () => {
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const props = {
      value: emptyPolicy,
      configText: "{}",
      configLanguage: "jsonc" as const,
      librarySkills: librarySkills.slice(1),
      mcpServers: mcpServers.slice(1),
      onChange: vi.fn()
    };
    const { rerender } = render(<SkillsEditor {...props} mode="skills" />);

    fireEvent.click(screen.getByRole("button", { name: "Add library skill" }));
    const skillDialog = screen.getByRole("dialog", { name: "Add library skills" });
    fireEvent.click(within(skillDialog).getByLabelText("GitHub Reviewer"));
    const keydownHandler = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "keydown"
    )?.[1];
    expect(keydownHandler).toBeDefined();

    rerender(<SkillsEditor {...props} mode="mcp" />);

    expect(screen.queryByRole("dialog", { name: "Add library skills" })).not.toBeInTheDocument();
    expect(removeEventListener).toHaveBeenCalledWith("keydown", keydownHandler);
    expect(screen.getByRole("button", { name: "Add library MCP" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    rerender(<SkillsEditor {...props} mode="skills" />);
    expect(screen.queryByRole("dialog", { name: "Add library skills" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add library skill" }));
    expect(screen.getByLabelText("GitHub Reviewer")).not.toBeChecked();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Add library skill" })).toHaveFocus();
  });

  it("wraps Tab from the last resource picker control to the first", () => {
    render(
      <SkillsEditor
        mode="skills"
        value={emptyPolicy}
        configText="{}"
        configLanguage="jsonc"
        librarySkills={librarySkills.slice(1)}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add library skill" }));
    const dialog = screen.getByRole("dialog", { name: "Add library skills" });
    fireEvent.click(within(dialog).getByLabelText("GitHub Reviewer"));
    const firstControl = dialog.querySelector<HTMLElement>(".info-tip");
    const lastControl = within(dialog).getByRole("button", { name: "Add selected skills" });
    lastControl.focus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(firstControl).toHaveFocus();
  });

  it("wraps Shift+Tab from the first resource picker control to the last", () => {
    render(
      <SkillsEditor
        mode="mcp"
        value={emptyPolicy}
        configText="{}"
        configLanguage="jsonc"
        mcpServers={mcpServers.slice(1)}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add library MCP" }));
    const dialog = screen.getByRole("dialog", { name: "Add library MCP servers" });
    fireEvent.click(within(dialog).getByLabelText("Docs Search"));
    const firstControl = dialog.querySelector<HTMLElement>(".info-tip");
    const lastControl = within(dialog).getByRole("button", {
      name: "Add selected MCP servers"
    });
    firstControl?.focus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(lastControl).toHaveFocus();
  });

  it("lists Codex TOML MCP servers in mcp mode", () => {
    render(
      <SkillsEditor
        mode="mcp"
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
        onChange={vi.fn()}
      />
    );

    const inventory = screen.getByRole("region", { name: "Resource inventory" });
    expect(within(inventory).getByRole("group", { name: "MCP context7" })).toHaveTextContent(
      "npx -y @upstash/context7-mcp"
    );
    expect(within(inventory).getByRole("group", { name: "MCP figma" })).toHaveTextContent(
      "https://mcp.figma.com/mcp"
    );
  });
});
