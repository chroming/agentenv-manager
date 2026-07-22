import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TargetState } from "../shared/types";
import { isMissingFileError, pathExists, writeAtomic } from "./fileUtils";
import type { AgentEnvPaths } from "./paths";
import { hashSkillContent, SKILL_CONTENT_HASH_VERSION } from "./skillContentHash";
import type { SkillMetadataFile } from "./skillLibraryMetadata";
import { parseTargetState } from "./targetState";

interface HashFormatMarker {
  skillContentHashVersion: typeof SKILL_CONTENT_HASH_VERSION;
}

const markerPathFor = (paths: AgentEnvPaths) => join(paths.appDataRoot, "content-hash-format.json");

const readJsonIfExists = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
};

const listJsonFiles = async (directory: string) => {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(directory, entry.name));
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
};

const rewriteLibraryHashes = async (paths: AgentEnvPaths) => {
  let entries;
  try {
    entries = await readdir(paths.skillsLibraryDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return new Map<string, string>();
    throw error;
  }
  const hashes = new Map<string, string>();
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const skillDir = join(paths.skillsLibraryDir, entry.name);
    if (!(await pathExists(join(skillDir, "SKILL.md")))) continue;
    const contentHash = await hashSkillContent(skillDir);
    hashes.set(entry.name, contentHash);
    const metadataPath = join(skillDir, ".agentenv-skill.json");
    const metadata = (await readJsonIfExists<SkillMetadataFile>(metadataPath)) ?? {};
    await writeAtomic(
      metadataPath,
      `${JSON.stringify({ ...metadata, contentHash, contentHashVersion: SKILL_CONTENT_HASH_VERSION }, null, 2)}\n`
    );
  }
  return hashes;
};

const rewriteTargetStates = async (paths: AgentEnvPaths, libraryHashes: Map<string, string>) => {
  for (const statePath of await listJsonFiles(paths.targetStatesDir)) {
    const state = parseTargetState(JSON.parse(await readFile(statePath, "utf8")));
    const managedResources = await Promise.all((state.managedResources ?? []).map(async (resource) => {
      if (resource.kind !== "skill" || !(await pathExists(resource.path))) return resource;
      return { ...resource, contentHash: await hashSkillContent(resource.path) };
    }));
    const appliedSkills = Object.fromEntries(
      Object.entries(state.appliedLibraryVersions?.skills ?? {}).map(([id, hash]) => [
        id,
        libraryHashes.get(id) ?? hash
      ])
    );
    const next: TargetState = {
      ...state,
      managedResources,
      ...(state.appliedLibraryVersions
        ? { appliedLibraryVersions: { skills: appliedSkills } }
        : {})
    };
    await writeAtomic(statePath, `${JSON.stringify(next, null, 2)}\n`);
  }
};

const rewriteCaptureReceipts = async (paths: AgentEnvPaths) => {
  for (const receiptPath of await listJsonFiles(paths.captureReceiptsDir)) {
    const receipt = await readJsonIfExists<{
      skills?: Array<{ copies?: Array<{ path?: string; contentHash?: string }> }>;
    }>(receiptPath);
    if (!receipt?.skills) continue;
    for (const skill of receipt.skills) {
      for (const copy of skill.copies ?? []) {
        if (copy.path && await pathExists(copy.path)) {
          copy.contentHash = await hashSkillContent(copy.path);
        }
      }
    }
    await writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
};

export const migrateSkillContentHashes = async (paths: AgentEnvPaths): Promise<boolean> => {
  const marker = await readJsonIfExists<Partial<HashFormatMarker>>(markerPathFor(paths));
  if (marker?.skillContentHashVersion === SKILL_CONTENT_HASH_VERSION) return false;

  const libraryHashes = await rewriteLibraryHashes(paths);
  await rewriteTargetStates(paths, libraryHashes);
  await rewriteCaptureReceipts(paths);
  const markerValue: HashFormatMarker = { skillContentHashVersion: SKILL_CONTENT_HASH_VERSION };
  await writeAtomic(markerPathFor(paths), `${JSON.stringify(markerValue, null, 2)}\n`);
  return true;
};
