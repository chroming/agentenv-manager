import { describe, expect, it } from "vitest";
import type { GitHubSkillCandidate } from "../../src/shared/types";
import {
  emptyRepositoryImportDraft,
  repositoryImportDraftReducer
} from "../../src/renderer/hooks/useRepositoryImportDraft";

const candidate = (
  sourceUrl: string,
  id: string,
  status: GitHubSkillCandidate["status"] = "ready"
): GitHubSkillCandidate => ({
  id,
  name: id,
  description: "",
  remotePath: `skills/${id}`,
  sourceUrl,
  ref: "main",
  revision: "abc123",
  status
});

describe("repositoryImportDraftReducer", () => {
  it("selects newly discovered ready candidates", () => {
    const state = repositoryImportDraftReducer(emptyRepositoryImportDraft(), {
      type: "reconcile",
      candidates: [candidate("one", "one"), candidate("bad", "bad", "invalid")]
    });

    expect(state.readySources).toEqual(["one"]);
    expect(state.deselectedSources).toEqual([]);
    expect(state.candidateIds).toEqual({ one: "one", bad: "bad" });
  });

  it("preserves explicit selections and edited IDs across a rescan", () => {
    let state = repositoryImportDraftReducer(emptyRepositoryImportDraft(), {
      type: "reconcile",
      candidates: [candidate("one", "one"), candidate("two", "two")]
    });
    state = repositoryImportDraftReducer(state, {
      type: "select-source",
      sourceUrl: "one",
      selected: false
    });
    state = repositoryImportDraftReducer(state, {
      type: "set-id",
      sourceUrl: "two",
      id: "custom-two"
    });
    state = repositoryImportDraftReducer(state, {
      type: "reconcile",
      candidates: [candidate("two", "server-two"), candidate("one", "server-one"), candidate("three", "three")]
    });

    expect(state.readySources.filter((sourceUrl) => !state.deselectedSources.includes(sourceUrl))).toEqual([
      "two",
      "three"
    ]);
    expect(state.candidateIds).toEqual({
      two: "custom-two",
      one: "one",
      three: "three"
    });
  });

  it("selects a previously unavailable candidate when it becomes ready", () => {
    let state = repositoryImportDraftReducer(emptyRepositoryImportDraft(), {
      type: "reconcile",
      candidates: [candidate("one", "one", "invalid")]
    });
    state = repositoryImportDraftReducer(state, {
      type: "reconcile",
      candidates: [candidate("one", "one", "ready")]
    });

    expect(state.readySources).toEqual(["one"]);
    expect(state.deselectedSources).toEqual([]);
  });

  it("drops draft values for candidates that disappeared", () => {
    let state = repositoryImportDraftReducer(emptyRepositoryImportDraft(), {
      type: "reconcile",
      candidates: [candidate("one", "one"), candidate("two", "two")]
    });
    state = repositoryImportDraftReducer(state, {
      type: "select-source",
      sourceUrl: "one",
      selected: false
    });
    state = repositoryImportDraftReducer(state, {
      type: "reconcile",
      candidates: [candidate("two", "two")]
    });

    expect(state.knownSources).toEqual(["two"]);
    expect(state.deselectedSources).toEqual([]);
    expect(state.candidateIds).toEqual({ two: "two" });
  });
});
