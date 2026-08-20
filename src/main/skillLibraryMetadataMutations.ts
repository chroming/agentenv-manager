import { join } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import {
  canonicalizeSkillTags,
  collectSkillTags,
  parseSkillTags,
  skillTagKey
} from "../shared/skillTags";
import type {
  ResourceIconKey,
  SkillIconInput,
  SkillLibraryEntry,
  SkillSourceCollectionRef,
  SkillTagsInput
} from "../shared/types";
import { pathExists } from "./fileUtils";
import type { SkillMetadataFile } from "./skillLibraryMetadata";

export type SkillMetadataWriteInput = Pick<
  SkillMetadataFile,
  | "sourceType"
  | "source"
  | "remoteRef"
  | "remotePath"
  | "remoteRevision"
  | "updatePolicy"
  | "updateCheckEnabled"
  | "globallyEnabled"
  | "upstream"
  | "provenance"
  | "tags"
> & {
  iconKey?: ResourceIconKey | null;
  sourceCollection?: SkillSourceCollectionRef | null;
};

interface SkillLibraryMetadataMutationDependencies {
  entryFor(id: string, skillDir: string): Promise<SkillLibraryEntry>;
  libraryDir(): Promise<string>;
  listSkills(): Promise<SkillLibraryEntry[]>;
  readMetadata(skillDir: string): Promise<SkillMetadataFile>;
  updatePolicyFor(metadata: SkillMetadataFile): NonNullable<SkillMetadataFile["updatePolicy"]>;
  writeMetadata(skillDir: string, metadata: SkillMetadataWriteInput): Promise<void>;
}

const metadataBase = (
  metadata: SkillMetadataFile,
  updatePolicyFor: SkillLibraryMetadataMutationDependencies["updatePolicyFor"]
): SkillMetadataWriteInput => ({
  sourceType: metadata.sourceType ?? "local",
  source: metadata.source,
  remoteRef: metadata.remoteRef,
  remotePath: metadata.remotePath,
  remoteRevision: metadata.remoteRevision,
  updatePolicy: updatePolicyFor(metadata)
});

export const createSkillLibraryMetadataMutations = (
  dependencies: SkillLibraryMetadataMutationDependencies
) => {
  const targetFor = async (id: string) => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await dependencies.libraryDir(), safeId);
    if (!(await pathExists(join(targetDir, "SKILL.md")))) {
      throw new Error(`Library skill does not exist: ${safeId}`);
    }
    return { safeId, targetDir };
  };

  const setIcon = async ({ id, iconKey }: SkillIconInput): Promise<SkillLibraryEntry> => {
    const { safeId, targetDir } = await targetFor(id);
    const metadata = await dependencies.readMetadata(targetDir);
    await dependencies.writeMetadata(targetDir, {
      ...metadataBase(metadata, dependencies.updatePolicyFor),
      iconKey: iconKey ?? null
    });
    return dependencies.entryFor(safeId, targetDir);
  };

  const setTags = async ({ id, tags }: SkillTagsInput): Promise<SkillLibraryEntry> => {
    const { safeId, targetDir } = await targetFor(id);
    const skills = await dependencies.listSkills();
    const nextTags = canonicalizeSkillTags(tags, collectSkillTags(skills));
    const metadata = await dependencies.readMetadata(targetDir);
    const currentTags = parseSkillTags(metadata.tags, { strict: false });
    const unchanged =
      currentTags.length === nextTags.length &&
      currentTags.every((tag, index) => skillTagKey(tag) === skillTagKey(nextTags[index]));
    if (unchanged) return dependencies.entryFor(safeId, targetDir);

    await dependencies.writeMetadata(targetDir, {
      ...metadataBase(metadata, dependencies.updatePolicyFor),
      tags: nextTags
    });
    return dependencies.entryFor(safeId, targetDir);
  };

  return { setIcon, setTags };
};
