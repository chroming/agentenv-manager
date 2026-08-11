import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists } from "./fileUtils";

const OWNER = "agentenv-manager";

export interface OwnedDirExpectation {
  targetId: string;
  kind: "agent" | "skill";
}

export interface OwnerMarkerInput extends OwnedDirExpectation {
  profileId: string;
  source: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const markerPathFor = (targetDir: string) =>
  join(targetDir, ".agentenv-owner.json");

export const markerPathForFile = (targetFile: string) =>
  `${targetFile}.agentenv-owner.json`;

export const createOwnerMarkerContent = (input: OwnerMarkerInput) =>
  `${JSON.stringify({ owner: OWNER, ...input }, null, 2)}\n`;

const isAgentEnvOwnedMarker = async (
  markerPath: string,
  expected: OwnedDirExpectation
) => {
  const content = await readTextIfExists(markerPath);
  if (content.trim().length === 0) {
    return false;
  }

  try {
    const marker = JSON.parse(content) as unknown;
    if (!isRecord(marker)) {
      return false;
    }

    const owner = marker.owner;
    const ownerMatches = owner === undefined || owner === OWNER;
    return (
      ownerMatches &&
      marker.targetId === expected.targetId &&
      marker.kind === expected.kind
    );
  } catch {
    return false;
  }
};

export const legacyOwnerMarkerPathsFor = async (
  targetDir: string,
  expected: OwnedDirExpectation
) => {
  const stats = await lstat(targetDir).catch(() => undefined);
  const candidates = stats?.isSymbolicLink()
    ? [markerPathForFile(targetDir)]
    : [markerPathFor(targetDir), markerPathForFile(targetDir)];
  return (await Promise.all(candidates.map(async (path) =>
    (await isAgentEnvOwnedMarker(path, expected)) ? path : undefined
  ))).filter((path): path is string => Boolean(path));
};

export const isAgentEnvOwnedDir = async (
  targetDir: string,
  expected: OwnedDirExpectation
) => (await legacyOwnerMarkerPathsFor(targetDir, expected)).length > 0;

export const isAgentEnvOwnedFile = async (
  targetFile: string,
  expected: OwnedDirExpectation
) => isAgentEnvOwnedMarker(markerPathForFile(targetFile), expected);
