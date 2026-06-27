import { describe, expect, it } from "vitest";
import {
  ProfileManifestSchema,
  SkillsPolicySchema
} from "../../src/shared/schemas";

describe("profile schemas", () => {
  it("accepts a valid manifest", () => {
    expect(
      ProfileManifestSchema.parse({
        id: "daily-coding",
        name: "Daily Coding",
        description: "Default coding environment.",
        version: 1,
        managed: { agents: true, mcp: true, skills: true }
      }).id
    ).toBe("daily-coding");
  });

  it("rejects ids with path separators", () => {
    expect(() =>
      ProfileManifestSchema.parse({
        id: "../bad",
        name: "Bad",
        description: "",
        version: 1,
        managed: { agents: true, mcp: true, skills: true }
      })
    ).toThrow();
  });

  it("accepts explicit owned skill targets", () => {
    expect(
      SkillsPolicySchema.parse({
        ownedSkillDirs: [
          { source: "skills/example", targetName: "agentenv-daily-example" }
        ],
        disabledSkillPaths: ["/Users/example/.agents/skills/old/SKILL.md"]
      }).ownedSkillDirs
    ).toHaveLength(1);
  });
});
