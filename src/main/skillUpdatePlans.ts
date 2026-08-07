import type {
  SkillLibraryEntry,
  SkillUpdateImpact,
  SkillUpdatePlan
} from "../shared/types";
import type { SkillMetadataFile } from "./skillLibraryMetadata";

export const createRemovedSourceSkillUpdatePlan = async ({
  discardPendingUpdates,
  impact,
  metadata,
  skill
}: {
  discardPendingUpdates(id: string): Promise<void>;
  impact: SkillUpdateImpact;
  metadata: SkillMetadataFile;
  skill: SkillLibraryEntry;
}): Promise<SkillUpdatePlan> => {
  await discardPendingUpdates(skill.id);
  return {
    id: skill.id,
    name: skill.name,
    sourceType: skill.sourceType,
    source: metadata.source,
    currentRevision: metadata.remoteRevision ?? metadata.contentHash,
    updateAvailable: false,
    sourceStatus: "removed",
    changes: [],
    errors: [],
    impact
  };
};
