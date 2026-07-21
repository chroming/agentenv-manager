import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SkillSourceObservation } from "../shared/skillSourceGrouping";
import { isMissingFileError, writeAtomic } from "./fileUtils";

export interface SkillSourceObservationStore {
  read(canonicalLink: string): Promise<SkillSourceObservation | undefined>;
  write(observation: SkillSourceObservation): Promise<void>;
  remove(canonicalLink: string): Promise<void>;
}

const fileNameFor = (canonicalLink: string) =>
  `${createHash("sha256").update(canonicalLink).digest("hex")}.json`;

const isObservation = (value: unknown): value is SkillSourceObservation => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    record.formatVersion !== 1 ||
    typeof record.canonicalLink !== "string" ||
    typeof record.repository !== "string" ||
    typeof record.ref !== "string" ||
    typeof record.directory !== "string" ||
    typeof record.checkedAt !== "string" ||
    !["github-api", "https", "ssh", "file"].includes(String(record.accessTransport)) ||
    record.complete !== true ||
    !Array.isArray(record.candidates)
  ) return false;
  return record.candidates.every((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const item = candidate as Record<string, unknown>;
    return typeof item.sourceSubpath === "string" &&
      typeof item.directory === "string" &&
      typeof item.name === "string" &&
      typeof item.description === "string" &&
      typeof item.contentRevision === "string" &&
      (item.compatibleRevisions === undefined ||
        (Array.isArray(item.compatibleRevisions) && item.compatibleRevisions.every(
          (revision) => typeof revision === "string"
        ))) &&
      (item.validity === "valid" || item.validity === "invalid");
  });
};

export const createSkillSourceObservationStore = (
  directory: string
): SkillSourceObservationStore => {
  const pathFor = (canonicalLink: string) => join(directory, fileNameFor(canonicalLink));
  return {
    read: async (canonicalLink) => {
      const path = pathFor(canonicalLink);
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
        if (!isObservation(parsed) || parsed.canonicalLink !== canonicalLink) {
          await rm(path, { force: true });
          return undefined;
        }
        return parsed;
      } catch (error) {
        if (isMissingFileError(error)) return undefined;
        if (error instanceof SyntaxError) {
          await rm(path, { force: true });
          return undefined;
        }
        throw error;
      }
    },
    write: (observation) =>
      writeAtomic(pathFor(observation.canonicalLink), `${JSON.stringify(observation, null, 2)}\n`),
    remove: (canonicalLink) => rm(pathFor(canonicalLink), { force: true })
  };
};
