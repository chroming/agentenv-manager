import type { ProjectLaunchResult } from "../../shared/types";
import type { TargetDiscoveryService } from "../targetDiscovery";
import type { TargetRegistry } from "../targets/registry";
import type { AgentLaunchSpec } from "../targets/types";
import type { ProjectStore } from "./projectStore";
import type { RemoteDeviceStore } from "../remoteDevices/remoteDeviceStore";

interface ProjectLauncher {
  launch(spec: AgentLaunchSpec): Promise<void>;
}

export interface ProjectLaunchServiceOptions {
  projectStore: ProjectStore;
  targetRegistry: TargetRegistry;
  targetDiscoveryService: TargetDiscoveryService;
  launcher: ProjectLauncher;
  deviceStore?: RemoteDeviceStore;
}

export interface ProjectLaunchService {
  openProject(projectId: string, agentId: string): Promise<ProjectLaunchResult>;
}

export const createProjectLaunchService = ({
  projectStore,
  targetRegistry,
  targetDiscoveryService,
  launcher,
  deviceStore
}: ProjectLaunchServiceOptions): ProjectLaunchService => ({
  openProject: async (projectId, agentId) => {
    const project = (await projectStore.listProjects()).find((candidate) => candidate.id === projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    if (!project.exists) throw new Error(`Project folder is unavailable: ${project.rootPath}`);

    const adapter = targetRegistry.get(agentId);
    const target = (await targetDiscoveryService.listTargets()).find((candidate) => candidate.id === agentId);
    if (!target?.health.executablePath) {
      throw new Error(`${adapter.descriptor.name} is not enabled or installed`);
    }

    if (project.deviceId) {
      const device = await deviceStore?.get(project.deviceId).catch(() => undefined);
      if (!device) throw new Error(`Remote SSH device not found: ${project.deviceId}`);
      const isRemoteIde = agentId === "vscode" || agentId === "cursor";
      if (isRemoteIde) {
        const spec: AgentLaunchSpec = {
          executablePath: target.health.executablePath,
          args: ["--remote", `ssh-remote+${device.host}`, project.rootPath]
        };
        await launcher.launch(spec);
        await projectStore.updateProject({ id: project.id, lastAgentId: agentId, markOpened: true });
        return {
          agentId,
          agentName: adapter.descriptor.name,
          message: `Opened remote ${project.name} on ${device.name} in ${adapter.descriptor.name}`
        };
      }
    }

    const capability = adapter.projects;
    if (!capability || capability.support.cliLaunch !== "supported") {
      throw new Error(`${adapter.descriptor.name} cannot open Projects from AgentEnv`);
    }
    const spec = capability.createLaunchSpec({
      executablePath: target.health.executablePath,
      projectRoot: project.rootPath
    });
    if (!spec) throw new Error(`${adapter.descriptor.name} could not create a Project launch`);

    await launcher.launch(spec);
    await projectStore.updateProject({ id: project.id, lastAgentId: agentId, markOpened: true });
    return {
      agentId,
      agentName: adapter.descriptor.name,
      message: `Opened ${project.name} in ${adapter.descriptor.name}`
    };
  }
});
