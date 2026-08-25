import { describe, expect, it } from "vitest";
import { createProfileContentHash } from "../../src/main/profileFingerprint";
import type { ProfileDetail } from "../../src/shared/types";

const profile = (
  mode: "ignore" | "manage" | "disable",
  enabled: boolean
): ProfileDetail => ({
  id: "daily-coding",
  manifest: {
    id: "daily-coding",
    name: "Daily Coding",
    description: "",
    version: 2
  },
  instructions: "# Agent\n",
  resources: {
    skills: [],
    mcpByTarget: {
      codex: {
        mode,
        selections: [{ name: "context7", enabled }]
      }
    }
  },
  contentHash: "",
  targetContentHashes: {}
});

describe("Profile target fingerprint", () => {
  it("excludes retained MCP selections while the Target policy is ignore", () => {
    expect(createProfileContentHash(profile("ignore", true), "codex"))
      .toBe(createProfileContentHash(profile("ignore", false), "codex"));
  });

  it("includes MCP selections while the Target policy is manage", () => {
    expect(createProfileContentHash(profile("manage", true), "codex"))
      .not.toBe(createProfileContentHash(profile("manage", false), "codex"));
  });

  it("tracks which MCP names are disabled without tracking their saved switch values", () => {
    const enabled = profile("disable", true);
    const disabled = profile("disable", false);
    const anotherServer = profile("disable", true);
    anotherServer.resources.mcpByTarget.codex.selections = [
      { name: "filesystem", enabled: true }
    ];

    expect(createProfileContentHash(enabled, "codex"))
      .toBe(createProfileContentHash(disabled, "codex"));
    expect(createProfileContentHash(enabled, "codex"))
      .not.toBe(createProfileContentHash(anotherServer, "codex"));
  });

  it("tracks category management while excluding content that is not managed", () => {
    const managed = profile("ignore", true);
    managed.resources.skills = [
      { libraryId: "reviewer", targetName: "reviewer", enabled: true }
    ];
    managed.resources.managementByTarget = {
      codex: { instructions: "manage", skills: "manage" }
    };
    const ignored: ProfileDetail = {
      ...managed,
      resources: {
        ...managed.resources,
        managementByTarget: {
          codex: { instructions: "ignore", skills: "ignore" }
        }
      }
    };
    const changedIgnoredContent: ProfileDetail = {
      ...ignored,
      instructions: "# Local-only draft\n",
      resources: {
        ...ignored.resources,
        skills: [{ libraryId: "other", targetName: "other", enabled: true }]
      }
    };

    expect(createProfileContentHash(managed, "codex"))
      .not.toBe(createProfileContentHash(ignored, "codex"));
    expect(createProfileContentHash(ignored, "codex"))
      .toBe(createProfileContentHash(changedIgnoredContent, "codex"));
  });

  it("keeps disabled Skill identities in the Target fingerprint but ignores saved enable flags", () => {
    const disabled = profile("ignore", true);
    disabled.resources.skills = [
      { libraryId: "reviewer", targetName: "reviewer", enabled: true }
    ];
    disabled.resources.managementByTarget = {
      codex: { instructions: "disable", skills: "disable" }
    };
    const savedOff = {
      ...disabled,
      resources: {
        ...disabled.resources,
        skills: disabled.resources.skills.map((reference) => ({
          ...reference,
          enabled: false
        }))
      }
    };
    const renamed = {
      ...disabled,
      resources: {
        ...disabled.resources,
        skills: [{ libraryId: "reviewer", targetName: "reviewer-v2", enabled: true }]
      }
    };

    expect(createProfileContentHash(disabled, "codex"))
      .toBe(createProfileContentHash(savedOff, "codex"));
    expect(createProfileContentHash(disabled, "codex"))
      .not.toBe(createProfileContentHash(renamed, "codex"));
  });

  it("changes when a managed Skill Group gate changes", () => {
    const enabled = profile("ignore", true);
    enabled.resources.skills = [{
      libraryId: "reviewer",
      targetName: "reviewer",
      enabled: true,
      direct: false,
      groupIds: ["manual-group-review"]
    }];
    enabled.resources.skillGroups = [{
      id: "manual-group-review",
      kind: "manual",
      groupId: "group-review",
      name: "Review",
      enabled: true,
      memberIds: ["reviewer"]
    }];
    enabled.resources.managementByTarget = {
      codex: { instructions: "manage", skills: "manage" }
    };
    const disabled = {
      ...enabled,
      resources: {
        ...enabled.resources,
        skillGroups: enabled.resources.skillGroups.map((group) => ({ ...group, enabled: false }))
      }
    };

    expect(createProfileContentHash(enabled, "codex"))
      .not.toBe(createProfileContentHash(disabled, "codex"));
  });

  it("treats removing an off Skill Group as the same deployed Skill state", () => {
    const grouped = profile("ignore", true);
    grouped.resources.skills = [{
      libraryId: "reviewer",
      targetName: "reviewer",
      enabled: true,
      direct: false,
      groupIds: ["manual-group-review"]
    }];
    grouped.resources.skillGroups = [{
      id: "manual-group-review",
      kind: "manual",
      groupId: "group-review",
      name: "Review",
      enabled: false,
      memberIds: ["reviewer"]
    }];
    grouped.resources.managementByTarget = {
      codex: { instructions: "manage", skills: "manage" }
    };
    const removed = {
      ...grouped,
      resources: {
        ...grouped.resources,
        skills: [],
        skillGroups: []
      }
    };

    expect(createProfileContentHash(grouped, "codex"))
      .toBe(createProfileContentHash(removed, "codex"));
  });
});
