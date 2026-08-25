import {
  AddProjectSkillInputSchema,
  AddProjectSkillsInputSchema,
  CreateProjectInstructionInputSchema,
  RemoveProjectSkillInputSchema,
  SaveProjectResourceInputSchema,
  UpdateProjectInputSchema
} from "../../shared/schemas";
import type { ProjectEnvironmentService } from "../projects/projectEnvironmentService";
import type { ProjectLaunchService } from "../projects/projectLaunchService";
import type { ProjectMutationService } from "../projects/projectMutationService";
import type { ProjectRecoveryStore } from "../projects/projectRecoveryStore";
import type { ProjectStore } from "../projects/projectStore";
import type { TargetDiscoveryService } from "../targetDiscovery";
import { parseId, type IpcRegistrationHandles } from "./registration";

interface ProjectIpcServices {
  projectEnvironmentService: ProjectEnvironmentService;
  projectLaunchService: ProjectLaunchService;
  projectMutationService: ProjectMutationService;
  projectRecoveryStore: ProjectRecoveryStore;
  projectStore: ProjectStore;
  targetDiscoveryService: TargetDiscoveryService;
}

export const registerProjectIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  services: ProjectIpcServices
) => {
  const { diagnosticHandle, handleMutation } = handles;
  const {
    projectEnvironmentService,
    projectLaunchService,
    projectMutationService,
    projectRecoveryStore,
    projectStore,
    targetDiscoveryService
  } = services;
  diagnosticHandle("projects:list", () => projectStore.listProjects());
  diagnosticHandle("projects:find-by-path", (_event, rootPath: unknown) =>
    projectStore.findProjectByPath(String(rootPath))
  );
  diagnosticHandle("projects:inspect", async (_event, id: unknown) => {
    const enabledAgentIds = (await targetDiscoveryService.listTargets()).map((target) => target.id);
    return projectEnvironmentService.inspectProject(parseId(id, "Project id"), enabledAgentIds);
  });
  diagnosticHandle("projects:preview", async (_event, projectId: unknown, agentId: unknown) => {
    const parsedAgentId = parseId(agentId, "Agent id");
    const target = (await targetDiscoveryService.listTargets()).find(
      (candidate) => candidate.id === parsedAgentId
    );
    if (!target) throw new Error("The selected Agent is not enabled or installed");
    return projectEnvironmentService.previewProject(parseId(projectId, "Project id"), target);
  });
  diagnosticHandle("projects:open", (_event, projectId: unknown, agentId: unknown) =>
    projectLaunchService.openProject(
      parseId(projectId, "Project id"),
      parseId(agentId, "Agent id")
    )
  );
  diagnosticHandle("projects:read-resource", (_event, projectId: unknown, resourceId: unknown) =>
    projectMutationService.read(
      parseId(projectId, "Project id"),
      parseId(resourceId, "Project resource id")
    )
  );
  diagnosticHandle("projects:prepare-instruction", (_event, projectId: unknown, agentId: unknown) =>
    projectMutationService.prepareInstruction(
      parseId(projectId, "Project id"),
      parseId(agentId, "Agent id")
    )
  );
  handleMutation("projects:save-resource", (_event, input: unknown) =>
    projectMutationService.save(SaveProjectResourceInputSchema.parse(input))
  );
  handleMutation("projects:create-instruction", (_event, input: unknown) =>
    projectMutationService.createInstruction(CreateProjectInstructionInputSchema.parse(input))
  );
  handleMutation("projects:add-skill", (_event, input: unknown) =>
    projectMutationService.addSkill(AddProjectSkillInputSchema.parse(input))
  );
  handleMutation("projects:add-skills", (_event, input: unknown) =>
    projectMutationService.addSkills(AddProjectSkillsInputSchema.parse(input))
  );
  handleMutation("projects:remove-skill", (_event, input: unknown) =>
    projectMutationService.removeSkill(RemoveProjectSkillInputSchema.parse(input))
  );
  diagnosticHandle("projects:list-recovery", (_event, projectId: unknown) =>
    projectRecoveryStore.list(
      projectId === undefined ? undefined : parseId(projectId, "Project id")
    )
  );
  handleMutation("projects:restore", (_event, receiptId: unknown) =>
    projectMutationService.restore(parseId(receiptId, "Project recovery id"))
  );
  handleMutation("projects:add", (_event, rootPath: unknown) =>
    projectStore.addProject(String(rootPath))
  );
  handleMutation("projects:update", (_event, input: unknown) =>
    projectStore.updateProject(UpdateProjectInputSchema.parse(input))
  );
  handleMutation("projects:remove", (_event, id: unknown) =>
    projectStore.removeProject(parseId(id, "Project id"))
  );
};
