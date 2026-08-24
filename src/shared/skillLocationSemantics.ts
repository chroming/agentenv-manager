import type { SkillInventoryEntry, TargetSkillLocation } from "./types";

export const isSharedSkillInventoryEntry = (
  entry: Pick<SkillInventoryEntry, "sharedLocation" | "sharedLocationId">
) => entry.sharedLocation === true && Boolean(entry.sharedLocationId);

export const isSharedTargetSkillLocation = (
  location: Pick<TargetSkillLocation, "shared" | "sharedLocationId">
) => location.shared === true && Boolean(location.sharedLocationId);
