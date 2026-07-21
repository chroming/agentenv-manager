import type {
  RepositorySkillScanResult,
  RepositorySkillImportInput,
  GitHubSkillImportInput,
  GitHubSkillCandidateStatus,
  SkillLibraryEntry,
  SkillSourceCollectionRef,
  SkillSourceType,
  SkillUpstream
} from "../shared/types";
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
  const reservedIds = new Set(existingSkills.map((skill) => skill.id));
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
      let id = existingSource?.id ?? duplicate?.id ?? candidate.id;
      const baseId = id;
      for (let suffix = 2; !existingSource && !duplicate && reservedIds.has(id); suffix += 1) {
        id = `${baseId}-${suffix}`;
      }
      if (!existingSource && !duplicate) reservedIds.add(id);
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
  listSkills: () => Promise<SkillLibraryEntry[]>
) => ({
  listSourceGroups: async () => service.listGroups(await listSkills()),
  checkSourceGroup: async (canonicalLink: string) => {
    if (!canonicalLink || canonicalLink.length > 4096) {
      throw new Error("Skill source link is invalid");
    }
    return service.checkGroup(canonicalLink, await listSkills());
  },
  checkAllSourceGroups: async () => service.checkAll(await listSkills())
});
