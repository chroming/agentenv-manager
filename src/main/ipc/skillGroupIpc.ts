import {
  CreateSkillGroupInputSchema,
  UpdateSkillGroupInputSchema
} from "../../shared/skillGroups";
import { SafeIdSchema } from "../../shared/schemas";
import type { SkillGroupStore } from "../skillGroupStore";
import type { IpcRegistrationHandles } from "./registration";

const parseGroupId = (value: unknown) => {
  const parsed = SafeIdSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid Skill Group ID");
  return parsed.data;
};

export const registerSkillGroupIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  skillGroupStore: SkillGroupStore
) => {
  const { diagnosticHandle, handleMutation } = handles;
  diagnosticHandle("skills:list-groups", () => skillGroupStore.list());
  handleMutation("skills:create-group", (_event, input: unknown) =>
    skillGroupStore.create(CreateSkillGroupInputSchema.parse(input))
  );
  handleMutation("skills:update-group", (_event, input: unknown) =>
    skillGroupStore.update(UpdateSkillGroupInputSchema.parse(input))
  );
  handleMutation("skills:remove-group", (_event, id: unknown) =>
    skillGroupStore.remove(parseGroupId(id))
  );
};
