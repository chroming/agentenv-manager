import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseSkillTags, splitSkillTags } from "../shared/skillTags";
import { pathEntryExists, writeAtomic } from "./fileUtils";
import { hashPathEntry } from "./filesystemIntegrity";
import { hashSkillContent as computeContentHash, SKILL_CONTENT_HASH_VERSION } from "./skillContentHash";
import type { SkillMetadataFile } from "./skillLibraryMetadata";
import type { SkillMetadataWriteInput } from "./skillLibraryMetadataMutations";
import { bindSkillSourceCollection, type SkillSourceRegistry } from "./skillSourceRegistry";
import { resolveSkillSourceCollection } from "./skillSourceLibrary";

export const createSkillMetadataWriter = ({
  readLibraryMetadata, skillSourceRegistry, updatePolicyFor
}: {
  readLibraryMetadata(skillDir: string): Promise<SkillMetadataFile>;
  skillSourceRegistry: SkillSourceRegistry;
  updatePolicyFor(metadata: SkillMetadataFile): NonNullable<SkillMetadataFile["updatePolicy"]>;
}) => {
  const writeMetadata = async (
    skillDir: string,
    metadata: SkillMetadataWriteInput
  ) => {
    if ((await lstat(skillDir)).isSymbolicLink()) throw new Error(`Library directory is a link. Import an independent copy before changing metadata: ${skillDir}`);
    const metadataPath = join(skillDir, ".agentenv-skill.json");
    if (await pathEntryExists(metadataPath) && (await lstat(metadataPath)).isSymbolicLink()) {
      throw new Error(`Skill metadata is a link and was not modified: ${metadataPath}`);
    }
    const expectedMetadataHash = await hashPathEntry(metadataPath);
    const current = await readLibraryMetadata(skillDir);
    const sourceType = metadata.sourceType ?? "local";
    const contentHash = await computeContentHash(skillDir);
    const sourceCollection = await bindSkillSourceCollection(
      skillSourceRegistry,
      resolveSkillSourceCollection(metadata.sourceCollection, current.sourceCollection)
    );
    const tags = metadata.tags === undefined
      ? parseSkillTags(current.tags, { strict: false })
      : parseSkillTags(metadata.tags);
    const next = {
      ...current,
      sourceType,
      source: metadata.source,
      remoteRef: metadata.remoteRef,
      remotePath: metadata.remotePath,
      remoteRevision: metadata.remoteRevision,
      upstream: metadata.upstream ?? current.upstream,
      provenance: metadata.provenance ?? current.provenance,
      sourceCollection,
      iconKey: metadata.iconKey === null ? undefined : metadata.iconKey ?? current.iconKey,
      globallyEnabled: metadata.globallyEnabled ?? current.globallyEnabled ?? true,
      tags: tags.length > 0 ? tags : undefined,
      aiTags: splitSkillTags({ tags, aiTags: metadata.aiTags ?? current.aiTags }).ai,
      updatePolicy:
        metadata.updatePolicy ??
        (typeof metadata.updateCheckEnabled === "boolean"
          ? metadata.updateCheckEnabled
            ? "tracked"
            : "untracked"
          : Object.keys(current).length > 0
            ? updatePolicyFor(current)
            : sourceType === "github" || sourceType === "git"
              ? "tracked"
              : "untracked"),
      updateCheckEnabled:
        (metadata.updatePolicy ??
          (typeof metadata.updateCheckEnabled === "boolean"
            ? metadata.updateCheckEnabled
              ? "tracked"
              : "untracked"
            : Object.keys(current).length > 0
              ? updatePolicyFor(current)
              : sourceType === "github" || sourceType === "git"
                ? "tracked"
                : "untracked")) === "tracked",
      contentHash,
      contentHashVersion: SKILL_CONTENT_HASH_VERSION,
      updatedAt: current.updatedAt
    };
    const { updatedAt: _currentTime, ...currentContent } = current;
    const { updatedAt: _nextTime, ...nextContent } = next;
    if (isDeepStrictEqual(currentContent, JSON.parse(JSON.stringify(nextContent)))) return;
    await writeAtomic(metadataPath, `${JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      { expectedTargetHash: expectedMetadataHash });
  };

  return writeMetadata;
};

