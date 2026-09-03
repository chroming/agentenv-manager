import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectLaunchService } from "../../../src/main/projects/projectLaunchService";
import { createProjectStore } from "../../../src/main/projects/projectStore";
import { createTargetRegistry } from "../../../src/main/targets/registry";
import type { TargetInfo } from "../../../src/shared/types";

describe("project launch service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-project-launch-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("hands an absolute executable and canonical Project cwd to the shared terminal launcher", async () => {
    const projectRoot = join(root, "project");
    await mkdir(projectRoot, { recursive: true });
    const store = createProjectStore({ appDataRoot: join(root, "data") });
    const project = await store.addProject(projectRoot);
    const launch = vi.fn().mockResolvedValue(undefined);
    const target = {
      id: "opencode",
      name: "OpenCode",
      health: { executablePath: "/usr/local/bin/opencode" }
    } as TargetInfo;
    const service = createProjectLaunchService({
      projectStore: store,
      targetRegistry: createTargetRegistry(),
      targetDiscoveryService: { listTargets: vi.fn().mockResolvedValue([target]) } as never,
      launcher: { launch }
    });

    const result = await service.openProject(project.id, "opencode");

    expect(launch).toHaveBeenCalledWith({
      executablePath: "/usr/local/bin/opencode",
      args: [],
      cwd: project.rootPath
    });
    expect(result).toMatchObject({ agentId: "opencode", agentName: "OpenCode" });
    expect((await store.listProjects())[0]?.lastAgentId).toBe("opencode");
  });

  it("does not update last-used Agent when the terminal handoff fails", async () => {
    const projectRoot = join(root, "project");
    await mkdir(projectRoot, { recursive: true });
    const store = createProjectStore({ appDataRoot: join(root, "data") });
    const project = await store.addProject(projectRoot);
    const target = {
      id: "opencode",
      name: "OpenCode",
      health: { executablePath: "/usr/local/bin/opencode" }
    } as TargetInfo;
    const service = createProjectLaunchService({
      projectStore: store,
      targetRegistry: createTargetRegistry(),
      targetDiscoveryService: { listTargets: vi.fn().mockResolvedValue([target]) } as never,
      launcher: { launch: vi.fn().mockRejectedValue(new Error("Terminal unavailable")) }
    });

    await expect(service.openProject(project.id, "opencode")).rejects.toThrow("Terminal unavailable");
    expect((await store.listProjects())[0]?.lastAgentId).toBeUndefined();
  });

  it("rejects disabled or missing Agents with an actionable reason", async () => {
    const projectRoot = join(root, "project");
    await mkdir(projectRoot, { recursive: true });
    const store = createProjectStore({ appDataRoot: join(root, "data") });
    const project = await store.addProject(projectRoot);
    const service = createProjectLaunchService({
      projectStore: store,
      targetRegistry: createTargetRegistry(),
      targetDiscoveryService: { listTargets: vi.fn().mockResolvedValue([]) } as never,
      launcher: { launch: vi.fn() }
    });

    await expect(service.openProject(project.id, "opencode"))
      .rejects.toThrow("OpenCode is not enabled or installed");
  });

  it("provides an actionable SSH command when attempting to open a remote Project with a CLI Agent", async () => {
    const project = {
      id: "proj-remote-1",
      name: "RemoteRepo",
      rootPath: "/home/ubuntu/repo",
      deviceId: "dev-1",
      exists: true
    };
    const store = {
      listProjects: vi.fn().mockResolvedValue([project]),
      updateProject: vi.fn().mockResolvedValue(project)
    };
    const target = {
      id: "opencode",
      name: "OpenCode",
      health: { executablePath: "/usr/local/bin/opencode" }
    } as TargetInfo;
    const deviceStore = {
      get: vi.fn().mockResolvedValue({
        id: "dev-1",
        name: "DevServer",
        host: "192.168.1.100",
        user: "ubuntu"
      })
    };
    const service = createProjectLaunchService({
      projectStore: store as never,
      targetRegistry: createTargetRegistry(),
      targetDiscoveryService: { listTargets: vi.fn().mockResolvedValue([target]) } as never,
      launcher: { launch: vi.fn() },
      deviceStore: deviceStore as never
    });

    await expect(service.openProject(project.id, "opencode"))
      .rejects.toThrow("OpenCode does not support remote SSH project launch. Use VS Code / Cursor or run in remote terminal:\nssh -t ubuntu@192.168.1.100 \"cd '/home/ubuntu/repo' && exec \\$SHELL -l\"");
  });
});
