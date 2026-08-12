import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SkillInventoryEntry, TargetState } from "../shared/types";
import { writeAtomic, pathExists } from "./fileUtils";
import { deploySkillDirectory } from "./skillDeployment";
import { hashSkillContent } from "./skillContentHash";
import { parseTargetState } from "./targetState";

export interface LibraryUpdateStateChange {
  path: string;
  state: TargetState;
}

export interface LibraryUpdatePropagation {
  linkedInstalls: SkillInventoryEntry[];
  copiedInstalls: SkillInventoryEntry[];
  stateUpdates: LibraryUpdateStateChange[];
}

export const prepareLibraryUpdatePropagation = async ({
  inventory,
  libraryId,
  currentContentHash,
  nextContentHash,
  targetStatesDir,
  syncCopiedInstalls
}: {
  inventory: SkillInventoryEntry[];
  libraryId: string;
  currentContentHash: string;
  nextContentHash: string;
  targetStatesDir: string;
  syncCopiedInstalls: boolean;
}): Promise<LibraryUpdatePropagation> => {
  const managedInstalls = inventory.filter(
    (entry) =>
      entry.status === "managed" &&
      entry.libraryId === libraryId &&
      (entry.installMethod === "copied" || entry.installMethod === "linked")
  );
  const linkedInstalls = managedInstalls.filter((entry) => entry.installMethod === "linked");
  const copiedInstalls = syncCopiedInstalls
    ? managedInstalls.filter((entry) => entry.installMethod === "copied")
    : [];
  const propagatedInstalls = [...linkedInstalls, ...copiedInstalls];
  const driftedInstall = propagatedInstalls.find((entry) => entry.contentMatchesLibrary !== true);
  if (driftedInstall) {
    throw new Error(
      driftedInstall.installMethod === "copied"
        ? `${driftedInstall.name} changed in ${driftedInstall.path}; turn off Agent copy updates or review that Agent before retrying`
        : `${driftedInstall.name} changed in ${driftedInstall.path}; review that linked Agent Skill before updating the Library`
    );
  }

  for (const install of copiedInstalls) {
    if (await hashSkillContent(install.path) !== currentContentHash) {
      throw new Error(
        `${install.name} changed in ${install.path}; turn off Agent copy updates or review that Agent before retrying`
      );
    }
  }

  const targetIds = [...new Set(
    propagatedInstalls
      .filter((entry) => !entry.managedAsShared)
      .map((entry) => entry.foundIn[0])
      .filter((targetId): targetId is string => Boolean(targetId))
  )];
  const stateUpdates = (
    await Promise.all(targetIds.map(async (targetId) => {
      const path = join(targetStatesDir, `${targetId}.json`);
      if (!(await pathExists(path))) return undefined;
      const state = parseTargetState(JSON.parse(await readFile(path, "utf8")));
      const installPaths = new Set(
        propagatedInstalls
          .filter((entry) => entry.foundIn[0] === targetId)
          .filter((entry) => !entry.managedAsShared)
          .map((entry) => resolve(entry.path))
      );
      const managesVersion = Object.prototype.hasOwnProperty.call(
        state.appliedLibraryVersions?.skills ?? {},
        libraryId
      );
      return {
        path,
        state: {
          ...state,
          appliedLibraryVersions: managesVersion
            ? {
                ...state.appliedLibraryVersions,
                skills: {
                  ...(state.appliedLibraryVersions?.skills ?? {}),
                  [libraryId]: nextContentHash
                }
              }
            : state.appliedLibraryVersions,
          managedResources: (state.managedResources ?? []).map((resource) =>
            resource.kind === "skill" && installPaths.has(resolve(resource.path))
              ? { ...resource, contentHash: nextContentHash }
              : resource
          )
        }
      };
    }))
  ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return { linkedInstalls, copiedInstalls, stateUpdates };
};

export const applyLibraryUpdatePropagation = async ({
  sourceDir,
  nextContentHash,
  propagation
}: {
  sourceDir: string;
  nextContentHash: string;
  propagation: LibraryUpdatePropagation;
}) => {
  for (const install of propagation.copiedInstalls) {
    await deploySkillDirectory({
      sourceDir,
      targetDir: install.path,
      syncMethod: "copy"
    });
    if (await hashSkillContent(install.path) !== nextContentHash) {
      throw new Error(`Updated Agent copy did not match Library: ${install.path}`);
    }
  }
  for (const install of propagation.linkedInstalls) {
    if (await hashSkillContent(install.path) !== nextContentHash) {
      throw new Error(`Linked Agent Skill did not follow the Library update: ${install.path}`);
    }
  }
  for (const update of propagation.stateUpdates) {
    await writeAtomic(update.path, `${JSON.stringify(update.state, null, 2)}\n`);
    parseTargetState(JSON.parse(await readFile(update.path, "utf8")));
  }
};
