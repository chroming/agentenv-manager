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

export const createOwnerMarkerContent = (input: OwnerMarkerInput) =>
  `${JSON.stringify({ owner: OWNER, ...input }, null, 2)}\n`;

export const isAgentEnvOwnedDir = async (
  targetDir: string,
  expected: OwnedDirExpectation
) => {
  const content = await readTextIfExists(markerPathFor(targetDir));
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
