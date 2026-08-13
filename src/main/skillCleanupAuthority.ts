import { dirname, resolve } from "node:path";
import type { TargetPaths, TargetSkillLocation } from "../shared/types";
import { isPathInside, pathsEqual } from "./platformPaths";

const cleanupLocationsFor = (targetPaths: TargetPaths): TargetSkillLocation[] =>
  targetPaths.skillLocations?.length
    ? targetPaths.skillLocations
    : [...new Set([
        targetPaths.skillsDir,
        ...(targetPaths.skillScanDirs ?? [])
      ].filter((path): path is string => Boolean(path)))].map((path) => ({
        path,
        role: "preferred-runtime" as const,
        shared: false,
        scanDepth: "direct" as const,
        management: "managed" as const
      }));

export const isSkillCleanupPathAllowed = (
  targetPaths: TargetPaths,
  candidatePath: string
) => {
  const candidate = resolve(candidatePath);
  return cleanupLocationsFor(targetPaths).some((location) => {
    const root = resolve(location.path);
    if (pathsEqual(root, candidate) || !isPathInside(root, candidate)) {
      return false;
    }
    return location.scanDepth === "recursive" || pathsEqual(dirname(candidate), root);
  });
};
