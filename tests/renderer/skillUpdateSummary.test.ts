import { describe, expect, it } from "vitest";
import type { SkillLibraryEntry, SkillSourceGroupView } from "../../src/shared/types";
import {
  summarizeSkillUpdateChecks,
  updatesFromSourceGroups
} from "../../src/renderer/skillUpdateSummary";

const skill: SkillLibraryEntry = {
  id: "reviewer",
  name: "Reviewer",
  description: "Review code",
  path: "/tmp/library/reviewer",
  sourceType: "github",
  source: "https://github.com/acme/skills/tree/main/reviewer",
  updatePolicy: "tracked",
  contentHash: "current",
  remoteRevision: "current",
  updatedAt: "2026-08-07T00:00:00.000Z",
  globallyEnabled: true
};

const removedSource: SkillSourceGroupView = {
  formatVersion: 1,
  sourceId: "source-1",
  canonicalLink: "https://github.com/acme/skills/tree/main/reviewer",
  repository: "https://github.com/acme/skills.git",
  ref: "main",
  directory: "reviewer",
  sourceKind: "repository",
  observationState: "ready",
  counts: { total: 1, updates: 0, new: 0, removed: 1 },
  candidates: [{
    sourceSubpath: "",
    directory: "reviewer",
    name: "Reviewer",
    description: "Review code",
    libraryId: "reviewer",
    state: "removed"
  }]
};

describe("skill update summaries", () => {
  it("projects a removed source as a non-failing Library status", () => {
    const updates = updatesFromSourceGroups([removedSource], [skill]);

    expect(updates).toEqual([
      expect.objectContaining({
        id: "reviewer",
        sourceStatus: "removed",
        updateAvailable: false
      })
    ]);
    expect(updates[0]?.error).toBeUndefined();
    expect(summarizeSkillUpdateChecks(updates, (message, values) =>
      message.replace("{{count}}", String(values?.count ?? "{{count}}"))
    )).toEqual({
      state: "info",
      message: "1 source removed upstream"
    });
  });
});
