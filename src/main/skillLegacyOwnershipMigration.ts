import { lstat, readFile, realpath } from "node:fs/promises";
import { markerPathFor, markerPathForFile } from "./ownershipMarkers";
import { pathsEqual } from "./platformPaths";

export const legacyOwnedLibraryId = async (skillDir: string) => {
  const stats = await lstat(skillDir).catch(() => undefined);
  const markerPath = stats?.isSymbolicLink() ? markerPathForFile(skillDir) : markerPathFor(skillDir);
  const marker = await readFile(markerPath, "utf8")
    .then((content) => JSON.parse(content) as Record<string, unknown>)
    .catch(() => undefined);
  return marker?.owner === "agentenv-manager" &&
    marker.kind === "skill" &&
    typeof marker.source === "string" &&
    marker.source.startsWith("skills-library/")
    ? marker.source.slice("skills-library/".length)
    : undefined;
};

export const protectedLegacySkillMarkerPaths = (
  targetDir: string,
  legacyMarkerPaths: readonly string[] = []
) => [...new Set([markerPathForFile(targetDir), ...legacyMarkerPaths])];

export const legacySkillOwnershipMigrationReady = (input: {
  markerPaths: readonly string[];
  contentMatchesLibrary: boolean;
  linkedInstall: boolean;
  canonicalPath: string;
  libraryCanonicalPath?: string;
}) =>
  input.markerPaths.length > 0 &&
  input.contentMatchesLibrary &&
  (!input.linkedInstall || Boolean(
    input.libraryCanonicalPath && pathsEqual(input.canonicalPath, input.libraryCanonicalPath)
  ));

export const canPreserveLegacySkillTopology = async (
  targetDir: string,
  libraryDir: string,
  markerPaths: readonly string[] = []
) => {
  if (markerPaths.length === 0) return false;
  if (!(await lstat(targetDir)).isSymbolicLink()) return true;
  return pathsEqual(await realpath(targetDir), await realpath(libraryDir));
};
