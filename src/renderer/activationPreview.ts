import type { ActivationPreview } from "../shared/types";

export const activationPreviewHasWork = (
  preview: Pick<
    ActivationPreview,
    | "changes"
    | "resourceChanges"
    | "sharedSkillPreparationChanged"
    | "targetStateChanged"
    | "operation"
  >
) =>
  preview.operation === "takeover" ||
  preview.changes.length > 0 ||
  preview.resourceChanges.length > 0 ||
  preview.sharedSkillPreparationChanged === true ||
  preview.targetStateChanged === true;
