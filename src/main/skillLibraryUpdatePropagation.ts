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
  copiedInstalls: SkillInventoryEntry[];
  stateUpdates: LibraryUpdateStateChange[];
}

export const prepareLibraryUpdatePropagation = async ({
  inventory,
  libraryId,
  currentContentHash,
  nextContentHash,
  targetStatesDir
}: {
  inventory: SkillInventoryEntry[];
  libraryId: string;
  currentContentHash: string;
  nextContentHash: string;
  targetStatesDir: string;
}): Promise<LibraryUpdatePropagation> => {
  const managedInstalls = inventory.filter(
    (entry) =>
      entry.status === "managed" &&
      entry.libraryId === libraryId &&
      (entry.installMethod === "copied" || entry.installMethod === "linked")
  );
  const copiedInstalls = managedInstalls.filter((entry) => entry.installMethod === "copied");
  const driftedInstall = managedInstalls.find((entry) => entry.contentMatchesLibrary !== true);
  if (driftedInstall) {
    throw new Error(
      `${driftedInstall.name} changed in ${driftedInstall.path}; review that Agent copy before updating the Library`
    );
  }

  for (const install of copiedInstalls) {
    if (await hashSkillContent(install.path) !== currentContentHash) {
      throw new Error(
        `${install.name} changed in ${install.path}; review that Agent copy before updating the Library`
      );
    }
  }

  const targetIds = [...new Set(
    managedInstalls
      .map((entry) => entry.foundIn[0])
      .filter((targetId): targetId is string => Boolean(targetId))
  )];
  const stateUpdates = (
    await Promise.all(targetIds.map(async (targetId) => {
      const path = join(targetStatesDir, `${targetId}.json`);
      if (!(await pathExists(path))) return undefined;
      const state = parseTargetState(JSON.parse(await readFile(path, "utf8")));
      const installPaths = new Set(
        managedInstalls
          .filter((entry) => entry.foundIn[0] === targetId)
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

  return { copiedInstalls, stateUpdates };
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
  for (const update of propagation.stateUpdates) {
    await writeAtomic(update.path, `${JSON.stringify(update.state, null, 2)}\n`);
    parseTargetState(JSON.parse(await readFile(update.path, "utf8")));
  }
};
