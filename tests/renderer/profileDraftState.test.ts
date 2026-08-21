import { describe, expect, it } from "vitest";
import type { ProfileDetail } from "../../src/shared/types";
import { setProfileResourceMode } from "../../src/shared/profileResources";
import { setProfileSkillGroupEnabled } from "../../src/shared/profileSkillGroups";
import { profileDraftsEqual } from "../../src/renderer/profileDraftState";

const profile = (): ProfileDetail => ({
  id: "daily",
  manifest: {
    id: "daily",
    name: "Daily",
    description: "",
    version: 2
  },
  instructions: "# Daily\n",
  resources: {
    skills: [{
      libraryId: "reviewer",
      targetName: "reviewer",
      enabled: true
    }],
    mcpByTarget: {}
  },
  contentHash: "saved"
});

describe("profileDraftsEqual", () => {
  it("treats explicit default Target policies as their omitted representation", () => {
    const saved = profile();
    const instructionsRestored = setProfileResourceMode(
      setProfileResourceMode(saved.resources, "opencode", "instructions", "disable"),
      "opencode",
      "instructions",
      "manage"
    );
    const skillsRestored = setProfileResourceMode(
      setProfileResourceMode(instructionsRestored, "opencode", "skills", "disable"),
      "opencode",
      "skills",
      "manage"
    );
    const mcpRestored = setProfileResourceMode(
      setProfileResourceMode(skillsRestored, "opencode", "mcp", "disable"),
      "opencode",
      "mcp",
      "ignore"
    );

    expect(profileDraftsEqual(saved, {
      ...saved,
      resources: mcpRestored
    })).toBe(true);
  });

  it("still detects effective Instructions, Skill, and MCP changes", () => {
    const saved = profile();
    expect(profileDraftsEqual(saved, {
      ...saved,
      instructions: "# Changed\n"
    })).toBe(false);
    expect(profileDraftsEqual(saved, {
      ...saved,
      resources: {
        ...saved.resources,
        instructions: [{ libraryId: "shared-rules", enabled: true }]
      }
    })).toBe(false);
    expect(profileDraftsEqual(saved, {
      ...saved,
      resources: {
        ...saved.resources,
        skills: [{ ...saved.resources.skills[0]!, enabled: false }]
      }
    })).toBe(false);
    expect(profileDraftsEqual(saved, {
      ...saved,
      resources: setProfileResourceMode(
        saved.resources,
        "opencode",
        "mcp",
        "disable"
      )
    })).toBe(false);
  });

  it("detects a Skill Group gate change without changing member preferences", () => {
    const saved = profile();
    saved.resources = {
      ...saved.resources,
      skills: [{
        ...saved.resources.skills[0]!,
        direct: false,
        groupIds: ["manual-review-tools"]
      }],
      skillGroups: [{
        id: "manual-review-tools",
        kind: "manual",
        groupId: "review-tools",
        name: "Review tools",
        enabled: true,
        memberIds: ["reviewer"]
      }]
    };

    const disabled = setProfileSkillGroupEnabled(
      saved.resources,
      "manual-review-tools",
      false
    );
    expect(disabled.skills[0]?.enabled).toBe(true);
    expect(profileDraftsEqual(saved, { ...saved, resources: disabled })).toBe(false);

    const restored = setProfileSkillGroupEnabled(
      disabled,
      "manual-review-tools",
      true
    );
    expect(restored.skills[0]?.enabled).toBe(true);
    expect(profileDraftsEqual(saved, { ...saved, resources: restored })).toBe(true);
  });
});
