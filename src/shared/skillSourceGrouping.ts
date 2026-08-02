import type {
  SkillLibraryEntry,
  SkillSourceGroupCandidate,
  SkillSourceGroupView,
  SkillSourceScope
} from "./types";

export interface SkillSourceObservationCandidate {
  sourceSubpath: string;
  directory: string;
  name: string;
  description: string;
  version?: string;
  contentRevision: string;
  compatibleRevisions?: string[];
  upstreamUpdatedAt?: string;
  validity: "valid" | "invalid";
  error?: string;
}

export interface SkillSourceObservation extends SkillSourceScope {
  checkedAt: string;
  accessTransport: "github-api" | "https" | "ssh" | "file";
  resolvedCommit?: string;
  complete: true;
  candidates: SkillSourceObservationCandidate[];
}

const normalizedSubpath = (value: string) => value.replace(/^\/+|\/+$/g, "");

export const sourceSubpathFor = (directory: string, candidateDirectory: string) => {
  const root = normalizedSubpath(directory);
  const candidate = normalizedSubpath(candidateDirectory);
  if (!root) return candidate;
  if (candidate === root) return "";
  if (!candidate.startsWith(`${root}/`)) {
    throw new Error(`Skill path is outside its source scope: ${candidateDirectory}`);
  }
  return candidate.slice(root.length + 1);
};

export const sourceCandidateDirectory = (directory: string, sourceSubpath: string) =>
  [normalizedSubpath(directory), normalizedSubpath(sourceSubpath)].filter(Boolean).join("/");

const candidatePriority: Record<SkillSourceGroupCandidate["state"], number> = {
  conflict: 0,
  invalid: 1,
  missing: 2,
  update: 3,
  new: 4,
  removed: 5,
  unchecked: 6,
  current: 7,
  ignored: 8
};

const localCandidate = (
  skill: SkillLibraryEntry,
  state: SkillSourceGroupCandidate["state"],
  detail?: string
): SkillSourceGroupCandidate => ({
  sourceSubpath: skill.sourceCollection?.sourceSubpath ?? "",
  directory: sourceCandidateDirectory(
    skill.sourceCollection?.directory ?? "",
    skill.sourceCollection?.sourceSubpath ?? ""
  ),
  name: skill.name,
  description: skill.description,
  version: skill.version,
  contentRevision: skill.remoteRevision,
  upstreamUpdatedAt: skill.upstream?.updatedAt,
  libraryId: skill.id,
  libraryName: skill.name,
  libraryVersion: skill.version,
  libraryUpdatedAt: skill.updatedAt,
  globallyEnabled: skill.globallyEnabled !== false,
  updatePolicy: skill.updatePolicy,
  state,
  detail
});

export const deriveSkillSourceGroups = (
  skills: SkillLibraryEntry[],
  observations: ReadonlyMap<string, SkillSourceObservation>,
  errors: ReadonlyMap<string, string> = new Map()
): SkillSourceGroupView[] => {
  const skillsBySource = new Map<string, SkillLibraryEntry[]>();
  for (const skill of skills) {
    const source = skill.sourceCollection;
    if (!source) continue;
    const key = source.sourceId ?? source.canonicalLink;
    skillsBySource.set(key, [...(skillsBySource.get(key) ?? []), skill]);
  }

  return [...skillsBySource.entries()]
    .map(([sourceId, sourceSkills]): SkillSourceGroupView => {
      const firstScope = sourceSkills[0]!.sourceCollection!;
      const canonicalLink = firstScope.canonicalLink;
      const scopeMismatch = sourceSkills.some((skill) => {
        const source = skill.sourceCollection!;
        return source.repository !== firstScope.repository ||
          source.ref !== firstScope.ref ||
          source.directory !== firstScope.directory ||
          source.indexManifestPath !== firstScope.indexManifestPath;
      });
      const observation = observations.get(canonicalLink);
      const localByPath = new Map<string, SkillLibraryEntry[]>();
      for (const skill of sourceSkills) {
        const path = skill.sourceCollection!.sourceSubpath;
        localByPath.set(path, [...(localByPath.get(path) ?? []), skill]);
      }

      const candidates: SkillSourceGroupCandidate[] = [];
      const observedPaths = new Set<string>();
      if (observation) {
        for (const remote of observation.candidates) {
          observedPaths.add(remote.sourceSubpath);
          const local = localByPath.get(remote.sourceSubpath) ?? [];
          if (remote.validity === "invalid") {
            candidates.push({
              ...remote,
              libraryId: local[0]?.id,
              libraryName: local[0]?.name,
              libraryVersion: local[0]?.version,
              globallyEnabled: local[0]?.globallyEnabled !== false,
              updatePolicy: local[0]?.updatePolicy,
              state: "invalid",
              detail: remote.error ?? "SKILL.md is invalid"
            });
            continue;
          }
          if (local.length > 1) {
            candidates.push({
              ...remote,
              state: "conflict",
              detail: `${local.length} Library Skills use this source path`
            });
            continue;
          }
          const skill = local[0];
          if (!skill) {
            candidates.push({ ...remote, state: "new" });
            continue;
          }
          const matchedRevision = [remote.contentRevision, ...(remote.compatibleRevisions ?? [])]
            .find((revision) => revision === skill.remoteRevision);
          candidates.push({
            ...remote,
            contentRevision: matchedRevision ?? remote.contentRevision,
            libraryId: skill.id,
            libraryName: skill.name,
            libraryVersion: skill.version,
            libraryUpdatedAt: skill.updatedAt,
            globallyEnabled: skill.globallyEnabled !== false,
            updatePolicy: skill.updatePolicy,
            state: matchedRevision ? "current" : "update"
          });
        }
        for (const skill of sourceSkills) {
          if (!observedPaths.has(skill.sourceCollection!.sourceSubpath)) {
            candidates.push(localCandidate(skill, "removed"));
          }
        }
      } else {
        candidates.push(...sourceSkills.map((skill) => localCandidate(skill, "unchecked")));
      }

      if (scopeMismatch) {
        for (const candidate of candidates) {
          candidate.state = "conflict";
          candidate.detail = "Library Skills disagree about this source scope";
        }
      }

      candidates.sort((left, right) =>
        candidatePriority[left.state] - candidatePriority[right.state] ||
        left.name.localeCompare(right.name)
      );
      return {
        formatVersion: 1,
        kind: firstScope.kind ?? "repository",
        sourceId,
        sourceKind: firstScope.kind ?? "repository",
        automaticChecks: firstScope.kind !== "local",
        canonicalLink,
        repository: firstScope.repository,
        ref: firstScope.ref,
        directory: firstScope.directory,
        indexManifestPath: firstScope.indexManifestPath,
        checkedAt: observation?.checkedAt,
        observationState: errors.has(canonicalLink)
          ? "error"
          : observation
            ? "ready"
            : "unchecked",
        error: errors.get(canonicalLink),
        counts: {
          total: observation?.candidates.filter((candidate) => candidate.validity === "valid").length ?? sourceSkills.length,
          updates: candidates.filter((candidate) => candidate.state === "update").length,
          new: candidates.filter((candidate) => candidate.state === "new").length,
          removed: candidates.filter((candidate) => candidate.state === "removed").length
        },
        candidates
      };
    })
    .sort((left, right) => {
      const leftAttention = left.counts.updates + left.counts.new + left.counts.removed +
        left.candidates.filter((candidate) => ["conflict", "invalid", "missing"].includes(candidate.state)).length;
      const rightAttention = right.counts.updates + right.counts.new + right.counts.removed +
        right.candidates.filter((candidate) => ["conflict", "invalid", "missing"].includes(candidate.state)).length;
      return rightAttention - leftAttention || left.canonicalLink.localeCompare(right.canonicalLink);
    });
};
