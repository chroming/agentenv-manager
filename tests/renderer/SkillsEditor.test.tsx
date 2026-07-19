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
    updatePolicy: "tracked",
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
    updatePolicy: "tracked",
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
  profileContentHash: "profile-hash",
  libraryVersions: { skills: {}, mcp: {} },
  targetId: "opencode",
  createdAt: "2026-06-30T00:00:00.000Z",
  warnings: [],
  errors: [],
  changes: [],
  resourceChanges: [],
  liveFingerprints: {},
  resourceFingerprints: {},
  sourceFingerprints: {},
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
    const onCheckSkillUpdates = vi.fn();
    const onPreviewSkillUpdate = vi.fn();
    render(
      <SkillsEditor
        mode="skills"
        value={mixedPolicy}
        configText={configWithMcp}
        configLanguage="jsonc"
        librarySkills={librarySkills}
        mcpServers={mcpServers}
        skillUpdates={[
          {
            id: "shared-reviewer",
            name: "Shared Reviewer",
            sourceType: "local",
            currentRevision: "abc123",
            latestRevision: "def456",
            updateAvailable: true
          }
        ]}
        onCheckSkillUpdates={onCheckSkillUpdates}
        onPreviewSkillUpdate={onPreviewSkillUpdate}
        onChange={onChange}
      />
    );

    const inventory = screen.getByRole("region", { name: "Profile skills" });
    const ownedSkill = within(inventory).getByRole("listitem", {
      name: "Profile-owned skill agentenv-reviewer"
    });
    expect(ownedSkill).toBeInTheDocument();
    const librarySkill = within(inventory).getByRole("listitem", {
      name: "Profile skill agentenv-shared-reviewer"
    });
    expect(librarySkill).toBeInTheDocument();
    expect(librarySkill).toHaveTextContent("Update available");
    expect(within(inventory).queryByText("Agent reviewer.toml")).not.toBeInTheDocument();
    expect(within(inventory).queryByText("context7")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add library MCP" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Disabled Skill Paths" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add skill" })).not.toBeInTheDocument();

    fireEvent.click(within(librarySkill).getByRole("switch", { name: "Disable Shared Reviewer" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      skillRefs: [
        {
          ...mixedPolicy.skillRefs[0],
          enabled: false
        }
      ]
    });

    fireEvent.click(screen.getByRole("button", { name: "Check profile skill updates" }));
    expect(onCheckSkillUpdates).toHaveBeenCalledWith(["shared-reviewer"]);
    fireEvent.click(within(librarySkill).getByRole("button", { name: "Update" }));
    expect(onPreviewSkillUpdate).toHaveBeenCalledWith("shared-reviewer");

    fireEvent.click(screen.getByRole("button", { name: "Add library skill" }));
    const dialog = screen.getByRole("dialog", { name: "Add library skills" });
    expect(within(dialog).queryByLabelText("Shared Reviewer")).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("GitHub · Revision def456");
    fireEvent.click(within(dialog).getByLabelText("GitHub Reviewer"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add selected skills" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      skillRefs: [
        mixedPolicy.skillRefs[0],
        {
          libraryId: "github-reviewer",
          targetName: "github-reviewer",
          enabled: true
        }
      ]
    });

    fireEvent.click(
      within(ownedSkill).getByRole("button", {
        name: "More actions for profile-owned skill agentenv-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit install name" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit profile-owned skill" });
    fireEvent.change(within(editDialog).getByLabelText("Install name"), {
      target: { value: "agentenv-updated-reviewer" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      ownedDirs: [
        { ...mixedPolicy.ownedDirs[0], targetName: "agentenv-updated-reviewer" },
        mixedPolicy.ownedDirs[1]
      ]
    });

    fireEvent.click(
      within(ownedSkill).getByRole("button", {
        name: "More actions for profile-owned skill agentenv-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from profile" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      ownedDirs: [mixedPolicy.ownedDirs[1]]
    });

    fireEvent.click(
      within(librarySkill).getByRole("button", {
        name: "More actions for profile skill agentenv-shared-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from profile" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...mixedPolicy,
      skillRefs: []
    });
  });

  it("locks Profile controls for a globally disabled Library skill", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        mode="skills"
        value={mixedPolicy}
        configText="{}"
        librarySkills={librarySkills.map((skill) => ({ ...skill, globallyEnabled: false }))}
        onChange={onChange}
      />
    );

    const row = screen.getByRole("listitem", {
      name: "Profile skill agentenv-shared-reviewer"
    });
    expect(row).toHaveTextContent("Disabled in Library");
    expect(
      within(row).getByRole("switch", { name: "Shared Reviewer is disabled in Library" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check profile skill updates" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add library skill" }));
    expect(screen.queryByLabelText("Shared Reviewer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("GitHub Reviewer")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add library skills" })).toHaveTextContent(
      "No library skills available"
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("distinguishes Library revision, update tracking, and Target deployment", () => {
    render(
      <SkillsEditor
        mode="skills"
        value={{
          ...emptyPolicy,
          skillRefs: [{ libraryId: "captured-reviewer", targetName: "captured-reviewer" }]
        }}
        configText="{}"
        librarySkills={[
          {
            id: "captured-reviewer",
            name: "Captured Reviewer",
            description: "Captured from a Target",
            path: "/tmp/agentenv/skills-library/captured-reviewer",
            sourceType: "local",
            updatePolicy: "untracked",
            contentHash: "78f06085a49a5f46",
            updatedAt: "2026-07-16T00:00:00.000Z"
          }
        ]}
        appliedSkillVersions={{ "captured-reviewer": "previous-revision" }}
        selectedTargetName="OpenCode"
        onChange={vi.fn()}
      />
    );

    const row = screen.getByRole("listitem", { name: "Profile skill captured-reviewer" });
    expect(row).toHaveTextContent("Library revision 78f0608");
    expect(row).toHaveTextContent("Local");
    expect(row).toHaveTextContent("/tmp/agentenv/skills-library/captured-reviewer");
    expect(row).not.toHaveTextContent("Not tracked");
    expect(row).toHaveTextContent("Apply pending");
    expect(row).toHaveTextContent("OpenCode · previou");
    expect(within(row).getByTitle(/Apply pending.*OpenCode revision previous-revision.*No update source/))
      .toBeInTheDocument();
    fireEvent.focus(within(row).getByLabelText("Full skill detail captured-reviewer"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Library revision 78f06085a49a5f46 · Local · /tmp/agentenv/skills-library/captured-reviewer"
    );
  });

  it("relinks a missing Profile reference through a searchable Library picker", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        mode="skills"
        value={{
          ...emptyPolicy,
          skillRefs: [{ libraryId: "removed-reviewer", targetName: "reviewer" }]
        }}
        configText="{}"
        librarySkills={librarySkills}
        onChange={onChange}
      />
    );

    const row = screen.getByRole("listitem", { name: "Profile skill reviewer" });
    expect(row).toHaveTextContent("Missing");
    expect(within(row).getByRole("switch", { name: "Missing Library skill reviewer" }))
      .toBeDisabled();
    fireEvent.click(within(row).getByRole("button", { name: "Relink" }));

    const dialog = screen.getByRole("dialog", { name: "Relink missing skill" });
    fireEvent.change(within(dialog).getByLabelText("Search library skills"), {
      target: { value: "github" }
    });
    expect(within(dialog).queryByLabelText("Shared Reviewer")).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("GitHub · Revision def456");
    fireEvent.click(within(dialog).getByLabelText("GitHub Reviewer"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Relink skill" }));

    expect(onChange).toHaveBeenCalledWith({
      ...emptyPolicy,
      skillRefs: [{ libraryId: "github-reviewer", targetName: "reviewer", enabled: true }]
    });
  });

  it("offers a local working state when importing a Profile-only skill", () => {
    const onImportOwnedSkill = vi.fn();
    render(
      <SkillsEditor
        mode="skills"
        value={mixedPolicy}
        configText="{}"
        librarySkills={librarySkills}
        importingOwnedSkillIndex={0}
        onImportOwnedSkill={onImportOwnedSkill}
        onChange={vi.fn()}
      />
    );

    const row = screen.getByRole("listitem", {
      name: "Profile-owned skill agentenv-reviewer"
    });
    expect(row).toHaveTextContent("Profile file · Revision unavailable");
    const importButton = within(row).getByRole("button", {
      name: "Import agentenv-reviewer to Library"
    });
    expect(importButton).toHaveTextContent("Importing");
    expect(importButton).toBeDisabled();
    expect(importButton).toHaveAttribute("aria-busy", "true");
    expect(onImportOwnedSkill).not.toHaveBeenCalled();
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

    const inventory = screen.getByRole("region", { name: "Profile MCP servers" });
    const contextRows = within(inventory).getAllByRole("group", { name: "MCP context7" });
    expect(contextRows).toHaveLength(2);
    expect(contextRows[0]).toHaveTextContent("Library");
    expect(contextRows[1]).toHaveTextContent("Native config");
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

    expect(within(inventory).queryByText("Inventory")).not.toBeInTheDocument();
    expect(within(inventory).queryByText("Configured")).not.toBeInTheDocument();
    fireEvent.click(
      within(contextRows[0]).getByRole("button", { name: "Remove context7 from profile" })
    );
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
    const firstControl = within(dialog).getByLabelText("Search library skills");
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

    const inventory = screen.getByRole("region", { name: "Profile MCP servers" });
    expect(within(inventory).getByRole("group", { name: "MCP context7" })).toHaveTextContent(
      "npx -y @upstash/context7-mcp"
    );
    expect(within(inventory).getByRole("group", { name: "MCP figma" })).toHaveTextContent(
      "https://mcp.figma.com/mcp"
    );
  });
});
