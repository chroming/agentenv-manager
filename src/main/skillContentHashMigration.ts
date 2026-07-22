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

interface SkillContentHashMigrationOptions {
  onWarning?(message: string): void | Promise<void>;
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

const rewriteTargetStates = async (
  paths: AgentEnvPaths,
  libraryHashes: Map<string, string>,
  warn: (message: string) => Promise<void>
) => {
  for (const statePath of await listJsonFiles(paths.targetStatesDir)) {
    const content = await readFile(statePath, "utf8");
    let state: TargetState;
    try {
      state = parseTargetState(JSON.parse(content));
    } catch (error) {
      await warn(
        `Skipped invalid Target state during Skill hash upgrade: ${statePath}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    const managedResources: NonNullable<TargetState["managedResources"]> = [];
    for (const resource of state.managedResources ?? []) {
      if (resource.kind !== "skill" || !(await pathExists(resource.path))) {
        managedResources.push(resource);
        continue;
      }
      try {
        managedResources.push({ ...resource, contentHash: await hashSkillContent(resource.path) });
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        await warn(
          `Kept the previous hash for managed Skill that disappeared during upgrade ${resource.path}: ${error instanceof Error ? error.message : String(error)}`
        );
        managedResources.push(resource);
      }
    }
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

const rewriteCaptureReceipts = async (
  paths: AgentEnvPaths,
  warn: (message: string) => Promise<void>
) => {
  for (const receiptPath of await listJsonFiles(paths.captureReceiptsDir)) {
    const content = await readFile(receiptPath, "utf8");
    let receipt: { skills?: Array<{ copies?: Array<{ path?: string; contentHash?: string }> }> };
    try {
      receipt = JSON.parse(content) as typeof receipt;
    } catch (error) {
      await warn(
        `Skipped invalid optional Capture receipt during Skill hash upgrade: ${receiptPath}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    if (!receipt?.skills) continue;
    let changed = false;
    for (const skill of receipt.skills) {
      for (const copy of skill.copies ?? []) {
        if (copy.path && await pathExists(copy.path)) {
          try {
            copy.contentHash = await hashSkillContent(copy.path);
            changed = true;
          } catch (error) {
            if (!isMissingFileError(error)) throw error;
            await warn(
              `Kept the previous hash for Capture Skill that disappeared during upgrade ${copy.path}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    }
    if (changed) await writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
};

export const migrateSkillContentHashes = async (
  paths: AgentEnvPaths,
  options: SkillContentHashMigrationOptions = {}
): Promise<boolean> => {
  const marker = await readJsonIfExists<Partial<HashFormatMarker>>(markerPathFor(paths));
  if (marker?.skillContentHashVersion === SKILL_CONTENT_HASH_VERSION) return false;

  const warn = async (message: string) => {
    await options.onWarning?.(message);
  };

  const libraryHashes = await rewriteLibraryHashes(paths);
  await rewriteTargetStates(paths, libraryHashes, warn);
  await rewriteCaptureReceipts(paths, warn);
  const markerValue: HashFormatMarker = { skillContentHashVersion: SKILL_CONTENT_HASH_VERSION };
  await writeAtomic(markerPathFor(paths), `${JSON.stringify(markerValue, null, 2)}\n`);
  return true;
};
