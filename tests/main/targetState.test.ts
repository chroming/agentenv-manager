import { describe, expect, it } from "vitest";
import { parseTargetState } from "../../src/main/targetState";

describe("Target state schema", () => {
  it("rejects versionless legacy state outside startup migration", () => {
    expect(() => parseTargetState({ managedConfigKeys: [], managedMcpNames: [] }))
      .toThrow();
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
      formatVersion: 3,
      managedConfigKeys: [],
      managedMcpNames: []
    })).toThrow();
  });
});
