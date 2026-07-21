import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEnvPaths } from "../paths";
import type { ProfileStore } from "../profileStore";
import type { SkillLibraryStore } from "../skillLibraryStore";
import { createSkillSourceRegistry } from "../skillSourceRegistry";
import { writeAtomic } from "../fileUtils";
import {
  PortableSkillMetadataSchema,
  type PortableSkillMetadata,
  type PortableWorkspaceManifest
} from "./portableSchemas";
import { canonicalJson, hashJson, hashPortableTree, snapshotHashFor } from "./workspaceSnapshotHasher";

export interface PortableWorkspaceCodec {
  exportSnapshot(destination: string, workspaceId: string): Promise<PortableWorkspaceManifest>;
}

const safeOnlineValue = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  if (value.startsWith("/") || value.startsWith("file:")) return undefined;
  try {
    const url = new URL(value);
    if (url.password || ((url.protocol === "http:" || url.protocol === "https:") && url.username)) {
      throw new Error("Repository URLs cannot contain credentials");
    }
  } catch (error) {
    if (error instanceof TypeError) return value;
    throw error;
  }
  return value;
};

const portableMetadataFor = (skill: Awaited<ReturnType<SkillLibraryStore["listSkills"]>>[number]): PortableSkillMetadata => {
  const source = safeOnlineValue(skill.sourceType === "local" ? undefined : skill.source);
  const upstreamLocator = safeOnlineValue(skill.upstream?.locator);
  const upstream = skill.upstream;
  const collectionRepository = safeOnlineValue(skill.sourceCollection?.repository);
  const collectionLink = safeOnlineValue(skill.sourceCollection?.canonicalLink);
  const portableSource = Boolean(source || upstreamLocator || collectionRepository);
  const portableUpstream = upstream && upstream.kind !== "local" && upstreamLocator
    ? {
        kind: upstream.kind,
        locator: upstreamLocator,
        ref: upstream.ref,
        subpath: upstream.subpath,
        revision: upstream.revision
      }
    : undefined;
  return PortableSkillMetadataSchema.parse({
    formatVersion: 1,
    id: skill.id,
    iconKey: skill.iconKey,
    globallyEnabled: skill.globallyEnabled !== false,
    updatePolicy: portableSource ? skill.updatePolicy : "untracked",
    sourceType: portableSource ? skill.sourceType : "local",
    source,
    remoteRef: skill.remoteRef,
    remoteRevision: skill.remoteRevision,
    upstream: portableUpstream,
    sourceCollection: collectionRepository && collectionLink
      ? { ...skill.sourceCollection!, repository: collectionRepository, canonicalLink: collectionLink }
      : undefined
  });
};

export const createPortableWorkspaceCodec = (input: {
  paths: AgentEnvPaths;
  profileStore: ProfileStore;
  skillLibraryStore: SkillLibraryStore;
}): PortableWorkspaceCodec => ({
  exportSnapshot: async (destination, workspaceId) => {
    await rm(destination, { recursive: true, force: true });
    const profilesRoot = join(destination, "workspace", "profiles");
    const skillsRoot = join(destination, "workspace", "skills");
    await Promise.all([mkdir(profilesRoot, { recursive: true }), mkdir(skillsRoot, { recursive: true })]);

    const profileHashes: PortableWorkspaceManifest["profileHashes"] = {};
    for (const summary of await input.profileStore.listProfiles()) {
      if (summary.loadError) throw new Error(`Cannot sync invalid Profile ${summary.id}: ${summary.loadError}`);
      const profile = await input.profileStore.readProfile(summary.id);
      const root = join(profilesRoot, profile.id);
      await mkdir(root, { recursive: true });
      await Promise.all([
        writeFile(join(root, "profile.json"), canonicalJson(profile.manifest), { mode: 0o600 }),
        writeFile(join(root, "INSTRUCTIONS.md"), profile.instructions, { mode: 0o600 }),
        writeFile(join(root, "resources.json"), canonicalJson(profile.resources), { mode: 0o600 })
      ]);
      const manifest = hashJson(profile.manifest);
      const instructions = hashJson(profile.instructions);
      const resources = hashJson(profile.resources);
      profileHashes[profile.id] = { manifest, instructions, resources, total: hashJson({ manifest, instructions, resources }) };
    }

    const skillHashes: PortableWorkspaceManifest["skillHashes"] = {};
    for (const skill of await input.skillLibraryStore.listSkills()) {
      const root = join(skillsRoot, skill.id);
      const contentRoot = join(root, "content");
      await mkdir(root, { recursive: true });
      await cp(skill.path, contentRoot, {
        recursive: true,
        filter: (path) => ![".git", ".agentenv-owner.json", ".agentenv-skill.json"].includes(path.split(/[\\/]/).at(-1) ?? "")
      });
      const metadata = portableMetadataFor(skill);
      await writeFile(join(root, "metadata.json"), canonicalJson(metadata), { mode: 0o600 });
      const content = await hashPortableTree(contentRoot);
      const metadataHash = hashJson(metadata);
      skillHashes[skill.id] = { content, metadata: metadataHash, total: hashJson({ content, metadata: metadataHash }) };
    }

    const sourceRegistry = createSkillSourceRegistry(input.paths.skillSourcesPath);
    const sourceData = {
      formatVersion: 1 as const,
      sources: (await sourceRegistry.list())
        .filter((source) => safeOnlineValue(source.repository) && safeOnlineValue(source.canonicalLink))
        .map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...source }) => source)
    };
    await writeFile(join(destination, "workspace", "skill-sources.json"), canonicalJson(sourceData), { mode: 0o600 });
    const sourcesHash = hashJson(sourceData);
    const unsigned = { formatVersion: 1 as const, workspaceId, profileHashes, skillHashes, sourcesHash };
    const manifest: PortableWorkspaceManifest = { ...unsigned, snapshotHash: snapshotHashFor(unsigned) };
    await writeAtomic(join(destination, "agentenv-sync.json"), canonicalJson(manifest));
    return manifest;
  }
});
