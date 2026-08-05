import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectStore } from "../../../src/main/projects/projectStore";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-project-store-"));
  const appDataRoot = join(root, "data");
  const projectRoot = join(root, "projects", "agentenv-manager");
  await mkdir(projectRoot, { recursive: true });
  return { appDataRoot, projectRoot };
};

describe("project store", () => {
  it("persists a canonical local directory reference across restarts", async () => {
    const { appDataRoot, projectRoot } = await setup();
    const canonicalRoot = await realpath(projectRoot);
    const created = await createProjectStore({ appDataRoot }).addProject(projectRoot);

    expect(created).toMatchObject({
      name: "agentenv-manager",
      rootPath: canonicalRoot,
      exists: true
    });

    const [restored] = await createProjectStore({ appDataRoot }).listProjects();
    expect(restored).toMatchObject({ id: created.id, rootPath: canonicalRoot, exists: true });
  });

  it("rejects a second reference to the same canonical directory", async () => {
    const { appDataRoot, projectRoot } = await setup();
    const store = createProjectStore({ appDataRoot });
    await store.addProject(projectRoot);

    await expect(store.addProject(join(projectRoot, ".")))
      .rejects.toThrow("already added");
  });

  it("matches a Conversation workspace to a Project through its canonical path", async () => {
    const { appDataRoot, projectRoot } = await setup();
    const store = createProjectStore({ appDataRoot });
    const created = await store.addProject(projectRoot);

    await expect(store.findProjectByPath(join(projectRoot, ".")))
      .resolves.toMatchObject({ id: created.id, exists: true });
    await expect(store.findProjectByPath(join(root, "missing"))).resolves.toBeUndefined();
  });

  it("updates display metadata and the last-used Agent without changing the directory", async () => {
    const { appDataRoot, projectRoot } = await setup();
    const store = createProjectStore({ appDataRoot });
    const created = await store.addProject(projectRoot);
    await writeFile(join(projectRoot, "keep.txt"), "project-owned\n");

    const updated = await store.updateProject({
      id: created.id,
      name: "AgentEnv",
      lastAgentId: "codex"
    });

    expect(updated).toMatchObject({ name: "AgentEnv", lastAgentId: "codex" });
    await expect(readFile(join(projectRoot, "keep.txt"), "utf8"))
      .resolves.toBe("project-owned\n");
  });

  it("removes only the Project reference and never deletes the real directory", async () => {
    const { appDataRoot, projectRoot } = await setup();
    const store = createProjectStore({ appDataRoot });
    const created = await store.addProject(projectRoot);
    await writeFile(join(projectRoot, "keep.txt"), "project-owned\n");

    await store.removeProject(created.id);

    await expect(store.listProjects()).resolves.toEqual([]);
    await expect(stat(projectRoot)).resolves.toMatchObject({});
    await expect(readFile(join(projectRoot, "keep.txt"), "utf8"))
      .resolves.toBe("project-owned\n");
  });

  it("keeps a missing Project visible so the user can relocate or remove it", async () => {
    const { appDataRoot, projectRoot } = await setup();
    const store = createProjectStore({ appDataRoot });
    const created = await store.addProject(projectRoot);
    await rm(projectRoot, { recursive: true, force: true });

    await expect(store.listProjects()).resolves.toEqual([
      expect.objectContaining({ id: created.id, exists: false })
    ]);
  });

  it("rejects malformed persisted metadata without touching referenced directories", async () => {
    const { appDataRoot, projectRoot } = await setup();
    await mkdir(appDataRoot, { recursive: true });
    await writeFile(join(appDataRoot, "projects.json"), JSON.stringify({
      formatVersion: 1,
      projects: [{ id: "../unsafe", rootPath: projectRoot }]
    }));

    await expect(createProjectStore({ appDataRoot }).listProjects()).rejects.toThrow();
    await expect(stat(projectRoot)).resolves.toMatchObject({});
  });
});
