import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  PortableProfileManifestSchema,
  PortableProfileResourcesSchema,
  PortableInstructionMetadataSchema,
  PortableSkillMetadataSchema,
  PortableSkillSourcesSchema,
  PortableSkillGroupsSchema,
  PortableWorkspaceManifestSchema,
  type PortableWorkspaceManifest
} from "./portableSchemas";
import {
  isPortableFileName,
  portableIdentityKey
} from "../../shared/portableNames";
import { toPortableOnlineLocator } from "./portableLocation";
import { hashJson, hashPortableTree, inspectPortableTree, snapshotHashFor } from "./workspaceSnapshotHasher";

const MAX_WORKSPACE_BYTES = 500 * 1024 * 1024;
const MAX_SKILLS = 5_000;
const MAX_PROFILES = 1_000;
const MAX_INSTRUCTIONS = 5_000;

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const assertRegularFile = async (path: string) => {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Portable Workspace file must be a regular file: ${path}`);
  }
};

const assertExactEntries = async (root: string, expected: string[]) => {
  const actual = (await readdir(root)).sort();
  if (actual.join("\0") !== [...expected].sort().join("\0")) {
    throw new Error(
      `Portable Workspace directory has unexpected entries: ${root}. ` +
      `Expected ${[...expected].sort().join(", ")}; found ${actual.join(", ") || "nothing"}`
    );
  }
};

const listRealDirectories = async (root: string): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const names: string[] = [];
  const portableNames = new Set<string>();
  for (const entry of entries) {
    const path = join(root, entry.name);
    const stats = await lstat(path);
    if (!entry.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Portable Workspace entries must be real directories: ${path}`);
    }
    if (!isPortableFileName(entry.name)) {
      throw new Error(
        `Portable Workspace contains an unsupported resource name: ${entry.name}`
      );
    }
    const identity = portableIdentityKey(entry.name);
    if (portableNames.has(identity)) {
      throw new Error(
        `Portable Workspace contains resource names that collide across platforms: ${entry.name}`
      );
    }
    portableNames.add(identity);
    names.push(entry.name);
  }
  return names.sort();
};

const assertPortableOnlineLocator = (value: string | undefined) => {
  if (!value) return;
  if (!toPortableOnlineLocator(value)) {
    throw new Error("Portable Workspace cannot contain a machine-local repository locator");
  }
};

const assertNoHighConfidenceSecret = async (
  root: string,
  limits: { maxFiles?: number; maxBytes?: number } = {}
) => {
  const entries = await inspectPortableTree(root, {
    maxFiles: limits.maxFiles ?? 1_000,
    maxBytes: limits.maxBytes ?? 20 * 1024 * 1024
  });
  for (const entry of entries) {
    if (!/\.(?:md|txt|json|ya?ml|toml|ini|env|sh|js|ts|py)$/i.test(entry.path)) continue;
    const content = await readFile(join(root, ...entry.path.split("/")), "utf8");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) ||
      /\b(?:ghp|github_pat|glpat)-?[A-Za-z0-9_]{20,}\b/.test(content)) {
      throw new Error(`Portable Workspace contains a likely credential: ${entry.path}`);
    }
  }
  return entries;
};

export interface ValidatedPortableWorkspace {
  root: string;
  manifest: PortableWorkspaceManifest;
}

export const validatePortableWorkspace = async (root: string): Promise<ValidatedPortableWorkspace> => {
  await assertRegularFile(join(root, "agentenv-sync.json"));
  const workspaceStats = await lstat(join(root, "workspace"));
  if (!workspaceStats.isDirectory() || workspaceStats.isSymbolicLink()) {
    throw new Error("Portable Workspace payload must be a real directory");
  }
  const manifest = PortableWorkspaceManifestSchema.parse(await readJson(join(root, "agentenv-sync.json")));
  await assertExactEntries(
    join(root, "workspace"),
    [
      "profiles",
      "skills",
      ...(manifest.instructionHashes ? ["instructions"] : []),
      "skill-sources.json",
      ...(manifest.skillGroupsHash ? ["skill-groups.json"] : [])
    ]
  );
  await assertRegularFile(join(root, "workspace", "skill-sources.json"));
  const { snapshotHash: _snapshotHash, ...unsigned } = manifest;
  if (snapshotHashFor(unsigned) !== manifest.snapshotHash) {
    throw new Error("Portable Workspace manifest hash does not match its contents");
  }

  const profilesRoot = join(root, "workspace", "profiles");
  const skillsRoot = join(root, "workspace", "skills");
  const instructionsRoot = join(root, "workspace", "instructions");
  const profileIds = await listRealDirectories(profilesRoot);
  const skillIds = await listRealDirectories(skillsRoot);
  const instructionIds = manifest.instructionHashes
    ? await listRealDirectories(instructionsRoot)
    : [];
  if (
    profileIds.length > MAX_PROFILES ||
    skillIds.length > MAX_SKILLS ||
    instructionIds.length > MAX_INSTRUCTIONS
  ) {
    throw new Error("Portable Workspace contains too many resources");
  }
  if (profileIds.join("\0") !== Object.keys(manifest.profileHashes).sort().join("\0") ||
    skillIds.join("\0") !== Object.keys(manifest.skillHashes).sort().join("\0") ||
    instructionIds.join("\0") !== Object.keys(manifest.instructionHashes ?? {}).sort().join("\0")) {
    throw new Error("Portable Workspace manifest resource list does not match its directories");
  }

  for (const id of profileIds) {
    const rootPath = join(profilesRoot, id);
    await assertExactEntries(rootPath, ["profile.json", "INSTRUCTIONS.md", "resources.json"]);
    await Promise.all([
      assertRegularFile(join(rootPath, "profile.json")),
      assertRegularFile(join(rootPath, "INSTRUCTIONS.md")),
      assertRegularFile(join(rootPath, "resources.json"))
    ]);
    const profile = PortableProfileManifestSchema.parse(await readJson(join(rootPath, "profile.json")));
    const instructions = await readFile(join(rootPath, "INSTRUCTIONS.md"), "utf8");
    const resources = PortableProfileResourcesSchema.parse(await readJson(join(rootPath, "resources.json")));
    if (profile.id !== id) throw new Error(`Portable Profile id does not match its directory: ${id}`);
    const hashes = {
      manifest: hashJson(profile),
      instructions: hashJson(instructions),
      resources: hashJson(resources)
    };
    const expected = manifest.profileHashes[id]!;
    if (hashes.manifest !== expected.manifest || hashes.instructions !== expected.instructions ||
      hashes.resources !== expected.resources || hashJson(hashes) !== expected.total) {
      throw new Error(`Portable Profile hash mismatch: ${id}`);
    }
  }
  const profileEntries = await assertNoHighConfidenceSecret(profilesRoot, {
    maxFiles: 5_000,
    maxBytes: 50 * 1024 * 1024
  });

  const instructionIdsSet = new Set(instructionIds);
  let instructionBytes = 0;
  for (const id of instructionIds) {
    const rootPath = join(instructionsRoot, id);
    await assertExactEntries(rootPath, ["instruction.json", "CONTENT.md"]);
    await Promise.all([
      assertRegularFile(join(rootPath, "instruction.json")),
      assertRegularFile(join(rootPath, "CONTENT.md"))
    ]);
    const metadata = PortableInstructionMetadataSchema.parse(
      await readJson(join(rootPath, "instruction.json"))
    );
    const content = await readFile(join(rootPath, "CONTENT.md"), "utf8");
    if (metadata.id !== id) {
      throw new Error(`Portable Instruction id does not match its directory: ${id}`);
    }
    const expected = manifest.instructionHashes?.[id];
    const hashes = { content: hashJson(content), metadata: hashJson(metadata) };
    if (
      !expected ||
      hashes.content !== expected.content ||
      hashes.metadata !== expected.metadata ||
      hashJson(hashes) !== expected.total
    ) {
      throw new Error(`Portable Instruction hash mismatch: ${id}`);
    }
    instructionBytes += Buffer.byteLength(content, "utf8");
    await assertNoHighConfidenceSecret(rootPath, { maxFiles: 2, maxBytes: 2_100_000 });
  }

  let totalBytes = profileEntries.reduce((sum, entry) => sum + entry.size, 0) + instructionBytes;
  const skillIdsSet = new Set(skillIds);
  for (const id of skillIds) {
    const rootPath = join(skillsRoot, id);
    await assertExactEntries(rootPath, ["content", "metadata.json"]);
    await assertRegularFile(join(rootPath, "metadata.json"));
    const contentStats = await lstat(join(rootPath, "content"));
    if (!contentStats.isDirectory() || contentStats.isSymbolicLink()) {
      throw new Error(`Portable Skill content must be a real directory: ${id}`);
    }
    const metadata = PortableSkillMetadataSchema.parse(await readJson(join(rootPath, "metadata.json")));
    if (metadata.id !== id) throw new Error(`Portable Skill id does not match its directory: ${id}`);
    assertPortableOnlineLocator(metadata.source);
    assertPortableOnlineLocator(metadata.upstream?.locator);
    assertPortableOnlineLocator(metadata.sourceCollection?.repository);
    assertPortableOnlineLocator(metadata.sourceCollection?.canonicalLink);
    if (metadata.sourceType === "local" && (
      metadata.updatePolicy !== "untracked" ||
      metadata.source ||
      metadata.upstream ||
      metadata.sourceCollection
    )) {
      throw new Error(`Portable local Skill metadata contains update tracking: ${id}`);
    }
    const contentRoot = join(rootPath, "content");
    const contentEntries = await inspectPortableTree(contentRoot, { maxFiles: 1_000, maxBytes: 20 * 1024 * 1024 });
    if (!contentEntries.some((entry) => entry.path === "SKILL.md")) {
      throw new Error(`Portable Skill is missing SKILL.md: ${id}`);
    }
    totalBytes += contentEntries.reduce((sum, entry) => sum + entry.size, 0);
    const expected = manifest.skillHashes[id]!;
    const hashes = { content: await hashPortableTree(contentRoot), metadata: hashJson(metadata) };
    if (hashes.content !== expected.content || hashes.metadata !== expected.metadata || hashJson(hashes) !== expected.total) {
      throw new Error(`Portable Skill hash mismatch: ${id}`);
    }
    await assertNoHighConfidenceSecret(contentRoot);
  }
  if (totalBytes > MAX_WORKSPACE_BYTES) throw new Error("Portable Workspace exceeds the total size limit");

  const sourceData = PortableSkillSourcesSchema.parse(await readJson(join(root, "workspace", "skill-sources.json")));
  const sourceIds = new Set<string>();
  for (const source of sourceData.sources) {
    if (sourceIds.has(source.id)) throw new Error(`Duplicate Portable Skill source id: ${source.id}`);
    sourceIds.add(source.id);
    assertPortableOnlineLocator(source.repository);
    assertPortableOnlineLocator(source.canonicalLink);
  }
  if (hashJson(sourceData) !== manifest.sourcesHash) throw new Error("Portable Skill sources hash mismatch");

  if (manifest.skillGroupsHash) {
    await assertRegularFile(join(root, "workspace", "skill-groups.json"));
    const groupData = PortableSkillGroupsSchema.parse(
      await readJson(join(root, "workspace", "skill-groups.json"))
    );
    if (hashJson(groupData) !== manifest.skillGroupsHash) {
      throw new Error("Portable Skill Groups hash mismatch");
    }
    for (const group of groupData.groups) {
      for (const skillId of group.skillIds) {
        if (!skillIdsSet.has(skillId)) {
          throw new Error(`Portable Skill Group ${group.id} references missing Skill ${skillId}`);
        }
      }
    }
  }

  for (const profileId of profileIds) {
    const resources = PortableProfileResourcesSchema.parse(
      await readJson(join(profilesRoot, profileId, "resources.json"))
    );
    for (const skill of resources.skills) {
      if (!skillIdsSet.has(skill.libraryId)) {
        throw new Error(`Portable Profile ${profileId} references missing Skill ${skill.libraryId}`);
      }
    }
    for (const instruction of resources.instructions ?? []) {
      if (!instructionIdsSet.has(instruction.libraryId)) {
        throw new Error(
          `Portable Profile ${profileId} references missing Instruction ${instruction.libraryId}`
        );
      }
    }
  }
  for (const id of skillIds) {
    const metadata = PortableSkillMetadataSchema.parse(await readJson(join(skillsRoot, id, "metadata.json")));
    const sourceId = metadata.sourceCollection?.sourceId;
    if (sourceId && !sourceIds.has(sourceId)) {
      throw new Error(`Portable Skill ${id} references missing source ${sourceId}`);
    }
  }
  return { root, manifest };
};
