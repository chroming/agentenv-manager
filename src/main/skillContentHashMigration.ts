import { readdir, readFile, stat, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { TargetState } from "../shared/types";
import { isMissingFileError, pathExists, pathEntryExists, writeAtomic } from "./fileUtils";
import { isPathInside } from "./platformPaths";
import type { AgentEnvPaths } from "./paths";
import { hashSkillContent, SKILL_CONTENT_HASH_VERSION } from "./skillContentHash";
import type { SkillMetadataFile } from "./skillLibraryMetadata";
import { parseTargetState } from "./targetState";
import { hashFileContent, hashPathEntry } from "./filesystemIntegrity";

interface HashFormatMarker {
  skillContentHashVersion: typeof SKILL_CONTENT_HASH_VERSION;
  pendingPaths?: string[];
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

const rewriteLibraryHashes = async (paths: AgentEnvPaths, incomplete: (path: string, error: unknown) => Promise<void>, shouldProcess: (path: string) => boolean) => {
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
    if (!shouldProcess(skillDir)) continue;
    try {
      if (!(await pathExists(join(skillDir, "SKILL.md")))) continue;
      const contentHash = await hashSkillContent(skillDir);
      const metadataPath = join(skillDir, ".agentenv-skill.json");
      if (await pathEntryExists(metadataPath) && (await lstat(metadataPath)).isSymbolicLink()) throw new Error("Skill metadata is a link and was not modified");
      const expectedMetadataHash = await hashPathEntry(metadataPath);
      const storedMetadata = await readJsonIfExists<SkillMetadataFile>(metadataPath);
      if (storedMetadata !== undefined && (!storedMetadata || typeof storedMetadata !== "object" || Array.isArray(storedMetadata))) {
        throw new Error("Invalid Skill metadata");
      }
      const metadata = storedMetadata ?? {};
      hashes.set(entry.name, contentHash);
      if (metadata.contentHash === contentHash && metadata.contentHashVersion === SKILL_CONTENT_HASH_VERSION) continue;
      await writeAtomic(
        metadataPath,
        `${JSON.stringify({ ...metadata, contentHash, contentHashVersion: SKILL_CONTENT_HASH_VERSION }, null, 2)}\n`,
        { expectedTargetHash: expectedMetadataHash }
      );
    } catch (error) {
      await incomplete(skillDir, error);
    }
  }
  return hashes;
};

const rewriteTargetStates = async (
  paths: AgentEnvPaths,
  libraryHashes: Map<string, string>,
  warn: (message: string) => Promise<void>,
  incomplete: (path: string, error: unknown) => Promise<void>,
  shouldProcess: (path: string) => boolean
) => {
  for (const statePath of await listJsonFiles(paths.targetStatesDir)) {
    try {
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
        if (!shouldProcess(statePath) && !shouldProcess(resource.path)) {
          managedResources.push(resource);
          continue;
        }
        if (resource.kind !== "skill") {
          managedResources.push(resource);
          continue;
        }
        if (resource.path.endsWith(".agentenv-owner.json")) {
          await warn(
            `Removed legacy ownership sidecar from managed Skill state without changing the file: ${resource.path}`
          );
          continue;
        }
        if (!(await pathExists(resource.path))) {
          managedResources.push(resource);
          continue;
        }
        let resourceStats;
        try {
          resourceStats = await stat(resource.path);
        } catch (error) {
          if (!isMissingFileError(error)) await incomplete(resource.path, error);
          managedResources.push(resource);
          continue;
        }
        if (!resourceStats.isDirectory()) {
          await warn(
            `Kept a legacy managed Skill record whose path is not a directory: ${resource.path}`
          );
          managedResources.push(resource);
          continue;
        }
        try {
          managedResources.push({ ...resource, contentHash: await hashSkillContent(resource.path) });
        } catch (error) {
          if (!isMissingFileError(error)) await incomplete(resource.path, error);
          await warn(
            `Kept the previous hash for managed Skill that disappeared during upgrade ${resource.path}: ${error instanceof Error ? error.message : String(error)}`
          );
          managedResources.push(resource);
        }
      }
      const appliedSkills = Object.fromEntries(
        Object.entries(state.appliedLibraryVersions?.skills ?? {}).map(([id, hash]) => [
          id,
          shouldProcess(statePath) ? libraryHashes.get(id) ?? hash : hash
        ])
      );
      const next: TargetState = {
        ...state,
        managedResources,
        ...(state.appliedLibraryVersions
          ? { appliedLibraryVersions: { skills: appliedSkills } }
          : {})
      };
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        await writeAtomic(statePath, `${JSON.stringify(next, null, 2)}\n`, { expectedTargetHash: hashFileContent(content) });
      }
    } catch (error) { await incomplete(statePath, error); }
  }
};

const rewriteCaptureReceipts = async (
  paths: AgentEnvPaths,
  warn: (message: string) => Promise<void>,
  incomplete: (path: string, error: unknown) => Promise<void>,
  shouldProcess: (path: string) => boolean
) => {
  for (const receiptPath of await listJsonFiles(paths.captureReceiptsDir)) {
    try {
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
          if (!shouldProcess(receiptPath) && (!copy.path || !shouldProcess(copy.path))) continue;
          if (copy.path && await pathExists(copy.path)) {
            let copyStats;
            try {
              copyStats = await stat(copy.path);
            } catch (error) {
              if (!isMissingFileError(error)) await incomplete(copy.path, error);
              continue;
            }
            if (!copyStats.isDirectory()) {
              await warn(
                `Kept a Capture Skill hash whose path is not a directory: ${copy.path}`
              );
              continue;
            }
            try {
              const hash = await hashSkillContent(copy.path);
              if (copy.contentHash !== hash) { copy.contentHash = hash; changed = true; }
            } catch (error) {
              if (!isMissingFileError(error)) await incomplete(copy.path, error);
              await warn(
                `Kept the previous hash for Capture Skill that disappeared during upgrade ${copy.path}: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
        }
      }
      if (changed) await writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { expectedTargetHash: hashFileContent(content) });
    } catch (error) { await incomplete(receiptPath, error); }
  }
};

export const migrateSkillContentHashes = async (
  paths: AgentEnvPaths,
  options: SkillContentHashMigrationOptions = {}
): Promise<boolean> => {
  const marker = await readJsonIfExists<Partial<HashFormatMarker>>(markerPathFor(paths));
  if (marker?.skillContentHashVersion === SKILL_CONTENT_HASH_VERSION && !marker.pendingPaths?.length) return false;

  const warn = async (message: string) => {
    await options.onWarning?.(message);
  };

  const pending = new Set<string>();
  // A failed neighbor must not cause already-migrated receipts to adopt later external edits.
  const shouldProcess = (path: string) => !marker?.pendingPaths?.length ||
    marker.pendingPaths.some((pendingPath) => isPathInside(pendingPath, path, { allowRoot: true }));
  const incomplete = async (path: string, error: unknown) => {
    pending.add(path);
    await warn(`Kept unreadable Skill data for a later hash upgrade: ${path}: ${error instanceof Error ? error.message : String(error)}`);
  };
  const libraryHashes = await rewriteLibraryHashes(paths, incomplete, shouldProcess).catch(async (error) => {
    await incomplete(paths.skillsLibraryDir, error);
    return new Map<string, string>();
  });
  await rewriteTargetStates(paths, libraryHashes, warn, incomplete, shouldProcess).catch((error) => incomplete(paths.targetStatesDir, error));
  await rewriteCaptureReceipts(paths, warn, incomplete, shouldProcess).catch((error) => incomplete(paths.captureReceiptsDir, error));
  const markerValue: HashFormatMarker = {
    skillContentHashVersion: SKILL_CONTENT_HASH_VERSION,
    ...(pending.size ? { pendingPaths: [...pending].sort() } : {})
  };
  await writeAtomic(markerPathFor(paths), `${JSON.stringify(markerValue, null, 2)}\n`);
  return true;
};
