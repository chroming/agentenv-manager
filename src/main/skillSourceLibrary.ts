import type {
  RepositorySkillScanResult,
  RepositorySkillImportInput,
  GitHubSkillImportInput,
  GitHubSkillCandidateStatus,
  SkillLibraryEntry,
  SkillSourceCollectionRef,
  SkillSourceGroupView,
  SkillSourceType,
  SkillUpstream
} from "../shared/types";
import type { SkillSourceRegistry } from "./skillSourceRegistry";
import type { SkillSourceService } from "./skillSourceService";
import type { GitCliSkillSource, MaterializedGitSkillSource } from "./skillSources/contract";
import { createSkillSourceObservationStore } from "./skillSourceObservationStore";
import { createSkillSourceService } from "./skillSourceService";
import { parseRepositoryLocation } from "./skillSources/repositoryLocation";
import { createSkillSourceScope, validateSkillSourceCollection } from "./skillSourceScope";

export const createLibrarySkillSourceService = (
  observationDirectory: string,
  repositorySource?: GitCliSkillSource
) => createSkillSourceService({
  observationStore: createSkillSourceObservationStore(observationDirectory),
  repositorySource
});

export const validateGitHubImportCollection = (
  input: Pick<GitHubSkillImportInput, "sourceCollection">,
  source: { owner: string; repo: string; ref: string; remotePath: string }
) => validateSkillSourceCollection(input.sourceCollection, {
  repository: `https://github.com/${source.owner}/${source.repo}.git`,
  ref: source.ref,
  directory: source.remotePath
});

export const validateRepositoryImportCollection = (
  input: Pick<RepositorySkillImportInput, "sourceCollection">,
  source: MaterializedGitSkillSource
) => validateSkillSourceCollection(input.sourceCollection, {
  repository: source.repository,
  ref: source.ref,
  directory: source.directory
});

interface LegacySkillSourceMetadata {
  sourceType?: SkillSourceType;
  source?: string;
  remoteRef?: string;
  remotePath?: string;
  upstream?: SkillUpstream;
  sourceCollection?: SkillSourceCollectionRef;
}

export const legacySkillSourceCollectionFor = (
  metadata: LegacySkillSourceMetadata
): SkillSourceCollectionRef | undefined => {
  if (metadata.sourceCollection) return metadata.sourceCollection;
  if ((metadata.sourceType !== "github" && metadata.sourceType !== "git") || !metadata.source) {
    return undefined;
  }
  const ref = metadata.upstream?.ref ?? metadata.remoteRef;
  if (!ref) return undefined;
  const directory = metadata.upstream?.subpath ?? metadata.remotePath ?? "";
  const locator = metadata.upstream?.locator ?? metadata.source;
  try {
    const repository = parseRepositoryLocation(locator, { allowLocal: true }).transportLocator;
    return {
      ...createSkillSourceScope(
        { repository: locator, ref, directory, transport: "system-git" },
        { repository, ref, directory }
      ),
      sourceSubpath: ""
    };
  } catch {
    return undefined;
  }
};

export const createGitHubSourceScope = (
  rawUrl: string,
  source: { owner: string; repo: string; ref: string; rootPath: string }
) => createSkillSourceScope(
  { repository: rawUrl, ref: source.ref, directory: source.rootPath },
  {
    repository: `https://github.com/${source.owner}/${source.repo}.git`,
    ref: source.ref,
    directory: source.rootPath
  }
);

export const githubCandidateStatus = (
  errors: readonly string[],
  hasExistingSource: boolean,
  hasDuplicate: boolean
): GitHubSkillCandidateStatus =>
  errors.length > 0
    ? "invalid"
    : hasExistingSource
      ? "already-imported"
      : hasDuplicate
        ? "duplicate"
        : "ready";

export const resolveSkillSourceCollection = (
  next: SkillSourceCollectionRef | null | undefined,
  current: SkillSourceCollectionRef | undefined
) => next === null ? undefined : next ?? current;

export const normalizeRepositorySkillScan = (
  result: RepositorySkillScanResult,
  existingSkills: SkillLibraryEntry[]
): RepositorySkillScanResult => {
  return {
    ...result,
    candidates: result.candidates.map((candidate) => {
      if (candidate.status === "invalid") return candidate;
      const existingSource = existingSkills.find(
        (skill) =>
          skill.sourceType === "git" &&
          skill.source === candidate.source.locator &&
          skill.remoteRef === candidate.source.ref &&
          (skill.upstream?.subpath ?? "") === (candidate.source.subpath ?? "")
      );
      const duplicate = existingSkills.find(
        (skill) => !existingSource && skill.remoteRevision === candidate.contentRevision
      );
      const id = existingSource?.id ?? duplicate?.id ?? candidate.id;
      return {
        ...candidate,
        id,
        status: existingSource ? "already-imported" : duplicate ? "duplicate" : "ready",
        existingLibraryId: existingSource?.id ?? duplicate?.id
      };
    })
  };
};

export const createSkillSourceGroupStore = (
  service: SkillSourceService,
  listSkills: () => Promise<SkillLibraryEntry[]>,
  registry: SkillSourceRegistry
) => {
  const decorate = async (groups: SkillSourceGroupView[]) => {
    const names = new Map((await registry.list()).map((record) => [record.id, record.displayName]));
    return groups.map((group) => ({ ...group, displayName: names.get(group.sourceId) }));
  };
  const listSourceGroups = async () => decorate(await service.listGroups(await listSkills()));

  return {
    listSourceGroups,
    checkSourceGroup: async (sourceId: string) => {
      if (!sourceId || sourceId.length > 256) {
        throw new Error("Skill source selection is invalid");
      }
      return (await decorate([await service.checkGroup(sourceId, await listSkills())]))[0]!;
    },
    checkAllSourceGroups: async () => {
      const result = await service.checkAll(await listSkills());
      return { ...result, groups: await decorate(result.groups) };
    },
    setSourceName: async (input: import("../shared/types").SkillSourceNameInput) => {
      if (!input || typeof input.sourceId !== "string") {
        throw new Error("Skill source selection is invalid");
      }
      await registry.setDisplayName(input.sourceId, input.name);
      const group = (await listSourceGroups()).find((candidate) => candidate.sourceId === input.sourceId);
      if (!group) throw new Error("Skill source no longer exists");
      return group;
    }
  };
};
