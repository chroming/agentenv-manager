import type {
  GitHubSkillScanResult,
  RepositorySkillScanResult,
  SkillLibraryEntry,
  SkillSourceCheckAllResult,
  SkillSourceGroupView,
  SkillSourceScope
} from "../shared/types";
import {
  deriveSkillSourceGroups,
  sourceSubpathFor,
  type SkillSourceObservation
} from "../shared/skillSourceGrouping";
import type { GitCliSkillSource } from "./skillSources/contract";
import type { SkillSourceObservationStore } from "./skillSourceObservationStore";

export interface SkillSourceService {
  listGroups(skills: SkillLibraryEntry[]): Promise<SkillSourceGroupView[]>;
  recordRepositoryScan(scope: SkillSourceScope, result: RepositorySkillScanResult): Promise<void>;
  recordGitHubScan(scope: SkillSourceScope, result: GitHubSkillScanResult): Promise<void>;
  checkGroup(sourceId: string, skills: SkillLibraryEntry[]): Promise<SkillSourceGroupView>;
  checkAll(skills: SkillLibraryEntry[]): Promise<SkillSourceCheckAllResult>;
}

interface SkillSourceServiceOptions {
  observationStore: SkillSourceObservationStore;
  repositorySource?: GitCliSkillSource;
  now?: () => Date;
}

export const createSkillSourceService = (
  options: SkillSourceServiceOptions
): SkillSourceService => {
  const errors = new Map<string, string>();
  const now = options.now ?? (() => new Date());

  const readObservations = async (skills: SkillLibraryEntry[]) => {
    const links = [...new Set(
      skills.map((skill) => skill.sourceCollection?.canonicalLink).filter((link): link is string => Boolean(link))
    )];
    const values = await Promise.all(
      links.map(async (link) => [link, await options.observationStore.read(link)] as const)
    );
    return new Map(
      values.filter((entry): entry is readonly [string, SkillSourceObservation] => Boolean(entry[1]))
    );
  };

  const listGroups = async (skills: SkillLibraryEntry[]) =>
    deriveSkillSourceGroups(skills, await readObservations(skills), errors);

  const writeObservation = async (observation: SkillSourceObservation) => {
    await options.observationStore.write(observation);
    errors.delete(observation.canonicalLink);
  };

  const recordRepositoryScan = async (
    scope: SkillSourceScope,
    result: RepositorySkillScanResult
  ) => {
    if (result.truncated) return;
    await writeObservation({
      ...scope,
      checkedAt: now().toISOString(),
      accessTransport: result.accessTransport ?? "https",
      resolvedCommit: result.candidates[0]?.resolvedCommit,
      complete: true,
      candidates: result.candidates.map((candidate) => ({
        sourceSubpath: sourceSubpathFor(scope.directory, candidate.directory),
        directory: candidate.directory,
        name: candidate.name,
        description: candidate.description,
        version: candidate.version,
        contentRevision: candidate.contentRevision,
        compatibleRevisions: candidate.compatibleRevisions,
        upstreamUpdatedAt: candidate.upstreamUpdatedAt,
        validity: candidate.status === "invalid" ? "invalid" : "valid",
        error: candidate.error
      }))
    });
  };

  const recordGitHubScan = async (
    scope: SkillSourceScope,
    result: GitHubSkillScanResult
  ) => {
    if (result.truncated) return;
    await writeObservation({
      ...scope,
      checkedAt: now().toISOString(),
      accessTransport: "github-api",
      complete: true,
      candidates: result.candidates.map((candidate) => ({
        sourceSubpath: sourceSubpathFor(scope.directory, candidate.remotePath),
        directory: candidate.remotePath,
        name: candidate.name,
        description: candidate.description,
        version: candidate.version,
        contentRevision: candidate.revision,
        compatibleRevisions: candidate.compatibleRevisions,
        validity: candidate.status === "invalid" ? "invalid" : "valid",
        error: candidate.error
      }))
    });
  };

  const checkGroup = async (
    sourceId: string,
    skills: SkillLibraryEntry[]
  ): Promise<SkillSourceGroupView> => {
    const group = (await listGroups(skills)).find((candidate) =>
      candidate.sourceId === sourceId
    );
    if (!group) throw new Error("Skill source group no longer exists");
    try {
      if (!options.repositorySource) {
        throw new Error("System Git is unavailable. Install Git and retry the source check.");
      }
      const result = await options.repositorySource.scan({
        repository: group.repository,
        ref: group.ref,
        directory: group.directory,
        transport: "system-git"
      });
      if (result.truncated) {
        throw new Error("Source scan was incomplete and was not applied");
      }
      await recordRepositoryScan(group, result);
    } catch (error) {
      errors.set(group.canonicalLink, error instanceof Error ? error.message : String(error));
    }
    const refreshed = (await listGroups(skills)).find((candidate) =>
      candidate.sourceId === sourceId
    );
    if (!refreshed) throw new Error("Skill source group no longer exists");
    return refreshed;
  };

  const checkAll = async (skills: SkillLibraryEntry[]): Promise<SkillSourceCheckAllResult> => {
    const groups = await listGroups(skills);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(2, groups.length) }, async () => {
      while (nextIndex < groups.length) {
        const group = groups[nextIndex++];
        await checkGroup(group.sourceId, skills);
      }
    });
    await Promise.all(workers);
    const refreshed = await listGroups(skills);
    return {
      groups: refreshed,
      checked: refreshed.length,
      failed: refreshed.filter((group) => group.observationState === "error").length
    };
  };

  return { listGroups, recordRepositoryScan, recordGitHubScan, checkGroup, checkAll };
};
