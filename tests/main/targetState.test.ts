import { describe, expect, it } from "vitest";
import { parseTargetState } from "../../src/main/targetState";

describe("Target state schema", () => {
  it("migrates versionless state into the current format", () => {
    expect(parseTargetState({ managedConfigKeys: [], managedMcpNames: [] })).toEqual({
      formatVersion: 1,
      managedConfigKeys: [],
      managedMcpNames: [],
      managedResources: [],
      sharedSkillPreparations: []
    });
  });

  it("rejects malformed safety fields instead of filtering them out", () => {
    expect(() => parseTargetState({
      managedConfigKeys: [],
      managedMcpNames: [],
      managedResources: [{ kind: "skill", id: "reviewer", path: 42, contentHash: "abc" }]
    })).toThrow();
  });

  it("rejects unsupported future formats", () => {
    expect(() => parseTargetState({
      formatVersion: 2,
      managedConfigKeys: [],
      managedMcpNames: []
    })).toThrow();
  });
});
