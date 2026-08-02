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
import {
  createLocalSkillSourceCollection,
  createSkillSourceScope,
  validateSkillSourceCollection
} from "./skillSourceScope";

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
  provenance?: import("../shared/types").SkillProvenance;
  sourceCollection?: SkillSourceCollectionRef;
}

export const legacySkillSourceCollectionFor = (
  metadata: LegacySkillSourceMetadata
): SkillSourceCollectionRef | undefined => {
  if (metadata.sourceCollection) return metadata.sourceCollection;
  if (
    metadata.sourceType === "local" &&
    metadata.source &&
    metadata.provenance?.importedVia !== "local-scan"
  ) {
    return createLocalSkillSourceCollection(metadata.source, metadata.source);
  }
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
    const records = new Map((await registry.list()).map((record) => [record.id, record]));
    return groups.map((group) => {
      const record = records.get(group.sourceId);
      return {
        ...group,
        sourceKind: record?.kind ?? group.sourceKind,
        automaticChecks: record?.automaticChecks ?? group.sourceKind !== "local",
        displayName: record?.displayName,
        candidates: group.candidates.map((candidate) =>
          candidate.state === "new" &&
          record?.ignoredSubpaths?.includes(candidate.sourceSubpath)
            ? {
                ...candidate,
                state: "ignored" as const,
                detail: "Ignored for this source"
              }
            : candidate
        ),
        counts: {
          ...group.counts,
          new: group.candidates.filter((candidate) =>
            candidate.state === "new" &&
            !record?.ignoredSubpaths?.includes(candidate.sourceSubpath)
          ).length
        }
      };
    });
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
    checkMonitoredSourceGroups: async () => {
      const skills = await listSkills();
      const groups = await decorate(await service.listGroups(skills));
      const selected = groups.filter((group) => group.automaticChecks);
      let nextIndex = 0;
      await Promise.all(
        Array.from({ length: Math.min(2, selected.length) }, async () => {
          while (nextIndex < selected.length) {
            const group = selected[nextIndex++];
            await service.checkGroup(group!.sourceId, skills);
          }
        })
      );
      const refreshed = await decorate(await service.listGroups(skills));
      return {
        groups: refreshed,
        checked: selected.length,
        failed: refreshed.filter((group) =>
          selected.some((selectedGroup) => selectedGroup.sourceId === group.sourceId) &&
          group.observationState === "error"
        ).length
      };
    },
    setSourceName: async (input: import("../shared/types").SkillSourceNameInput) => {
      if (!input || typeof input.sourceId !== "string") {
        throw new Error("Skill source selection is invalid");
      }
      await registry.setDisplayName(input.sourceId, input.name);
      const group = (await listSourceGroups()).find((candidate) => candidate.sourceId === input.sourceId);
      if (!group) throw new Error("Skill source no longer exists");
      return group;
    },
    setSourceMonitored: async (
      input: import("../shared/types").SkillSourceMonitoringInput
    ) => {
      if (!input || typeof input.sourceId !== "string" || typeof input.enabled !== "boolean") {
        throw new Error("Skill source monitoring setting is invalid");
      }
      await registry.setAutomaticChecks(input.sourceId, input.enabled);
      const group = (await listSourceGroups()).find((candidate) => candidate.sourceId === input.sourceId);
      if (!group) throw new Error("Skill source no longer exists");
      return group;
    },
    setSourceCandidateIgnored: async (
      input: import("../shared/types").SkillSourceCandidateIgnoreInput
    ) => {
      if (!input ||
        typeof input.sourceId !== "string" ||
        typeof input.sourceSubpath !== "string" ||
        typeof input.ignored !== "boolean") {
        throw new Error("Skill source ignore setting is invalid");
      }
      const current = (await listSourceGroups()).find(
        (candidate) => candidate.sourceId === input.sourceId
      );
      if (!current) throw new Error("Skill source no longer exists");
      const candidate = current.candidates.find(
        (item) => item.sourceSubpath === input.sourceSubpath
      );
      if (!candidate) throw new Error("Skill source item no longer exists");
      if (input.ignored && candidate.state !== "new" && candidate.state !== "ignored") {
        throw new Error("Only a new source Skill can be ignored");
      }
      await registry.setIgnoredSubpath(
        input.sourceId,
        input.sourceSubpath,
        input.ignored
      );
      const group = (await listSourceGroups()).find(
        (item) => item.sourceId === input.sourceId
      );
      if (!group) throw new Error("Skill source no longer exists");
      return group;
    }
  };
};
