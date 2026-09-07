import type { SkillImportConflictResolution, SkillImportPreview, SkillImportPreviewInput } from "../shared/types";

export const prepareReviewedSkillImport = async (
  source: SkillImportPreviewInput,
  resolveConflict: (preview: SkillImportPreview) => Promise<SkillImportConflictResolution | undefined>,
  preferredResolution?: SkillImportConflictResolution
): Promise<SkillImportPreviewInput | undefined> => {
  const preview = await window.agentEnv.previewSkillImport(source);
  if (source.input.expectedContentHash && source.input.expectedContentHash !== preview.incoming.contentHash) {
    throw new Error("Skill content changed after preview. Reopen the addition preview.");
  }
  let resolution: SkillImportConflictResolution | undefined;
  if (preview.conflicts.length > 0) {
    resolution = preferredResolution
      ? "existingId" in preferredResolution && preview.conflicts.some((conflict) => conflict.existing.id === preferredResolution.existingId)
        ? preferredResolution : undefined
      : await resolveConflict(preview);
    if (preferredResolution && !resolution) {
      throw new Error("The selected Library Skill is no longer a matching import conflict.");
    }
    if (!resolution) return undefined;
  }
  return {
    ...source,
    input: { ...source.input, expectedContentHash: preview.incoming.contentHash,
      ...(resolution ? { conflictResolution: resolution } : {}) }
  } as SkillImportPreviewInput;
};
