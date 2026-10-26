import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SkillInventoryEntry, SkillUpdateSkippedCopy, TargetState } from "../shared/types";
import { writeAtomic, pathExists } from "./fileUtils";
import { deploySkillDirectory } from "./skillDeployment";
import { hashSkillContent } from "./skillContentHash";
import { hashInvokedSkill } from "./skillInvocation";
import { parseTargetState } from "./targetState";
import { hashFileContent, hashPathEntry } from "./filesystemIntegrity";

export interface LibraryUpdateStateChange {
  path: string;
  state: TargetState;
  expectedPathHash?: string;
}

export interface LibraryUpdatePropagation {
  linkedInstalls: SkillInventoryEntry[];
  copiedInstalls: SkillInventoryEntry[];
  stateUpdates: LibraryUpdateStateChange[];
  copiedPathHashes?: Record<string, string>;
  skippedCopiedInstalls: SkillUpdateSkippedCopy[];
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
  const copyCandidates = syncCopiedInstalls
    ? managedInstalls.filter((entry) => entry.installMethod === "copied")
    : [];
  const driftedInstall = linkedInstalls.find((entry) => entry.contentMatchesLibrary !== true);
  if (driftedInstall) {
    throw new Error(`${driftedInstall.name} changed in ${driftedInstall.path}; review that linked Agent Skill before updating the Library`);
  }

  const targetIds = [...new Set([...linkedInstalls, ...copyCandidates]
    .filter((entry) => !entry.managedAsShared).flatMap((entry) => entry.foundIn).filter(Boolean))];
  const states = (await Promise.all(targetIds.map(async (targetId) => {
    const path = join(targetStatesDir, `${targetId}.json`);
    if (!(await pathExists(path))) return undefined;
    const content = await readFile(path, "utf8");
    return { targetId, path, content, state: parseTargetState(JSON.parse(content)) };
  }))).filter((item): item is NonNullable<typeof item> => Boolean(item));

  const copiedInstalls: SkillInventoryEntry[] = [];
  const skippedCopiedInstalls: SkillUpdateSkippedCopy[] = [];
  const copiedPathHashes: Record<string, string> = {};
  for (const install of copyCandidates) {
    const before = await hashPathEntry(install.path);
    const installedHash = await hashSkillContent(install.path);
    const matchesCurrent = install.invocationMode === "manual"
      ? install.contentMatchesLibrary === true && install.sourceContentHash === currentContentHash && installedHash === install.contentHash
      : installedHash === currentContentHash;
    const receipts = states.filter((item) => install.foundIn.includes(item.targetId)).flatMap(({ state }) =>
      (state.managedResources ?? []).filter((resource) => resource.kind === "skill" &&
        resource.id === libraryId && resolve(resource.path) === resolve(install.path)));
    // A copy may legitimately lag behind Library after an update without propagation.
    const matchesReceipt = receipts.length > 0 && receipts.every((resource) => resource.contentHash === installedHash);
    if (!matchesCurrent && !matchesReceipt) {
      skippedCopiedInstalls.push({ path: install.path, targetIds: install.foundIn });
      continue;
    }
    if (!before || await hashPathEntry(install.path) !== before) throw new Error(`Agent Skill changed while preparing update: ${install.path}`);
    copiedInstalls.push(install);
    copiedPathHashes[install.path] = before;
  }

  const propagatedInstalls = [...linkedInstalls, ...copiedInstalls];
  const stateUpdates = states.map(({ targetId, path, content: stateContent, state }) => {
    const installPaths = new Set(
      propagatedInstalls
        .filter((entry) => entry.foundIn.includes(targetId))
        .filter((entry) => !entry.managedAsShared)
        .map((entry) => resolve(entry.path))
    );
    const managesVersion = Object.prototype.hasOwnProperty.call(
      state.appliedLibraryVersions?.skills ?? {},
      libraryId
    );
    const ownsInstall = (resource: NonNullable<TargetState["managedResources"]>[number]) =>
      resource.kind === "skill" && resource.id === libraryId && installPaths.has(resolve(resource.path));
    if (!(state.managedResources ?? []).some(ownsInstall)) return undefined;
    return {
      path,
      expectedPathHash: hashFileContent(stateContent),
      state: {
        ...state,
        appliedLibraryVersions: managesVersion && !skippedCopiedInstalls.some((item) => item.targetIds.includes(targetId))
          ? {
              ...state.appliedLibraryVersions,
              skills: {
                ...(state.appliedLibraryVersions?.skills ?? {}),
                [libraryId]: nextContentHash
              }
            }
          : state.appliedLibraryVersions,
        managedResources: (state.managedResources ?? []).map((resource) =>
          ownsInstall(resource)
            ? { ...resource, contentHash: nextContentHash, sourceContentHash: nextContentHash }
            : resource
        )
      }
    };
  }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return { linkedInstalls, copiedInstalls, stateUpdates, copiedPathHashes, skippedCopiedInstalls };
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
      syncMethod: "copy",
      invocationMode: install.invocationMode,
      targetId: install.invocationTargetId,
      expectedTargetHash: propagation.copiedPathHashes?.[install.path]
    });
    const deployedHash = await hashInvokedSkill(sourceDir, install.invocationTargetId ?? "", install.invocationMode);
    if (await hashSkillContent(install.path) !== deployedHash) {
      throw new Error(`Updated Agent copy did not match Library: ${install.path}`);
    }
  }
  for (const install of propagation.linkedInstalls) {
    if (await hashSkillContent(install.path) !== nextContentHash) {
      throw new Error(`Linked Agent Skill did not follow the Library update: ${install.path}`);
    }
  }
  for (const update of propagation.stateUpdates) {
    for (const resource of update.state.managedResources ?? []) {
      const install = propagation.copiedInstalls.find((entry) => resolve(entry.path) === resolve(resource.path));
      if (install?.invocationMode === "manual") {
        resource.contentHash = await hashInvokedSkill(sourceDir, install.invocationTargetId ?? "", "manual");
      }
    }
    await writeAtomic(update.path, `${JSON.stringify(update.state, null, 2)}\n`,
      update.expectedPathHash ? { expectedTargetHash: update.expectedPathHash } : {});
    parseTargetState(JSON.parse(await readFile(update.path, "utf8")));
  }
};
