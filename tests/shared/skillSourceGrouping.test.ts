import { describe, expect, it } from "vitest";
import {
  deriveSkillSourceGroups,
  type SkillSourceObservation
} from "../../src/shared/skillSourceGrouping";
import type { SkillLibraryEntry, SkillSourceCollectionRef } from "../../src/shared/types";

const scope = {
  formatVersion: 1 as const,
  canonicalLink: "https://github.com/acme/skills/tree/main/engineering",
  repository: "https://github.com/acme/skills.git",
  ref: "main",
  directory: "engineering"
};

const skill = (
  id: string,
  sourceSubpath: string,
  remoteRevision: string,
  sourceCollection: SkillSourceCollectionRef = { ...scope, sourceSubpath }
): SkillLibraryEntry => ({
  id,
  name: id,
  description: `${id} description`,
  path: `/library/${id}`,
  sourceType: "git",
  source: scope.repository,
  globallyEnabled: true,
  updatePolicy: "tracked",
  remoteRef: "main",
  remoteRevision,
  contentHash: `${id}-hash`,
  updatedAt: "2026-07-20T00:00:00.000Z",
  sourceCollection
});

const observation: SkillSourceObservation = {
  ...scope,
  checkedAt: "2026-07-21T00:00:00.000Z",
  accessTransport: "https",
  complete: true,
  candidates: [
    {
      sourceSubpath: "review",
      directory: "engineering/review",
      name: "review",
      description: "Review code",
      version: "2.0.0",
      contentRevision: "remote-review-2",
      validity: "valid"
    },
    {
      sourceSubpath: "testing",
      directory: "engineering/testing",
      name: "testing",
      description: "Test code",
      contentRevision: "remote-testing-1",
      validity: "valid"
    }
  ]
};

describe("skill source grouping", () => {
  it("derives explicit update, new, and removed actions from the last complete observation", () => {
    const [group] = deriveSkillSourceGroups(
      [skill("review", "review", "remote-review-1"), skill("docs", "docs", "remote-docs-1")],
      new Map([[scope.canonicalLink, observation]])
    );

    expect(group.counts).toEqual({ total: 2, updates: 1, new: 1, removed: 1 });
    expect(group.candidates.map(({ name, state }) => ({ name, state }))).toEqual([
      { name: "review", state: "update" },
      { name: "testing", state: "new" },
      { name: "docs", state: "removed" }
    ]);
    expect(group.candidates.find((candidate) => candidate.libraryId === "review")?.libraryUpdatedAt)
      .toBe("2026-07-20T00:00:00.000Z");
  });

  it("keeps the last complete observation visible when a later check fails", () => {
    const [group] = deriveSkillSourceGroups(
      [skill("review", "review", "remote-review-2")],
      new Map([[scope.canonicalLink, observation]]),
      new Map([[scope.canonicalLink, "Repository unavailable"]])
    );

    expect(group.observationState).toBe("error");
    expect(group.error).toBe("Repository unavailable");
    expect(group.candidates.find((candidate) => candidate.name === "review")?.state).toBe("current");
    expect(group.candidates.find((candidate) => candidate.name === "testing")?.state).toBe("new");
  });

  it("treats transport-compatible revisions as current and displays the matching revision", () => {
    const compatibleObservation: SkillSourceObservation = {
      ...observation,
      candidates: [{
        ...observation.candidates[0]!,
        contentRevision: "git-tree-review-1",
        compatibleRevisions: ["github-api-review-1"]
      }]
    };
    const [group] = deriveSkillSourceGroups(
      [skill("review", "review", "github-api-review-1")],
      new Map([[scope.canonicalLink, compatibleObservation]])
    );

    expect(group.counts.updates).toBe(0);
    expect(group.candidates).toMatchObject([{
      libraryId: "review",
      contentRevision: "github-api-review-1",
      state: "current"
    }]);
  });

  it("uses the exact canonical link as group identity and removes empty groups", () => {
    const other = {
      ...scope,
      canonicalLink: "https://github.com/acme/skills/tree/main/engineering/review",
      directory: "engineering/review"
    };
    const groups = deriveSkillSourceGroups([
      skill("engineering", "review", "one"),
      skill("review-only", "", "two", { ...other, sourceSubpath: "" })
    ], new Map());

    expect(groups.map((group) => group.canonicalLink).sort()).toEqual([
      other.canonicalLink,
      scope.canonicalLink
    ].sort());
    expect(groups.map((group) => group.counts.total)).toEqual([1, 1]);
    expect(deriveSkillSourceGroups([], new Map())).toEqual([]);
  });
});
