import { describe, expect, it } from "vitest";
import { parseTargetState } from "../../src/main/targetState";

describe("Target state schema", () => {
  it("rejects versionless legacy state outside startup migration", () => {
    expect(() => parseTargetState({ managedConfigKeys: [], managedMcpNames: [] }))
      .toThrow();
  });

  it("rejects malformed safety fields instead of filtering them out", () => {
    expect(() => parseTargetState({
      formatVersion: 3,
      managedMcpNames: [],
      managedResources: [{ kind: "skill", id: "reviewer", path: 42, contentHash: "abc" }]
    })).toThrow();
  });

  it("rejects unsupported future formats", () => {
    expect(() => parseTargetState({
      formatVersion: 4,
      managedMcpNames: []
    })).toThrow();
  });

  it("accepts current Skill reconciliation receipts", () => {
    expect(parseTargetState({
      formatVersion: 3,
      managedMcpNames: [],
      skillReceipts: [{
        libraryId: "review",
        targetName: "review",
        path: "/target/skills/review",
        desired: "omit",
        observed: "external",
        authority: "leave-unmanaged",
        action: "preserve",
        outcome: "external-remains",
        requiresReview: false,
        localOverride: true
      }]
    })).toMatchObject({
      formatVersion: 3,
      skillReceipts: [expect.objectContaining({
        libraryId: "review",
        outcome: "external-remains"
      })]
    });
  });

  it("migrates legacy kept-outside entries into local override receipts", () => {
    const state = parseTargetState({
      formatVersion: 2,
      managedMcpNames: [],
      keptOutsideSkills: [{
        path: "/target/skills/review",
        skillKey: "review",
        libraryId: "review",
        targetName: "review"
      }]
    });

    expect(state).toMatchObject({
      formatVersion: 3,
      skillReceipts: [expect.objectContaining({
        libraryId: "review",
        authority: "leave-unmanaged",
        outcome: "external-active"
      })]
    });
    expect(state.keptOutsideSkills).toBeUndefined();
  });
});
