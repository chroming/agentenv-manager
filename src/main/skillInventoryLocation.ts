import type {
  SkillInventoryEntry,
  SkillRuntimeObservation,
  TargetSkillLocation
} from "../shared/types";
import { sharedSkillLocationAuthority } from "./targets/sharedSkillLocations";

export const mergeInventoryLocation = (
  entry: SkillInventoryEntry,
  targetId: string,
  location: TargetSkillLocation | undefined,
  observation?: SkillRuntimeObservation
): void => {
  const observedLocation = observation
    ? {
        role: observation.locationRole,
        shared: observation.shared,
        sharedLocationId: observation.sharedLocationId,
        management: observation.locationManagement
      }
    : undefined;
  const effectiveLocation = location ?? observedLocation;
  const existingLocation = entry.locationRole && entry.sharedLocation !== undefined
    ? {
        role: entry.locationRole,
        shared: entry.sharedLocation,
        sharedLocationId: entry.sharedLocationId,
        management: entry.locationManagement
      }
    : undefined;
  const replacesLocation =
    sharedSkillLocationAuthority(effectiveLocation) >
    sharedSkillLocationAuthority(existingLocation);

  if (replacesLocation) {
    entry.locationRole = effectiveLocation?.role;
    entry.sharedLocation = effectiveLocation?.shared;
    entry.sharedLocationId = effectiveLocation?.sharedLocationId;
    entry.runtimeScope =
      location?.scope ??
      observation?.scope ??
      (effectiveLocation?.shared ? "shared" : "user");
    entry.legacyLocation = effectiveLocation?.management === "legacy";
    entry.locationManagement = effectiveLocation?.management;
    if (observation) {
      entry.runtimeAvailability = observation.availability;
      entry.runtimeConfidence = observation.confidence;
    }
    entry.foundIn = [targetId, ...entry.foundIn.filter((item) => item !== targetId)];
  } else if (!entry.foundIn.includes(targetId)) {
    entry.foundIn.push(targetId);
  }

  if (observation) {
    entry.runtimeStates = [
      ...(entry.runtimeStates ?? []).filter((state) => state.targetId !== targetId),
      {
        targetId,
        availability: observation.availability,
        confidence: observation.confidence,
        issues: observation.issues
      }
    ];
    entry.runtimeIssues = [...new Map(
      (entry.runtimeStates ?? [])
        .flatMap((state) => state.issues)
        .map((issue) => [`${issue.code}:${issue.message}`, issue])
    ).values()];
  }
};
