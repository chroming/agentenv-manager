import { describe, expect, it } from "vitest";
import { isExternalSkillImportable } from "../../src/shared/skillIdentity";

describe("Skill identity helpers", () => {
  it("uses the declared external-owner import capability without manager-specific branching", () => {
    expect(isExternalSkillImportable({
      manager: "agent-builtin",
      displayName: "Example Agent package",
      importable: true,
      canonicalPath: "/example/skill",
      confidence: "confirmed",
      state: "healthy"
    })).toBe(true);
    expect(isExternalSkillImportable({
      manager: "claude-plugin",
      displayName: "Claude Code plugin",
      importable: false,
      canonicalPath: "/example/plugin-skill",
      confidence: "confirmed",
      state: "healthy"
    })).toBe(false);
  });

  it("keeps legacy Skills CLI observations importable", () => {
    expect(isExternalSkillImportable({
      manager: "skills-cli",
      canonicalPath: "/example/legacy-skill",
      confidence: "confirmed",
      state: "healthy"
    })).toBe(true);
  });
});
