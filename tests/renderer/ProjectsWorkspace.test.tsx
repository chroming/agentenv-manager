// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectsWorkspace } from "../../src/renderer/components/ProjectsWorkspace";
import type { AgentEnvApi, ProjectSummary, TargetInfo } from "../../src/shared/types";

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
        consumerAgentIds: ["opencode"],
        state: "ready",
        editable: true,
        contentHash: "skill-hash"
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
      issues: [],
      partial: true
    }),
    selectProjectFolder: vi.fn().mockResolvedValue(undefined),
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
  it("shows a stable list-detail view and keeps remove scoped to the reference", async () => {
    const api = installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    expect(await screen.findByRole("button", { name: "AGENTS.md" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in OpenCode" }));
    await waitFor(() => expect(api.openProject).toHaveBeenCalledWith("project-1", "opencode"));

    fireEvent.click(screen.getByRole("button", { name: "More Project actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove reference" }));
    expect(screen.getByText("The folder and its files will stay unchanged.")).toBeInTheDocument();
  });

  it("opens only editable instruction names as a safe editor", async () => {
    installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "AGENTS.md" }));
    expect(await screen.findByRole("dialog", { name: "Edit Project instruction" }))
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

    fireEvent.click(await screen.findByRole("button", { name: "Add instruction" }));
    expect(await screen.findByRole("dialog", { name: "Edit Project instruction" }))
      .toBeInTheDocument();
    expect(api.createProjectInstruction).not.toHaveBeenCalled();
  });

  it("adds a Library copy and confirms removal of a Project-owned Skill", async () => {
    const api = installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add from Library" }));
    expect(await screen.findByRole("dialog", { name: "Add Skill to Project" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await waitFor(() => expect(api.addProjectSkill).toHaveBeenCalledWith({
      projectId: "project-1",
      agentId: "opencode",
      libraryId: "testing"
    }));

    fireEvent.click(screen.getByRole("button", { name: "Remove review from Project" }));
    expect(screen.getByText("The Project-owned copy will be backed up before removal."))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/ }));
    await waitFor(() => expect(api.removeProjectSkill).toHaveBeenCalledWith({
      projectId: "project-1",
      resourceId: "skill-1",
      expectedHash: "skill-hash"
    }));
  });

  it("refreshes the selected Project environment instead of only reloading references", async () => {
    const api = installApi();
    render(<ProjectsWorkspace targets={[target]} />);
    await screen.findByRole("button", { name: "AGENTS.md" });
    api.listProjects.mockClear();
    api.inspectProject.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Refresh Projects" }));

    await waitFor(() => expect(api.listProjects).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.inspectProject).toHaveBeenCalledWith("project-1"));
  });

  it("keeps a failed Project Skill add actionable inside its dialog", async () => {
    const api = installApi();
    api.addProjectSkill.mockRejectedValue(new Error("Project resource parent is not a regular directory"));
    render(<ProjectsWorkspace targets={[target]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add from Library" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Skill to Project" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Add$/ }));

    expect(await within(dialog).findByRole("alert"))
      .toHaveTextContent("Project resource parent is not a regular directory");
    expect(dialog).toBeInTheDocument();
  });

  it("opens the same Project actions from a row context menu and dismisses with Escape", async () => {
    installApi();
    render(<ProjectsWorkspace targets={[target]} />);

    const row = await screen.findByRole("button", { name: /Example/ });
    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
  });
});
