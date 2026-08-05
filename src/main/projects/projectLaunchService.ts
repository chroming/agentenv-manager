import type { ProjectLaunchResult } from "../../shared/types";
import type { TargetDiscoveryService } from "../targetDiscovery";
import type { TargetRegistry } from "../targets/registry";
import type { AgentLaunchSpec } from "../targets/types";
import type { ProjectStore } from "./projectStore";

interface ProjectLauncher {
  launch(spec: AgentLaunchSpec): Promise<void>;
}

interface ProjectLaunchServiceOptions {
  projectStore: ProjectStore;
  targetRegistry: TargetRegistry;
  targetDiscoveryService: TargetDiscoveryService;
  launcher: ProjectLauncher;
}

export interface ProjectLaunchService {
  openProject(projectId: string, agentId: string): Promise<ProjectLaunchResult>;
}

export const createProjectLaunchService = ({
  projectStore,
  targetRegistry,
  targetDiscoveryService,
  launcher
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
