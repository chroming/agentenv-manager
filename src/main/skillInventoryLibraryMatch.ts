import type {
  SkillLibraryEntry,
  SkillRuntimeObservation
} from "../shared/types";

interface SkillInventoryLibraryMatchInput {
  deploymentName: string;
  contentHash: string;
  libraryIds: ReadonlySet<string>;
  runtimeLibraryCandidates: readonly SkillLibraryEntry[];
  observation: SkillRuntimeObservation;
}

export const resolveSkillInventoryLibraryMatch = ({
  deploymentName,
  contentHash,
  libraryIds,
  runtimeLibraryCandidates,
  observation
}: SkillInventoryLibraryMatchInput) => {
  const observedDiscovery = observation.locationRole === "discovery-only";
  const runtimeLibraryId =
    runtimeLibraryCandidates.find((skill) => skill.contentHash === contentHash)?.id ??
    (!observedDiscovery && runtimeLibraryCandidates.length === 1
      ? runtimeLibraryCandidates[0].id
      : undefined);
  return {
    observedDiscovery,
    localLibraryId: !observedDiscovery && libraryIds.has(deploymentName)
      ? deploymentName
      : runtimeLibraryId
  };
};
