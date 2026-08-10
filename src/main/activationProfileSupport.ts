import { createHash } from "node:crypto";
import { appendFile, lstat, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathExists } from "./fileUtils";
import { hashManagedResourcePath } from "./managedResourceHashes";
import type { AgentEnvPaths } from "./paths";
import type { ProfileStore } from "./profileStore";
import { profileUsesResource } from "../shared/profileResources";
import type {
  EffectiveProfilePayload,
  ProfileDetail,
  SkillLibraryEntry,
  TargetPaths,
  TargetState
} from "../shared/types";

export const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

export const hashComparablePath = async (path: string): Promise<string | undefined> => {
  if (!(await pathExists(path))) return undefined;

  const hash = createHash("sha256");
  const walk = async (currentPath: string, relativePath: string) => {
    const stats = await stat(currentPath);
    if (stats.isDirectory()) {
      hash.update(`directory:${relativePath}`);
      const entries = await readdir(currentPath, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.name === ".agentenv-owner.json" || entry.name === ".agentenv-skill.json") continue;
        await walk(join(currentPath, entry.name), join(relativePath, entry.name));
      }
      return;
    }
    hash.update(`file:${relativePath}`);
    hash.update(await readFile(currentPath));
  };

  await walk(path, ".");
  return hash.digest("hex");
};

export const appendActivationHistory = async (
  paths: AgentEnvPaths,
  event: Record<string, unknown>
) => {
  await mkdir(paths.appDataRoot, { recursive: true, mode: 0o700 });
  await appendFile(
    paths.activationHistoryPath,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    "utf8"
  );
};

export const applyLibrarySkillAvailability = (
  profile: ProfileDetail,
  skillLibrary: readonly SkillLibraryEntry[]
): ProfileDetail => {
  const disabledIds = new Set(
    skillLibrary.filter((skill) => skill.globallyEnabled === false).map((skill) => skill.id)
  );
  if (disabledIds.size === 0) return profile;
  return {
    ...profile,
    resources: {
      ...profile.resources,
      skills: profile.resources.skills.filter(
        (reference) => !disabledIds.has(reference.libraryId)
      )
    }
  };
};

export const effectiveAppliedLibraryVersions = async ({
  profile,
  targetPaths,
  skillLibrary,
  state
}: {
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  skillLibrary: readonly SkillLibraryEntry[];
  state: TargetState;
}) => {
  const skills = { ...(state.appliedLibraryVersions?.skills ?? {}) };
  if (
    !targetPaths.skillsDir ||
    !profileUsesResource(profile.resources, targetPaths.targetId, "skills")
  ) {
    return { skills };
  }

  const activeManagedPaths = new Set(
    (state.managedResources ?? [])
      .filter((resource) => resource.kind === "skill" && !resource.paused)
      .map((resource) => resolve(resource.path))
  );
  const libraryById = new Map(skillLibrary.map((skill) => [skill.id, skill]));
  for (const reference of profile.resources.skills) {
    const librarySkill = libraryById.get(reference.libraryId);
    if (!reference.enabled || !librarySkill || librarySkill.globallyEnabled === false) continue;
    const targetPath = resolve(join(targetPaths.skillsDir, reference.targetName));
    if (!activeManagedPaths.has(targetPath)) continue;
    const stats = await lstat(targetPath).catch(() => undefined);
    if (!stats?.isSymbolicLink()) continue;
    if (await hashManagedResourcePath(targetPath, "skill") === librarySkill.contentHash) {
      skills[reference.libraryId] = librarySkill.contentHash;
    }
  }
  return { skills };
};

export const effectivePayloadFor = (
  profile: Awaited<ReturnType<ProfileStore["readProfile"]>>,
  targetId: string,
  mcpActivationSupported: boolean
): EffectiveProfilePayload => {
  const instructions = profileUsesResource(profile.resources, targetId, "instructions") ? 1 : 0;
  const skills = profileUsesResource(profile.resources, targetId, "skills")
    ? profile.resources.skills.filter((reference) => reference.enabled).length
    : 0;
  const policy = profile.resources.mcpByTarget[targetId];
  const mcpServers = mcpActivationSupported && policy?.mode === "manage"
    ? policy.selections.length
    : 0;
  return {
    instructions,
    skills,
    mcpServers,
    total: instructions + skills + mcpServers
  };
};
