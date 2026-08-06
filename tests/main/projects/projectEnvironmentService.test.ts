import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProjectEnvironmentService } from "../../../src/main/projects/projectEnvironmentService";
import { createProjectStore } from "../../../src/main/projects/projectStore";
import { createTargetRegistry } from "../../../src/main/targets/registry";

describe("project environment service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-project-environment-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("discovers only adapter-declared project resources and combines consumers", async () => {
    const appDataRoot = join(root, "data");
    const projectRoot = join(root, "project");
    await mkdir(join(projectRoot, ".agents", "skills", "reviewer"), { recursive: true });
    await writeFile(join(projectRoot, "AGENTS.md"), "# Project rules\n", "utf8");
    await writeFile(
      join(projectRoot, ".agents", "skills", "reviewer", "SKILL.md"),
      "---\nname: reviewer\ndescription: Reviews changes\nversion: 1.2.0\n---\n",
      "utf8"
    );
    await writeFile(join(projectRoot, "unrelated.md"), "not an Agent resource\n", "utf8");
    const store = createProjectStore({ appDataRoot });
    const project = await store.addProject(projectRoot);
    const service = createProjectEnvironmentService({
      projectStore: store,
      targetRegistry: createTargetRegistry()
    });

    const snapshot = await service.inspectProject(project.id, ["opencode", "codex"]);

    expect(snapshot.resources.map((resource) => resource.relativePath)).toEqual([
      "AGENTS.md",
      ".agents/skills/reviewer"
    ]);
    expect(snapshot.resources.find((resource) => resource.name === "reviewer")).toMatchObject({
      kind: "skill",
      version: "1.2.0",
      description: "Reviews changes",
      consumerAgentIds: ["codex", "opencode"],
      state: "ready"
    });
    expect(snapshot.resources.find((resource) => resource.relativePath === "AGENTS.md"))
      .toMatchObject({ consumerAgentIds: ["codex", "opencode"], editable: true });
    expect(snapshot.skillLocations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relativePath: ".agents/skills",
        scope: "shared",
        consumerAgentIds: ["codex", "opencode"],
        writable: true,
        recommended: true
      }),
      expect.objectContaining({
        relativePath: ".opencode/skills",
        scope: "agent-specific",
        consumerAgentIds: ["opencode"],
        writable: true,
        recommended: false
      })
    ]));
  });

  it("reports escaping or linked resources as unsafe without reading their contents", async () => {
    const appDataRoot = join(root, "data");
    const projectRoot = join(root, "project");
    const external = join(root, "external");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(join(external, "skills", "secret"), { recursive: true });
    await writeFile(join(external, "skills", "secret", "SKILL.md"), "secret\n", "utf8");
    await symlink(join(external, "skills"), join(projectRoot, ".agents"));
    const store = createProjectStore({ appDataRoot });
    const project = await store.addProject(projectRoot);
    const service = createProjectEnvironmentService({
      projectStore: store,
      targetRegistry: createTargetRegistry()
    });

    const snapshot = await service.inspectProject(project.id, ["codex"]);

    expect(snapshot.partial).toBe(true);
    expect(snapshot.resources).toEqual([]);
    expect(snapshot.issues.join(" ")).toMatch(/symbolic link|unsafe/i);
    expect(JSON.stringify(snapshot)).not.toContain("secret\\n");
  });

  it("exposes MCP names without returning credential values", async () => {
    const appDataRoot = join(root, "data");
    const projectRoot = join(root, "project");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      join(projectRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { github: { command: "server", env: { TOKEN: "secret-token" } } } }),
      "utf8"
    );
    const store = createProjectStore({ appDataRoot });
    const project = await store.addProject(projectRoot);
    const service = createProjectEnvironmentService({
      projectStore: store,
      targetRegistry: createTargetRegistry()
    });

    const snapshot = await service.inspectProject(project.id, ["claude-code"]);

    expect(snapshot.resources).toEqual([
      expect.objectContaining({ kind: "mcp", name: "github", editable: false })
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("secret-token");
  });

  it("previews fresh project and Agent-global resources without returning MCP credentials", async () => {
    const appDataRoot = join(root, "data");
    const projectRoot = join(root, "project");
    const homeDir = join(root, "home");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "AGENTS.md"), "# Project\n", "utf8");
    const registry = createTargetRegistry();
    const adapter = registry.get("opencode");
    const paths = adapter.createTargetPaths({ homeDir });
    if (!paths.skillsDir) throw new Error("OpenCode Skills directory is unavailable");
    await mkdir(paths.skillsDir, { recursive: true });
    await writeFile(paths.instructionsPath, "# Global\n", "utf8");
    await writeFile(
      paths.configPath,
      JSON.stringify({ mcp: { github: { command: "server", environment: { TOKEN: "super-secret-token" } } } }),
      "utf8"
    );
    const store = createProjectStore({ appDataRoot });
    const project = await store.addProject(projectRoot);
    const service = createProjectEnvironmentService({ projectStore: store, targetRegistry: registry });

    const preview = await service.previewProject(project.id, {
      ...adapter.descriptor,
      paths,
      health: { executablePath: "/usr/local/bin/opencode" }
    } as never);

    expect(preview.projectResources).toEqual([
      expect.objectContaining({ kind: "instructions", name: "AGENTS.md" })
    ]);
    expect(preview.globalResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "instructions", path: paths.instructionsPath }),
      expect.objectContaining({ kind: "mcp", name: "github" })
    ]));
    expect(preview.loadOrder).toBe("unknown");
    expect(JSON.stringify(preview)).not.toContain("super-secret-token");
  });
});
