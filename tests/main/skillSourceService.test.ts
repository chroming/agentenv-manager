import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSkillSourceService } from "../../src/main/skillSourceService";
import type { SkillSourceObservationStore } from "../../src/main/skillSourceObservationStore";
import type { GitCliSkillSource } from "../../src/main/skillSources/contract";
import type { SkillSourceObservation } from "../../src/shared/skillSourceGrouping";
import type { SkillLibraryEntry, SkillSourceScope } from "../../src/shared/types";

const scope: SkillSourceScope = {
  formatVersion: 1,
  canonicalLink: "https://github.com/acme/skills/tree/main/engineering",
  repository: "https://github.com/acme/skills.git",
  ref: "main",
  directory: "engineering"
};

const librarySkill: SkillLibraryEntry = {
  id: "review",
  name: "review",
  description: "Review code",
  path: "/library/review",
  sourceType: "git",
  source: scope.repository,
  globallyEnabled: true,
  updatePolicy: "tracked",
  remoteRef: "main",
  remoteRevision: "review-1",
  contentHash: "review-hash",
  updatedAt: "2026-07-20T00:00:00.000Z",
  sourceCollection: { ...scope, sourceSubpath: "review" }
};

const previousObservation: SkillSourceObservation = {
  ...scope,
  checkedAt: "2026-07-20T00:00:00.000Z",
  accessTransport: "https",
  complete: true,
  candidates: [{
    sourceSubpath: "review",
    directory: "engineering/review",
    name: "review",
    description: "Review code",
    contentRevision: "review-1",
    validity: "valid"
  }]
};

const memoryStore = (initial?: SkillSourceObservation) => {
  const observations = new Map<string, SkillSourceObservation>();
  if (initial) observations.set(initial.canonicalLink, initial);
  const store: SkillSourceObservationStore = {
    read: vi.fn(async (link) => observations.get(link)),
    write: vi.fn(async (observation) => {
      observations.set(observation.canonicalLink, observation);
    }),
    remove: vi.fn(async (link) => {
      observations.delete(link);
    })
  };
  return { observations, store };
};

describe("skill source service", () => {
  let localRoot = "";

  afterEach(async () => {
    if (localRoot) await rm(localRoot, { recursive: true, force: true });
    localRoot = "";
  });
  it("does not replace the last complete observation with an incomplete scan", async () => {
    const { observations, store } = memoryStore(previousObservation);
    const repositorySource = {
      resolve: vi.fn(),
      materialize: vi.fn(),
      scan: vi.fn().mockResolvedValue({
        repository: scope.repository,
        ref: scope.ref,
        directory: scope.directory,
        transport: "system-git",
        accessTransport: "https",
        sourceScope: scope,
        truncated: true,
        candidates: []
      })
    } as unknown as GitCliSkillSource;
    const service = createSkillSourceService({ observationStore: store, repositorySource });

    const group = await service.checkGroup(scope.canonicalLink, [librarySkill]);

    expect(group.observationState).toBe("error");
    expect(group.error).toContain("incomplete");
    expect(group.candidates).toMatchObject([{ libraryId: "review", state: "current" }]);
    expect(observations.get(scope.canonicalLink)).toEqual(previousObservation);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("replaces the cache only after a complete successful scan", async () => {
    const { store } = memoryStore(previousObservation);
    const repositorySource = {
      resolve: vi.fn(),
      materialize: vi.fn(),
      scan: vi.fn().mockResolvedValue({
        repository: scope.repository,
        ref: scope.ref,
        directory: scope.directory,
        transport: "system-git",
        accessTransport: "ssh",
        sourceScope: scope,
        truncated: false,
        candidates: [{
          id: "review",
          name: "review",
          description: "Review code",
          directory: "engineering/review",
          source: { kind: "git", locator: scope.repository, ref: "main", subpath: "engineering/review" },
          contentRevision: "review-2",
          compatibleRevisions: ["review-1"],
          resolvedCommit: "commit-2",
          status: "ready"
        }]
      })
    } as unknown as GitCliSkillSource;
    const service = createSkillSourceService({
      observationStore: store,
      repositorySource,
      now: () => new Date("2026-07-21T00:00:00.000Z")
    });

    const group = await service.checkGroup(scope.canonicalLink, [librarySkill]);

    expect(group.observationState).toBe("ready");
    expect(group.candidates).toMatchObject([{
      libraryId: "review",
      contentRevision: "review-1",
      state: "current"
    }]);
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({
      checkedAt: "2026-07-21T00:00:00.000Z",
      accessTransport: "ssh",
      complete: true
    }));
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [expect.objectContaining({ compatibleRevisions: ["review-1"] })]
    }));
  });

  it("reuses a saved repository Skill index on later source checks", async () => {
    const indexedScope: SkillSourceScope = {
      ...scope,
      indexManifestPath: "suite/llms.txt"
    };
    const indexedSkill: SkillLibraryEntry = {
      ...librarySkill,
      sourceCollection: { ...indexedScope, sourceSubpath: "review" }
    };
    const { store } = memoryStore({ ...previousObservation, ...indexedScope });
    const repositorySource = {
      resolve: vi.fn(),
      materialize: vi.fn(),
      scan: vi.fn().mockResolvedValue({
        repository: indexedScope.repository,
        ref: indexedScope.ref,
        directory: indexedScope.directory,
        transport: "system-git",
        accessTransport: "https",
        sourceScope: indexedScope,
        truncated: false,
        candidates: []
      })
    } as unknown as GitCliSkillSource;
    const service = createSkillSourceService({ observationStore: store, repositorySource });

    await service.checkGroup(indexedScope.canonicalLink, [indexedSkill]);

    expect(repositorySource.scan).toHaveBeenCalledWith(
      expect.objectContaining({ indexManifestPath: "suite/llms.txt" }),
      undefined,
      { refresh: true }
    );
  });

  it("checks a local source read-only and reports changed content", async () => {
    localRoot = await mkdtemp(join(tmpdir(), "agentenv-local-source-"));
    const skillPath = join(localRoot, "review");
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), "---\nname: review\ndescription: Review code\n---\n\nChanged\n");
    const localScope: SkillSourceScope = {
      formatVersion: 1,
      kind: "local",
      canonicalLink: `file://${localRoot}`,
      repository: localRoot,
      ref: "",
      directory: ""
    };
    const localSkill: SkillLibraryEntry = {
      ...librarySkill,
      sourceType: "local",
      source: skillPath,
      remoteRef: undefined,
      remoteRevision: "old-content",
      sourceCollection: { ...localScope, sourceSubpath: "review" }
    };
    const { store } = memoryStore();
    const service = createSkillSourceService({ observationStore: store });

    const group = await service.checkGroup(localScope.canonicalLink, [localSkill]);

    expect(group.sourceKind).toBe("local");
    expect(group.candidates).toMatchObject([{ libraryId: "review", state: "update" }]);
    expect(await readFile(join(skillPath, "SKILL.md"), "utf8")).toContain("Changed");
  });

  it("keeps the Library relation when a local source becomes unavailable", async () => {
    localRoot = await mkdtemp(join(tmpdir(), "agentenv-local-source-"));
    const localScope: SkillSourceScope = {
      formatVersion: 1,
      kind: "local",
      canonicalLink: `file://${localRoot}`,
      repository: localRoot,
      ref: "",
      directory: ""
    };
    const localSkill: SkillLibraryEntry = {
      ...librarySkill,
      sourceType: "local",
      source: join(localRoot, "review"),
      sourceCollection: { ...localScope, sourceSubpath: "review" }
    };
    const { store } = memoryStore();
    const service = createSkillSourceService({ observationStore: store });
    await rm(localRoot, { recursive: true, force: true });
    localRoot = "";

    const group = await service.checkGroup(localScope.canonicalLink, [localSkill]);

    expect(group.observationState).toBe("error");
    expect(group.candidates).toMatchObject([{ libraryId: "review", state: "unchecked" }]);
  });
});
