// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectsWorkspace } from "../../src/renderer/components/ProjectsWorkspace";
import type {
  AgentEnvApi,
  ProjectSkillLocationSummary,
  ProjectSummary,
  TargetInfo
} from "../../src/shared/types";

const project: ProjectSummary = {
  id: "project-1",
  name: "Example",
  rootPath: "/work/example",
  createdAt: "2026-08-06T00:00:00.000Z",
  exists: true
};

const target = {
  id: "opencode",
  name: "OpenCode",
  health: { executablePath: "/usr/local/bin/opencode" }
} as TargetInfo;

const codexTarget = {
  id: "codex",
  name: "Codex",
  health: { executablePath: "/usr/local/bin/codex" }
} as TargetInfo;

const installApi = () => {
  const api = {
    listProjects: vi.fn().mockResolvedValue([project]),
    inspectProject: vi.fn().mockResolvedValue({
      projectId: project.id,
      projectRoot: project.rootPath,
      resources: [{
        id: "instruction-1",
        kind: "instructions",
        name: "AGENTS.md",
        relativePath: "AGENTS.md",
        absolutePath: "/work/example/AGENTS.md",
        consumerAgentIds: ["opencode"],
        state: "ready",
        editable: true,
        contentHash: "hash"
      }, {
        id: "skill-1",
        kind: "skill",
        name: "review",
        relativePath: ".opencode/skills/review",
        absolutePath: "/work/example/.opencode/skills/review",
        consumerAgentIds: ["opencode", "codex"],
        state: "ready",
        editable: true,
        contentHash: "skill-hash",
        gitState: "tracked-clean"
      }],
      agentSupport: [{
        agentId: "opencode",
        agentName: "OpenCode",
        instructions: { inspect: "supported", mutate: "supported" },
        instructionCreateFile: "AGENTS.md",
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "partial", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      }],
      skillLocations: [{
        id: "location-shared",
        relativePath: ".agents/skills",
        scope: "shared",
        consumerAgentIds: ["opencode"],
        writable: true,
        recommended: true
      }],
      issues: [],
      partial: true,
      git: {
        repository: "git",
        rootRelation: "workspace-root",
        pathStates: {
          "AGENTS.md": "tracked-modified",
          ".agents/skills/review": "tracked-clean"
        }
      }
    }),
    selectProjectFolder: vi.fn().mockResolvedValue(undefined),
    listRemoteDevices: vi.fn().mockResolvedValue([
      { id: "dev-1", name: "Dev Machine", host: "192.168.1.50" }
    ]),
    testRemoteProjectPath: vi.fn().mockResolvedValue({
      exists: true,
      isDirectory: true,
      canonicalPath: "/home/ubuntu/remote-app"
    }),
    addProject: vi.fn(),
    removeProject: vi.fn().mockResolvedValue(undefined),
    openProject: vi.fn().mockResolvedValue({
      agentId: "opencode",
      agentName: "OpenCode",
      message: "Opened"
    }),
    previewProject: vi.fn().mockResolvedValue({
      projectId: project.id,
      agentId: "opencode",
      agentName: "OpenCode",
      fidelity: "partial",
      loadOrder: "unknown",
      projectResources: [],
      globalResources: [],
      issues: []
    }),
    readProjectResource: vi.fn().mockResolvedValue({
      resourceId: "instruction-1",
      name: "AGENTS.md",
      path: "/work/example/AGENTS.md",
      content: "# Original\n",
      contentHash: "hash",
      modifiedAt: "2026-08-06T00:00:00.000Z",
      editable: true
    }),
    prepareProjectInstruction: vi.fn(),
    saveProjectResource: vi.fn().mockResolvedValue({ status: "saved", contentHash: "next" }),
    createProjectInstruction: vi.fn(),
    listProjectRecovery: vi.fn().mockResolvedValue([]),
    restoreProjectRecovery: vi.fn(),
    listSkillLibrary: vi.fn().mockResolvedValue([{
      id: "testing",
      name: "testing",
      description: "Testing workflow",
      path: "/library/testing",
      sourceType: "local",
      updatePolicy: "untracked",
      contentHash: "library-hash",
      updatedAt: "2026-08-06T00:00:00.000Z"
    }]),
    addProjectSkill: vi.fn().mockResolvedValue({ status: "saved", contentHash: "added" }),
    addProjectSkills: vi.fn().mockResolvedValue({
      status: "saved",
      results: [{ libraryId: "testing", status: "saved", contentHash: "added" }]
    }),
    removeProjectSkill: vi.fn().mockResolvedValue({ status: "saved", contentHash: "absent" })
  };
  Object.defineProperty(window, "agentEnv", {
    configurable: true,
    value: api as unknown as AgentEnvApi
  });
  return api;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectsWorkspace", () => {
  it("uses the shared single-object workspace, switcher, inspector, resource, and field contracts", async () => {
    installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    expect(screen.getByRole("heading", { name: "Workspaces" })).toBeInTheDocument();
    const switcherTrigger = await screen.findByRole("button", { name: "Choose Workspace" });
    expect(screen.queryByRole("button", { name: "Add Workspace folder" }))
      .not.toBeInTheDocument();
    expect(switcherTrigger.querySelector(".ui-object-switcher__trigger-icon")).toBeNull();
    expect(document.querySelector(".project-detail__header .ui-inspector-header__icon"))
      .not.toBeNull();
    expect(screen.getByRole("button", { name: "Rename Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Workspace" }).closest(
      ".ui-inspector-header__actions"
    )).not.toBeNull();
    fireEvent.click(switcherTrigger);
    const switcher = await screen.findByRole("dialog", { name: "Choose Workspace" });
    expect(within(switcher).getByRole("button", { name: "Add folder" })).toBeInTheDocument();
    const projectRow = within(switcher).getByRole("option", { name: /Example/ });
    expect(projectRow).toHaveClass("ui-selectable-row", "is-selected");
    expect(projectRow.closest(".ui-object-switcher__list")).toBeInTheDocument();
    expect(document.querySelector(".projects-workbench")).toHaveClass("ui-single-object-workspace");
    expect(document.querySelector(".projects-workbench")).not.toHaveClass("ui-master-detail");
    expect(document.querySelector(".project-detail")).not.toHaveClass("ui-master-detail__pane");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByRole("status")).toHaveTextContent("Git · 1 changed");
    expect(document.querySelector(".project-context-summary")).toBeNull();
    expect(screen.getByRole("heading", { name: "Example" }).closest(".ui-inspector-header"))
      .toBeInTheDocument();
    const agentSwitcher = screen.getByLabelText("Current Agent OpenCode");
    expect(agentSwitcher.closest(".project-agent-switcher")).not.toBeNull();
    expect(agentSwitcher.querySelector(".agent-endpoint-icon")).not.toBeNull();
    expect(agentSwitcher).toHaveClass("agent-context-switcher--static");
    expect(agentSwitcher.tagName).toBe("DIV");
    fireEvent.click(agentSwitcher);
    expect(screen.queryByRole("dialog", { name: "Current Agent OpenCode" }))
      .not.toBeInTheDocument();
    const skillsSection = await screen.findByRole("region", { name: "Skills" });
    expect(skillsSection).toHaveClass("ui-resource-disclosure");
    expect(within(skillsSection).queryByText("Regular files copied into this folder"))
      .not.toBeInTheDocument();
    expect(within(skillsSection).queryByRole("button", { name: "Copy from Library" }))
      .not.toBeInTheDocument();
    fireEvent.click(within(skillsSection).getByRole("button", { name: "Expand Skills" }));
    expect(within(skillsSection).queryByText("Regular files copied into this folder"))
      .not.toBeInTheDocument();
    expect(within(skillsSection).getByText(/Tracked/)).toBeInTheDocument();
    expect(within(skillsSection).getByText(/2 Agents/)).toBeInTheDocument();
    expect(within(skillsSection).queryByText("OpenCode · codex")).not.toBeInTheDocument();
    expect(within(skillsSection).queryByText(".opencode/skills/review"))
      .not.toBeInTheDocument();
    expect(within(skillsSection).getByText("review"))
      .toHaveAttribute("data-ui-overflow-detail", "true");

    fireEvent.click(await within(skillsSection).findByRole("button", { name: "Add Skills" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Skills to Workspace" });
    expect(dialog).toHaveClass("resource-picker-dialog", "resource-picker-dialog--skills");
    expect(within(dialog).getByRole("group", { name: "Resource type" }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Library Skills" }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "testing" })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "testing" }));
    expect(dialog).toHaveTextContent("Git changes stay unstaged and uncommitted.");
    expect(within(dialog).getByRole("combobox", { name: /Workspace location/ }).closest(".ui-field"))
      .toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current Agent OpenCode"))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview environment" })).not.toBeInTheDocument();
  });

  it("shows a stable list-detail view and keeps remove scoped to the reference", async () => {
    const api = installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Expand Instructions" }));
    expect(screen.getAllByText("AGENTS.md")).toHaveLength(1);
    expect(await screen.findByLabelText("Preview of AGENTS.md")).toHaveTextContent("# Original");
    expect(await screen.findByRole("button", { name: "Open AGENTS.md" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in OpenCode" }));
    await waitFor(() => expect(api.openProject).toHaveBeenCalledWith("project-1", "opencode"));

    fireEvent.click(screen.getByRole("button", { name: "More Workspace actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove reference" }));
    expect(screen.getByText("The folder and its files will stay unchanged.")).toBeInTheDocument();
  });

  it("previews every detected Workspace instruction file", async () => {
    const api = installApi();
    const base = await api.inspectProject("project-1");
    api.inspectProject.mockResolvedValue({
      ...base,
      resources: [
        ...base.resources,
        {
          id: "instruction-2",
          kind: "instructions",
          name: "CLAUDE.md",
          relativePath: ".claude/CLAUDE.md",
          absolutePath: "/work/example/.claude/CLAUDE.md",
          consumerAgentIds: ["opencode"],
          state: "ready",
          editable: true,
          contentHash: "claude-hash"
        }
      ]
    });
    api.readProjectResource.mockImplementation(async (_projectId, resourceId) =>
      resourceId === "instruction-2"
        ? {
            resourceId,
            name: "CLAUDE.md",
            path: "/work/example/.claude/CLAUDE.md",
            content: "# Claude rules\n",
            contentHash: "claude-hash",
            modifiedAt: "2026-08-07T00:00:00.000Z",
            editable: true
          }
        : {
            resourceId: "instruction-1",
            name: "AGENTS.md",
            path: "/work/example/AGENTS.md",
            content: "# Original\n",
            contentHash: "hash",
            modifiedAt: "2026-08-06T00:00:00.000Z",
            editable: true
          }
    );
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Expand Instructions" }));
    expect(await screen.findByLabelText("Preview of AGENTS.md")).toHaveTextContent("# Original");
    expect(await screen.findByLabelText("Preview of CLAUDE.md")).toHaveTextContent("# Claude rules");
    expect(api.readProjectResource).toHaveBeenCalledWith("project-1", "instruction-1");
    expect(api.readProjectResource).toHaveBeenCalledWith("project-1", "instruction-2");
  });

  it("keeps at most one resource group expanded across Instructions, Skills, and MCPs", async () => {
    installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    const instructions = await screen.findByRole("region", { name: "Instructions" });
    const skills = await screen.findByRole("region", { name: "Skills" });

    fireEvent.click(within(instructions).getByRole("button", { name: "Expand Instructions" }));
    expect(within(instructions).getByRole("button", { name: "Collapse Instructions" }))
      .toHaveAttribute("aria-expanded", "true");

    fireEvent.click(within(skills).getByRole("button", { name: "Expand Skills" }));
    expect(within(instructions).getByRole("button", { name: "Expand Instructions" }))
      .toHaveAttribute("aria-expanded", "false");
    expect(within(skills).getByRole("button", { name: "Collapse Skills" }))
      .toHaveAttribute("aria-expanded", "true");
    expect(document.querySelectorAll('.ui-resource-disclosure [aria-expanded="true"]'))
      .toHaveLength(1);

    fireEvent.click(within(skills).getByRole("button", { name: "Collapse Skills" }));
    expect(document.querySelectorAll('.ui-resource-disclosure [aria-expanded="true"]'))
      .toHaveLength(0);
  });

  it("opens instruction files in preview before entering the safe editor", async () => {
    installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Expand Instructions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open AGENTS.md" }));
    const dialog = await screen.findByRole("dialog", { name: "Workspace instruction" });
    expect(await within(dialog).findByLabelText("Preview of AGENTS.md"))
      .toHaveTextContent("# Original");
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    expect(within(dialog).getByRole("textbox", { name: "Workspace instruction content" }))
      .toBeInTheDocument();
  });

  it("offers an instruction draft when the selected Agent file is missing", async () => {
    const api = installApi();
    api.inspectProject.mockResolvedValue({
      projectId: project.id,
      projectRoot: project.rootPath,
      resources: [],
      agentSupport: [{
        agentId: "opencode",
        agentName: "OpenCode",
        instructions: { inspect: "supported", mutate: "supported" },
        instructionCreateFile: "AGENTS.md",
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "partial", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      }],
      skillLocations: [{
        id: "location-shared",
        relativePath: ".agents/skills",
        scope: "shared",
        consumerAgentIds: ["opencode"],
        writable: true,
        recommended: true
      }],
      issues: [],
      partial: false
    });
    api.prepareProjectInstruction.mockResolvedValue({
      agentId: "opencode",
      name: "AGENTS.md",
      path: "/work/example/AGENTS.md",
      content: "",
      contentHash: "absent",
      editable: true
    });
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Expand Instructions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add instruction" }));
    expect(await screen.findByRole("dialog", { name: "Workspace instruction" }))
      .toBeInTheDocument();
    expect(api.createProjectInstruction).not.toHaveBeenCalled();
  });

  it("adds a Library copy and confirms removal of a Project-owned Skill", async () => {
    const api = installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Expand Skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Skills" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Skills to Workspace" });
    expect(dialog)
      .toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "testing" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1" }));
    await waitFor(() => expect(api.addProjectSkills).toHaveBeenCalledWith({
      projectId: "project-1",
      locationId: "location-shared",
      items: [{ libraryId: "testing" }]
    }));

    fireEvent.click(screen.getByRole("button", { name: "Remove review from Workspace" }));
    expect(screen.getByText("The Workspace-owned copy will be backed up before removal."))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/ }));
    await waitFor(() => expect(api.removeProjectSkill).toHaveBeenCalledWith({
      projectId: "project-1",
      resourceId: "skill-1",
      expectedHash: "skill-hash"
    }));
  });

  it("requires an explicit choice before replacing a different Project Skill", async () => {
    const api = installApi();
    const initial = await api.inspectProject("project-1");
    api.inspectProject.mockResolvedValue({
      ...initial,
      resources: [...initial.resources, {
        id: "skill-testing",
        kind: "skill",
        name: "testing",
        relativePath: ".agents/skills/testing",
        absolutePath: "/work/example/.agents/skills/testing",
        consumerAgentIds: ["opencode"],
        state: "ready",
        editable: true,
        contentHash: "different-project-hash"
      }]
    });
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Expand Skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Skills" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Skills to Workspace" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "testing" }));
    expect(await within(dialog).findByText("1 Workspace Skills will be replaced")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace and add 1" }));

    await waitFor(() => expect(api.addProjectSkills).toHaveBeenCalledWith({
      projectId: "project-1",
      locationId: "location-shared",
      items: [{ libraryId: "testing", conflictResolution: "replace" }]
    }));
  });

  it("keeps inspect-only Project Skill locations explicit and non-actionable", async () => {
    const api = installApi();
    const initial = await api.inspectProject("project-1");
    api.inspectProject.mockResolvedValue({
      ...initial,
      skillLocations: initial.skillLocations.map((location: ProjectSkillLocationSummary) => ({
        ...location,
        writable: false,
        recommended: false
      }))
    });
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Expand Skills" }));
    expect(await screen.findByText("No enabled Agent provides a writable Workspace Skill location."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Skills" })).not.toBeInTheDocument();
  });

  it("refreshes the selected Workspace instead of reloading every reference", async () => {
    const api = installApi();
    render(<ProjectsWorkspace targets={[target]} />);
    await screen.findByRole("button", { name: "Expand Instructions" });
    api.listProjects.mockClear();
    api.inspectProject.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Refresh Workspace" }));

    await waitFor(() => expect(api.inspectProject).toHaveBeenCalledWith("project-1"));
    expect(api.listProjects).not.toHaveBeenCalled();
  });

  it("restores Workspace order, selection, and the Agent chosen for that folder", async () => {
    const api = installApi();
    const second = {
      ...project,
      id: "project-2",
      name: "Second",
      rootPath: "/work/second"
    };
    api.listProjects.mockResolvedValue([project, second]);
    api.inspectProject.mockImplementation(async (id: string) => ({
      ...(await Promise.resolve({
        projectId: id,
        projectRoot: id === second.id ? second.rootPath : project.rootPath,
        resources: [],
        skillLocations: [],
        agentSupport: [],
        issues: [],
        partial: false,
        git: { repository: "not-git", pathStates: {} }
      }))
    }));
    const onUpdateUiState = vi.fn();
    render(
      <ProjectsWorkspace
        targets={[target, codexTarget]}
        uiState={{
          version: 1,
          selectedWorkspaceId: second.id,
          profileOrder: [],
          agentOrder: [],
          workspaceOrder: [second.id, project.id],
          workspaceAgentSelections: { [second.id]: codexTarget.id }
        }}
        onUpdateUiState={onUpdateUiState}
      />
    );

    expect(await screen.findByRole("heading", { name: "Second" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choose Agent" }))
      .toHaveTextContent("Codex"));
    fireEvent.click(screen.getByRole("button", { name: "Choose Agent" }));
    expect(within(await screen.findByRole("dialog", { name: "Choose Agent" }))
      .getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Choose Workspace" }));
    const workspaceSwitcher = within(await screen.findByRole("dialog", { name: "Choose Workspace" }));
    const workspaceOptions = workspaceSwitcher.getAllByRole("option");
    expect(workspaceOptions.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Second"),
      expect.stringContaining("Example")
    ]);
    expect(workspaceOptions.every((item) => !item.hasAttribute("draggable"))).toBe(true);
    expect(workspaceSwitcher.getAllByRole("button", { name: "Reorder" }))
      .toHaveLength(workspaceOptions.length);
  });

  it("restores the saved Workspace Agent when discovery finishes after the Workspace loads", async () => {
    installApi();
    const uiState = {
      version: 1 as const,
      selectedWorkspaceId: project.id,
      profileOrder: [],
      agentOrder: [],
      workspaceOrder: [project.id],
      workspaceAgentSelections: { [project.id]: codexTarget.id }
    };
    const { rerender } = render(
      <ProjectsWorkspace targets={[target]} uiState={uiState} />
    );

    expect(await screen.findByLabelText("Current Agent OpenCode"))
      .toHaveTextContent("OpenCode");

    rerender(
      <ProjectsWorkspace targets={[target, codexTarget]} uiState={uiState} />
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Choose Agent" }))
      .toHaveTextContent("Codex"));
  });

  it("keeps a failed Project Skill add actionable inside its dialog", async () => {
    const api = installApi();
    api.addProjectSkills.mockRejectedValue(new Error("Project resource parent is not a regular directory"));
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Expand Skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Skills" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Skills to Workspace" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "testing" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 1" }));

    expect(await within(dialog).findByRole("alert"))
      .toHaveTextContent("Project resource parent is not a regular directory");
    expect(dialog).toBeInTheDocument();
  });

  it("copies every unique Skill selected through a reusable Group", async () => {
    const api = installApi();
    api.listSkillLibrary.mockResolvedValue([
      ...(await api.listSkillLibrary()),
      {
        id: "review",
        name: "review",
        description: "Review workflow",
        path: "/library/review",
        sourceType: "local",
        updatePolicy: "untracked",
        contentHash: "review-hash",
        updatedAt: "2026-08-06T00:00:00.000Z"
      }
    ]);
    render(
      <ProjectsWorkspace
        targets={[target]}
        skillGroups={[{
          formatVersion: 1,
          id: "quality",
          name: "Quality",
          description: "Quality checks",
          iconKey: "shield",
          skillIds: ["testing", "review", "testing"],
          createdAt: "2026-08-06T00:00:00.000Z",
          updatedAt: "2026-08-06T00:00:00.000Z"
        }]}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Expand Skills" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Skills" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Skills to Workspace" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Groups" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Quality/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 2" }));

    await waitFor(() => expect(api.addProjectSkills).toHaveBeenCalledWith({
      projectId: "project-1",
      locationId: "location-shared",
      items: [{ libraryId: "review" }, { libraryId: "testing" }]
    }));
  });

  it("opens the same Project actions from a row context menu and dismisses with Escape", async () => {
    installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Choose Workspace" }));
    const switcher = await screen.findByRole("dialog", { name: "Choose Workspace" });
    const row = within(switcher).getByRole("option", { name: /Example/ });
    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Undo last change" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Recovery" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Recovery" })).not.toBeInTheDocument();
  });

  it("allows adding an SSH remote workspace, testing its path, and displaying SSH tag", async () => {
    const api = installApi();
    const remoteProject: ProjectSummary = {
      id: "project-remote",
      name: "Remote App",
      rootPath: "/home/ubuntu/remote-app",
      deviceId: "dev-1",
      deviceName: "Dev Machine",
      deviceHost: "192.168.1.50",
      isRemote: true,
      exists: true,
      createdAt: "2026-08-06T00:00:00.000Z"
    };
    api.addProject.mockResolvedValue(remoteProject);
    api.listProjects.mockResolvedValue([project, remoteProject]);

    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add SSH remote workspace" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Workspace" });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "SSH remote machine" }));

    const pathInput = within(dialog).getByLabelText("Remote directory path");
    fireEvent.change(pathInput, { target: { value: "/home/ubuntu/remote-app" } });

    const testButton = within(dialog).getByRole("button", { name: "Test path" });
    fireEvent.click(testButton);
    await waitFor(() => {
      expect(api.testRemoteProjectPath).toHaveBeenCalledWith("dev-1", "/home/ubuntu/remote-app");
    });
    expect(await within(dialog).findByText(/Remote path verified/)).toBeInTheDocument();

    const submitButton = within(dialog).getByRole("button", { name: "Add remote workspace" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(api.addProject).toHaveBeenCalledWith({
        deviceId: "dev-1",
        rootPath: "/home/ubuntu/remote-app",
        name: undefined
      });
    });
  });
});
