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
    return { project, projectRoot, resource, service, recoveryStore, instructionPath, environmentService };
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
    const { project, projectRoot, service } = await setup();
    const result = await service.addSkill({
      projectId: project.id,
      agentId: "codex",
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

  it("backs up a Project Skill before removal and restores the verified directory", async () => {
    const { project, projectRoot, service, environmentService } = await setup();
    await service.addSkill({ projectId: project.id, agentId: "codex", libraryId: "review" });
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
});
