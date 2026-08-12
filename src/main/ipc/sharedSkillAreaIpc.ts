import type { SharedSkillRetentionInput } from "../../shared/types";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { IpcRegistrationHandles } from "./registration";
import { parseId } from "./registration";

interface SharedSkillAreaIpcServices {
  skillLibraryStore: SkillLibraryStore;
  resolveSharedSkillPaths(values: unknown): Promise<string[]>;
}

export const registerSharedSkillAreaIpc = (
  { diagnosticHandle, handleMutation }: IpcRegistrationHandles,
  { skillLibraryStore, resolveSharedSkillPaths }: SharedSkillAreaIpcServices
) => {
  handleMutation(
    "skills:set-shared-retention",
    async (_event, input: SharedSkillRetentionInput) => {
      await skillLibraryStore.setSharedSkillRetention({
        skillKey: parseId(input?.skillKey, "skill key"),
        paths: await resolveSharedSkillPaths(input?.paths),
        retained: Boolean(input?.retained)
      });
    }
  );
  diagnosticHandle("skills:read-shared-area", () =>
    skillLibraryStore.readSharedSkillAreaState()
  );
  handleMutation("skills:set-shared-area-mode", async (_event, input: unknown) => {
    if (input !== "keep" && input !== "managed" && input !== "profiles-only") {
      throw new Error("Shared Skill area mode is invalid");
    }
    return skillLibraryStore.setSharedSkillAreaMode(input);
  });
};
