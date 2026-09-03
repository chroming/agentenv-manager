import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectEnvironmentService } from "../../../src/main/projects/projectEnvironmentService";
import { createProjectMutationService } from "../../../src/main/projects/projectMutationService";
import { createProjectRecoveryStore } from "../../../src/main/projects/projectRecoveryStore";
import { createProjectStore } from "../../../src/main/projects/projectStore";
import { createTargetRegistry } from "../../../src/main/targets/registry";
import type { SkillLibraryEntry } from "../../../src/shared/types";

describe("project mutation service", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "agentenv-project-mutation-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  const setup = async () => {
    const appDataRoot = join(root, "data");
    const projectRoot = join(root, "project");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(join(projectRoot, ".agents", "skills"), { recursive: true });
    const instructionPath = join(projectRoot, "AGENTS.md");
    await writeFile(instructionPath, "# Before\n", "utf8");
    const projectStore = createProjectStore({ appDataRoot });
    const project = await projectStore.addProject(projectRoot);
    const environmentService = createProjectEnvironmentService({
      projectStore,
      targetRegistry: createTargetRegistry()
    });
    const recoveryStore = createProjectRecoveryStore(appDataRoot);
    const libraryPath = join(root, "library", "review");
    await mkdir(libraryPath, { recursive: true });
    await writeFile(
      join(libraryPath, "SKILL.md"),
      "---\nname: review\ndescription: Review changes.\n---\n\n# Review\n",
      "utf8"
    );
    await writeFile(
      join(libraryPath, ".agentenv-skill.json"),
      "{\"sourceType\":\"local\"}\n",
      "utf8"
    );
    const librarySkill = {
      id: "review",
      name: "review",
      description: "Review changes.",
      path: libraryPath,
      sourceType: "local",
      updatePolicy: "untracked",
      contentHash: "source-hash",
      updatedAt: "2026-08-06T00:00:00.000Z"
    } satisfies SkillLibraryEntry;
    const service = createProjectMutationService({
      environmentService,
      recoveryStore,
      skillLibraryStore: { listSkills: async () => [librarySkill] },
      enabledAgentIds: async () => ["codex"]
    });
    const resource = (await environmentService.inspectProject(project.id, ["codex"])).resources[0]!;
    const skillLocationId = (await environmentService.inspectProject(project.id, ["codex"]))
      .skillLocations.find((location) => location.recommended)!.id;
    return { project, projectRoot, resource, service, recoveryStore, instructionPath, environmentService, skillLocationId };
  };

  it("saves with expected-hash authority and restores from a private receipt", async () => {
    const { project, resource, service, recoveryStore, instructionPath } = await setup();
    const opened = await service.read(project.id, resource.id);
    const saved = await service.save({
      projectId: project.id,
      resourceId: resource.id,
      expectedHash: opened.contentHash,
      content: "# After\n"
    });
    expect(saved.status).toBe("saved");
    expect(await readFile(instructionPath, "utf8")).toBe("# After\n");
    expect((await recoveryStore.list(project.id))).toHaveLength(1);

    const restored = await service.restore(saved.receiptId!);
    expect(restored.status).toBe("restored");
    expect(await readFile(instructionPath, "utf8")).toBe("# Before\n");
  });

  it("rejects stale saves and creates no recovery receipt", async () => {
    const { project, resource, service, recoveryStore, instructionPath } = await setup();
    const opened = await service.read(project.id, resource.id);
    await writeFile(instructionPath, "# External\n", "utf8");
    await expect(service.save({
      projectId: project.id,
      resourceId: resource.id,
      expectedHash: opened.contentHash,
      content: "# Mine\n"
    })).rejects.toThrow("changed outside AgentEnv");
    expect(await readFile(instructionPath, "utf8")).toBe("# External\n");
    expect(await recoveryStore.list(project.id)).toEqual([]);
  });

  it("treats unchanged content as a semantic no-op", async () => {
    const { project, resource, service, recoveryStore } = await setup();
    const opened = await service.read(project.id, resource.id);
    expect(await service.save({
      projectId: project.id,
      resourceId: resource.id,
      expectedHash: opened.contentHash,
      content: opened.content
    })).toMatchObject({ status: "no-op" });
    expect(await recoveryStore.list(project.id)).toEqual([]);
  });

  it("blocks only a Project path whose earlier mutation still requires recovery", async () => {
    const { project, resource, service, recoveryStore } = await setup();
    const opened = await service.read(project.id, resource.id);
    await recoveryStore.prepare({
      projectId: project.id,
      resourceId: resource.id,
      path: opened.path,
      kind: "instructions",
      originalContentBase64: Buffer.from(opened.content).toString("base64"),
      originalHash: opened.contentHash,
      appliedHash: "pending-hash"
    });

    await expect(service.save({
      projectId: project.id,
      resourceId: resource.id,
      expectedHash: opened.contentHash,
      content: "# Blocked\n"
    })).rejects.toThrow("requires recovery");
    expect(await service.read(project.id, resource.id)).toMatchObject({ content: "# Before\n" });
  });

  it("copies a Library Skill as Project-owned files and can restore the prior absence", async () => {
    const { project, projectRoot, service, skillLocationId } = await setup();
    const result = await service.addSkill({
      projectId: project.id,
      locationId: skillLocationId,
      libraryId: "review"
    });
    const destination = join(projectRoot, ".agents", "skills", "review");
    await expect(readFile(join(destination, "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
    await expect(readFile(join(destination, ".agentenv-skill.json"), "utf8"))
      .rejects.toThrow();

    await expect(service.restore(result.receiptId!)).resolves.toMatchObject({ status: "restored" });
    await expect(readFile(join(destination, "SKILL.md"), "utf8")).rejects.toThrow();
  });

  it("rolls back earlier Workspace Skill copies when a batch item fails", async () => {
    const { project, projectRoot, service, recoveryStore, skillLocationId } = await setup();
    const destination = join(projectRoot, ".agents", "skills", "review");

    await expect(service.addSkills({
      projectId: project.id,
      locationId: skillLocationId,
      items: [{ libraryId: "review" }, { libraryId: "missing" }]
    })).rejects.toThrow("Library Skill not found: missing");

    await expect(readFile(join(destination, "SKILL.md"), "utf8")).rejects.toThrow();
    expect((await recoveryStore.list(project.id)).find((receipt) =>
      receipt.resourceId.includes("skill-add")
    )?.status).toBe("restored");
  });

  it("creates a missing declared Project Skill directory and restores its prior absence", async () => {
    const { project, projectRoot, service, skillLocationId } = await setup();
    await rm(join(projectRoot, ".agents"), { recursive: true, force: true });

    const result = await service.addSkill({
      projectId: project.id,
      locationId: skillLocationId,
      libraryId: "review"
    });
    const destination = join(projectRoot, ".agents", "skills", "review");
    await expect(readFile(join(destination, "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");

    await expect(service.restore(result.receiptId!)).resolves.toMatchObject({ status: "restored" });
    await expect(readFile(join(destination, "SKILL.md"), "utf8")).rejects.toThrow();
  });

  it("does not replace an unsafe parent while creating a Project Skill directory", async () => {
    const { project, projectRoot, service, skillLocationId } = await setup();
    await rm(join(projectRoot, ".agents"), { recursive: true, force: true });
    await writeFile(join(projectRoot, ".agents"), "reserved by the project\n", "utf8");

    await expect(service.addSkill({
      projectId: project.id,
      locationId: skillLocationId,
      libraryId: "review"
    })).rejects.toThrow("not a regular directory");
    await expect(readFile(join(projectRoot, ".agents"), "utf8"))
      .resolves.toBe("reserved by the project\n");
  });

  it("requires an explicit replacement choice and restores the prior Project Skill", async () => {
    const { project, projectRoot, service, skillLocationId } = await setup();
    const destination = join(projectRoot, ".agents", "skills", "review");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "SKILL.md"), "# Project version\n", "utf8");

    await expect(service.addSkill({
      projectId: project.id,
      locationId: skillLocationId,
      libraryId: "review"
    })).rejects.toThrow("requires an explicit replacement choice");
    await expect(readFile(join(destination, "SKILL.md"), "utf8"))
      .resolves.toBe("# Project version\n");

    const result = await service.addSkill({
      projectId: project.id,
      locationId: skillLocationId,
      libraryId: "review",
      conflictResolution: "replace"
    });
    await expect(readFile(join(destination, "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");

    await expect(service.restore(result.receiptId!)).resolves.toMatchObject({ status: "restored" });
    await expect(readFile(join(destination, "SKILL.md"), "utf8"))
      .resolves.toBe("# Project version\n");
  });

  it("creates a missing primary Project instruction from a draft and restores absence", async () => {
    const { project, instructionPath, service } = await setup();
    await rm(instructionPath);

    const result = await service.createInstruction({
      projectId: project.id,
      agentId: "codex",
      content: "# New project rules\n"
    });
    expect(await readFile(instructionPath, "utf8")).toBe("# New project rules\n");

    await expect(service.restore(result.receiptId!)).resolves.toMatchObject({ status: "restored" });
    await expect(readFile(instructionPath, "utf8")).rejects.toThrow();
  });

  it("refuses to remove a newly created instruction that changed after its recovery point", async () => {
    const { project, instructionPath, service } = await setup();
    await rm(instructionPath);

    const result = await service.createInstruction({
      projectId: project.id,
      agentId: "codex",
      content: "# New project rules\n"
    });
    await writeFile(instructionPath, "# External project rules\n", "utf8");

    await expect(service.restore(result.receiptId!)).rejects.toThrow("changed after this recovery point");
    await expect(readFile(instructionPath, "utf8")).resolves.toBe("# External project rules\n");
  });

  it("backs up a Project Skill before removal and restores the verified directory", async () => {
    const { project, projectRoot, service, environmentService, skillLocationId } = await setup();
    await service.addSkill({ projectId: project.id, locationId: skillLocationId, libraryId: "review" });
    const resource = (await environmentService.inspectProject(project.id, ["codex"]))
      .resources.find((candidate) => candidate.kind === "skill")!;
    const removed = await service.removeSkill({
      projectId: project.id,
      resourceId: resource.id,
      expectedHash: resource.contentHash!
    });
    const destination = join(projectRoot, ".agents", "skills", "review");
    await expect(readFile(join(destination, "SKILL.md"), "utf8")).rejects.toThrow();

    await expect(service.restore(removed.receiptId!)).resolves.toMatchObject({ status: "restored" });
    await expect(readFile(join(destination, "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
  });

  it("reads, saves, and restores remote instruction files via SSH with local recovery receipts", async () => {
    const { recoveryStore } = await setup();
    const skillLibraryStore = { listSkills: async () => [] };
    const mockDevice = {
      id: "88888888-8888-4888-8888-888888888888",
      name: "Remote Host",
      host: "remote.host",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const mockDeviceStore = {
      list: async () => [mockDevice],
      get: async (id: string) => (id === mockDevice.id ? mockDevice : Promise.reject(new Error("Not found"))),
      add: async () => mockDevice,
      update: async () => mockDevice,
      remove: async () => undefined
    };

    let remoteContent = "# Remote Rules Original\n";
    const mockTransport = {
      execute: async (_dev: unknown, cmd: string, opts?: { input?: Buffer }) => {
        if (cmd.includes("DIR")) {
          return { stdout: Buffer.from("DIR\t/opt/workspace\n"), stderr: "", exitCode: 0 };
        }
        if (cmd.includes("cat --")) {
          return { stdout: Buffer.from(remoteContent), stderr: "", exitCode: 0 };
        }
        if (cmd.includes("cat >")) {
          remoteContent = opts?.input?.toString("utf8") ?? "";
          return { stdout: Buffer.alloc(0), stderr: "", exitCode: 0 };
        }
        return { stdout: Buffer.from(""), stderr: "", exitCode: 0 };
      }
    };

    const project = {
      id: "project-remote-123",
      name: "remote-workspace",
      rootPath: "/opt/workspace",
      deviceId: mockDevice.id,
      createdAt: new Date().toISOString(),
      exists: true,
      isRemote: true
    };

    const mockProjectStore = {
      listProjects: async () => [project],
      findProjectByPath: async () => project,
      addProject: async () => project,
      updateProject: async () => project,
      removeProject: async () => undefined
    };

    const mockEnvironmentService = {
      findResource: async () => ({
        id: "instructions-rule",
        kind: "instructions" as const,
        name: "AGENTS.md",
        relativePath: "AGENTS.md",
        absolutePath: "/opt/workspace/AGENTS.md",
        consumerAgentIds: ["codex"],
        state: "ready" as const,
        editable: true,
        contentHash: "dummy"
      }),
      resolveInstructionDestination: async () => ({
        projectRoot: "/opt/workspace",
        destination: "/opt/workspace/AGENTS.md",
        relativePath: "AGENTS.md"
      })
    } as any;

    const service = createProjectMutationService({
      environmentService: mockEnvironmentService,
      recoveryStore,
      skillLibraryStore,
      projectStore: mockProjectStore,
      deviceStore: mockDeviceStore,
      sshTransport: mockTransport,
      enabledAgentIds: async () => ["codex"]
    });

    const file = await service.read(project.id, "instructions-rule");
    expect(file.content).toBe("# Remote Rules Original\n");

    const saved = await service.save({
      projectId: project.id,
      resourceId: "instructions-rule",
      expectedHash: file.contentHash,
      content: "# Remote Rules Modified\n"
    });
    expect(saved.status).toBe("saved");
    expect(remoteContent).toBe("# Remote Rules Modified\n");

    const restored = await service.restore(saved.receiptId!);
    expect(restored.status).toBe("restored");
    expect(remoteContent).toBe("# Remote Rules Original\n");
  });
});
