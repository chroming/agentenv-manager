import type {
  ResourceIconKey,
  SkillLibraryEntry,
  SkillProvenance,
  SkillSourceCollectionRef,
  SkillSourceType,
  SkillUpdatePolicy,
  SkillUpstream
} from "../shared/types";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { hashSkillContent } from "./skillContentHash";
import { parseSkillFrontmatter } from "./skillFrontmatter";
import { legacySkillSourceCollectionFor } from "./skillSourceLibrary";
import {
  bindSkillSourceCollection,
  type SkillSourceRegistry
} from "./skillSourceRegistry";
import { parseSkillTags } from "../shared/skillTags";

export interface SkillMetadataFile {
  sourceType?: SkillSourceType;
  source?: string;
  remoteRef?: string;
  remotePath?: string;
  remoteRevision?: string;
  updateCheckEnabled?: boolean;
  updatePolicy?: SkillUpdatePolicy;
  globallyEnabled?: boolean;
  iconKey?: ResourceIconKey;
  contentHash?: string;
  contentHashVersion?: number;
  updatedAt?: string;
  upstream?: SkillUpstream;
  provenance?: SkillProvenance;
  sourceCollection?: SkillSourceCollectionRef;
  tags?: string[];
}

export const readSkillLibraryEntry = async (
  id: string,
  skillDir: string,
  sourceRegistry: SkillSourceRegistry
): Promise<SkillLibraryEntry> => {
  const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
  const frontmatter = parseSkillFrontmatter(content);
  let metadata: SkillMetadataFile = {};
  try {
    metadata = JSON.parse(
      await readFile(join(skillDir, ".agentenv-skill.json"), "utf8")
    ) as SkillMetadataFile;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  const contentHash = await hashSkillContent(skillDir);
  const stats = await stat(join(skillDir, "SKILL.md"));
  const tags = parseSkillTags(metadata.tags, { strict: false });
  return {
    id,
    name: frontmatter.name || id,
    description: frontmatter.description,
    version: frontmatter.version,
    versionSource: frontmatter.versionSource,
    iconKey: metadata.iconKey,
    path: skillDir,
    sourceType: metadata.sourceType ?? "local",
    source: metadata.source,
    globallyEnabled: metadata.globallyEnabled !== false,
    updatePolicy: metadata.updatePolicy ??
      (metadata.updateCheckEnabled === true ? "tracked" : metadata.updateCheckEnabled === false
        ? "untracked"
        : metadata.sourceType === "github" || metadata.sourceType === "git" ? "tracked" : "untracked"),
    remoteRef: metadata.remoteRef,
    remoteRevision: metadata.remoteRevision,
    contentHash,
    updatedAt: metadata.updatedAt ?? stats.mtime.toISOString(),
    upstream: metadata.upstream,
    provenance: metadata.provenance,
    sourceCollection: await bindSkillSourceCollection(
      sourceRegistry,
      legacySkillSourceCollectionFor(metadata)
    ),
    ...(tags.length > 0 ? { tags } : {})
  };
};
