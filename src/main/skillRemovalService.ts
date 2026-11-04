import { randomUUID } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type { SkillRemovalPreview, TargetPaths } from "../shared/types";
import type { AgentEnvPaths } from "./paths";
import type { SkillLibraryStore } from "./skillLibraryStoreTypes";
import type { SkillGroupStore } from "./skillGroupStore";
import { isMissingFileError, pathEntryExists } from "./fileUtils";
import { hashPathEntry } from "./filesystemIntegrity";
import { markerPathForFile } from "./ownershipMarkers";
import { isPathInside } from "./platformPaths";
import { resolveSkillsLibraryDir } from "./settingsStore";
import type { SettingsStore } from "./settingsStore";
import { createTargetStateRepository } from "./targetStateRepository";
import { createSharedSkillAreaStore } from "./sharedSkillAreaStore";
import { legacyOwnedLibraryId } from "./skillLegacyOwnershipMigration";
import { applyProfileSkillRemoval, readProfileSkillRemovalReferences } from "./profileSkillRemoval";

export const createSkillRemovalService = ({ paths, settingsStore, skillGroupStore, skillLibraryStore, targetPaths }: {
  paths: AgentEnvPaths; settingsStore: SettingsStore; skillGroupStore: SkillGroupStore;
  skillLibraryStore: SkillLibraryStore; targetPaths(): Promise<TargetPaths[]>;
}) => {
  const states = createTargetStateRepository(paths), shared = createSharedSkillAreaStore(paths);
  const readPlan = async (id: string) => {
    const skillId = SafeIdSchema.parse(id), libraryPath = join(resolveSkillsLibraryDir(paths, await settingsStore.readSettings()), skillId);
    if (!await pathEntryExists(join(libraryPath, "SKILL.md"))) throw new Error(`Library skill does not exist: ${skillId}`);
    const profiles = await readProfileSkillRemovalReferences(paths.profilesDir, skillId);
    const groupsHash = await hashPathEntry(paths.skillGroupsPath);
    const groups = await skillGroupStore.list(), affectedGroups = groups.filter((group) => group.skillIds.includes(skillId));
    const targets = await targetPaths(), stateFiles = await Promise.all(targets.map(async (target) => ({
      target, file: await states.read(target.targetId)
    })));
    const sharedHash = await hashPathEntry(shared.path), sharedState = await shared.read();
    const installs = new Map<string, Set<string>>();
    const add = async (path: string, targetId: string, roots: string[]) => {
      const absolute = resolve(path);
      if (absolute === resolve(libraryPath)) return;
      if (!roots.some((root) => isPathInside(root, absolute))) throw new Error(`Managed Skill is outside declared Agent paths: ${path}`);
      if (!await pathEntryExists(absolute)) return;
      // Root aliases are supported, but parent redirection below a root is not.
      const root = roots.find((root) => isPathInside(root, absolute))!;
      const parent = await realpath(dirname(absolute)), resolvedRoot = await realpath(root);
      if (parent !== resolvedRoot && !isPathInside(resolvedRoot, parent)) throw new Error(`Managed Skill parent changed: ${path}`);
      const ids = installs.get(absolute) ?? new Set<string>(); ids.add(targetId); installs.set(absolute, ids);
    };
    for (const { target, file } of stateFiles) {
      const roots = [...new Set([target.skillsDir, ...(target.skillScanDirs ?? []),
        ...(target.skillLocations ?? []).filter((location) => location.role !== "discovery-only").map((location) => location.path)]
        .filter((path): path is string => Boolean(path)))];
      for (const resource of file.state.managedResources ?? []) {
        if (resource.kind === "skill" && resource.source === `skills-library/${skillId}`) await add(resource.path, target.targetId, roots);
      }
      // Legacy ownership is checked only in declared runtime roots, never by starting a CLI.
      for (const root of roots) {
        const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
          if (isMissingFileError(error)) return []; throw error;
        });
        for (const entry of entries) {
          if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith(".")) continue;
          const path = join(root, entry.name);
          if (await legacyOwnedLibraryId(path) === skillId) await add(path, target.targetId, roots);
        }
      }
    }
    for (const receipt of sharedState.receipts.filter((receipt) => receipt.libraryId === skillId)) {
      await add(receipt.path, "shared", [paths.userSkillsDir]);
    }
    const affectedStates = stateFiles.filter(({ file }) =>
      file.state.managedResources?.some((resource) => resource.kind === "skill" && (resource.source === `skills-library/${skillId}` || installs.has(resolve(resource.path)))) ||
      file.state.skillReceipts?.some((receipt) => receipt.libraryId === skillId));
    const affectedPaths = [...new Set([libraryPath, ...profiles.map((profile) => profile.path),
      ...(affectedGroups.length ? [paths.skillGroupsPath] : []), ...affectedStates.map(({ file }) => file.path),
      ...(sharedState.receipts.some((receipt) => receipt.libraryId === skillId) ? [shared.path] : []),
      ...[...installs.keys()].flatMap((path) => [path, markerPathForFile(path)])])].sort();
    const expectedPaths = await Promise.all(affectedPaths.map(async (path) => ({ path, sha256: await hashPathEntry(path) })));
    for (const profile of profiles) {
      if (expectedPaths.find((entry) => entry.path === profile.path)?.sha256 !== profile.sha256) throw new Error("Profile references changed. Review removal again.");
    }
    if (affectedGroups.length && expectedPaths.find((entry) => entry.path === paths.skillGroupsPath)?.sha256 !== groupsHash) throw new Error("Skill Groups changed. Review removal again.");
    for (const { file } of affectedStates) {
      if (expectedPaths.find((entry) => entry.path === file.path)?.sha256 !== file.pathHash) throw new Error("Agent management changed. Review removal again.");
    }
    if (sharedState.receipts.some((receipt) => receipt.libraryId === skillId) && expectedPaths.find((entry) => entry.path === shared.path)?.sha256 !== sharedHash) throw new Error("Shared Skill management changed. Review removal again.");
    return { skillId, libraryPath, profiles, groups, affectedGroups, installs, affectedStates, sharedState, affectedPaths, expectedPaths };
  };
  type Plan = Awaited<ReturnType<typeof readPlan>>;
  const pending = new Map<string, { plan: Plan; expiresAt: number }>();
  const read = (id: string) => {
    const result = pending.get(id);
    if (!result || result.expiresAt < Date.now()) throw new Error("Skill removal preview expired. Review removal again.");
    return result.plan;
  };
  const preview = async (id: string): Promise<SkillRemovalPreview> => {
    const plan = await readPlan(id), previewId = randomUUID();
    for (const [key, value] of pending) if (value.expiresAt < Date.now()) pending.delete(key);
    pending.set(previewId, { plan, expiresAt: Date.now() + 30 * 60_000 });
    return { previewId, libraryId: plan.skillId, libraryPath: plan.libraryPath,
      profiles: plan.profiles.map(({ id, name }) => ({ id, name })),
      groups: plan.affectedGroups.map(({ id, name }) => ({ id, name })),
      sharedPaths: [plan.libraryPath, ...plan.installs.keys()].filter((path) => isPathInside(paths.userSkillsDir, path)),
      installs: [...plan.installs].map(([path, targetIds]) => ({ path, targetIds: [...targetIds] })) };
  };
  const remove = async (id: string, previewId: string) => {
    const plan = read(previewId);
    if (plan.skillId !== SafeIdSchema.parse(id)) throw new Error("Skill removal preview belongs to another Skill");
    const current = await readPlan(id);
    if (JSON.stringify(current.expectedPaths) !== JSON.stringify(plan.expectedPaths)) {
      throw new Error("Skill removal changed after preview. Review removal again.");
    }
    pending.delete(previewId);
    return skillLibraryStore.removeSkill(id, [...plan.installs.keys()], {
      paths: plan.affectedPaths.filter((path) => path !== plan.libraryPath), expectedPaths: plan.expectedPaths,
      validate: async () => {
        if (JSON.stringify((await readPlan(id)).expectedPaths) !== JSON.stringify(plan.expectedPaths)) throw new Error("Skill removal changed after preview. Review removal again.");
      },
      apply: async (claim) => {
        for (const profile of plan.profiles) {
          await claim(profile.path); await applyProfileSkillRemoval(profile); await claim.recordMutation(profile.path);
        }
        if (plan.affectedGroups.length) {
          await claim(paths.skillGroupsPath);
          await skillGroupStore.replace(plan.groups.map((group) => group.skillIds.includes(id)
            ? { ...group, skillIds: group.skillIds.filter((member) => member !== id), updatedAt: new Date().toISOString() } : group),
          { expectedPathHash: plan.expectedPaths.find((entry) => entry.path === paths.skillGroupsPath)?.sha256 });
          await claim.recordMutation(paths.skillGroupsPath);
        }
        for (const { target, file } of plan.affectedStates) {
          const versions = { ...file.state.appliedLibraryVersions?.skills }; delete versions[id];
          await claim(file.path);
          await states.write(target.targetId, { ...file.state,
            managedResources: file.state.managedResources?.filter((resource) => resource.kind !== "skill" || (resource.source !== `skills-library/${id}` && !plan.installs.has(resolve(resource.path)))),
            skillReceipts: file.state.skillReceipts?.filter((receipt) => receipt.libraryId !== id),
            ...(file.state.appliedLibraryVersions ? { appliedLibraryVersions: { ...file.state.appliedLibraryVersions, skills: versions } } : {})
          }, { expectedPathHash: file.pathHash });
          await claim.recordMutation(file.path);
        }
        if (plan.sharedState.receipts.some((receipt) => receipt.libraryId === id)) {
          await claim(shared.path); await shared.removeManaged(plan.sharedState.receipts.filter((receipt) => receipt.libraryId === id).map((receipt) => receipt.path), {
            expectedPathHash: plan.expectedPaths.find((entry) => entry.path === shared.path)?.sha256
          });
          await claim.recordMutation(shared.path);
        }
      }
    });
  };
  return { preview, remove, mutationPaths: (previewId: string) => read(previewId).affectedPaths };
};
