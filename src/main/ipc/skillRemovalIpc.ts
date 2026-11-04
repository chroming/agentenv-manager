import { createSkillRemovalService } from "../skillRemovalService";
import { parseId, type IpcRegistrationHandles } from "./registration";

export const registerSkillRemovalIpc = (
  { diagnosticHandle, handleMutation }: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  dependencies: Parameters<typeof createSkillRemovalService>[0]
) => {
  const service = createSkillRemovalService(dependencies);
  diagnosticHandle("skills:preview-remove-library", (_event, id: unknown) => service.preview(parseId(id, "Skill id")));
  handleMutation("skills:remove-library", (_event, id: unknown, previewId: unknown) =>
    service.remove(parseId(id, "Skill id"), parseId(previewId, "removal preview")),
  (_event, _id, previewId) => service.mutationPaths(parseId(previewId, "removal preview")));
};
