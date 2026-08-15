import type { SkillUpdateConfirmation } from "../../shared/types";
import type { SkillLibraryStore } from "../skillLibraryStore";
import { parseId, type IpcRegistrationHandles } from "./registration";

export const registerSkillUpdateIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  skillLibraryStore: SkillLibraryStore,
  waitForBackgroundDelay: () => Promise<void>
) => {
  const { diagnosticHandle, handleMutation } = handles;
  diagnosticHandle("skills:preview-update", async (_event, id: unknown) => {
    await waitForBackgroundDelay();
    return skillLibraryStore.previewUpdate(parseId(id, "skill id"));
  });
  diagnosticHandle("skills:preview-updates", async (_event, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error("Skill update preview requires a list of Skill ids");
    await waitForBackgroundDelay();
    return skillLibraryStore.previewUpdates(ids.map((id) => parseId(id, "skill id")));
  });
  diagnosticHandle("skills:read-update-change", (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Skill update file selection is invalid");
    }
    const candidate = input as { previewId?: unknown; path?: unknown };
    if (typeof candidate.previewId !== "string" || typeof candidate.path !== "string") {
      throw new Error("Skill update file selection is invalid");
    }
    return skillLibraryStore.readUpdateChange({
      previewId: parseId(candidate.previewId, "Skill update preview id"),
      path: candidate.path
    });
  });
  handleMutation("skills:update-library", (_event, input: SkillUpdateConfirmation) => {
    if (!input || typeof input !== "object" || typeof input.previewId !== "string") {
      throw new Error("Skill update confirmation requires a preview");
    }
    return skillLibraryStore.updateSkill({
      id: parseId(input.id, "skill id"),
      previewId: input.previewId,
      syncCopiedInstalls: input.syncCopiedInstalls === true
    });
  });
};
