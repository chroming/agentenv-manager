import { describe, expect, it } from "vitest";
import {
  AssetPolicySchema,
  ProfileManifestSchema
} from "../../src/shared/schemas";

describe("profile schemas", () => {
  it("accepts a valid manifest", () => {
    expect(
      ProfileManifestSchema.parse({
        id: "daily-coding",
        targetId: "opencode",
        name: "Daily Coding",
        description: "Default coding environment.",
        version: 1,
        managed: { instructions: true, config: true, assets: true }
      }).id
    ).toBe("daily-coding");
  });

  it("rejects ids with path separators", () => {
    expect(() =>
      ProfileManifestSchema.parse({
        id: "../bad",
        targetId: "opencode",
        name: "Bad",
        description: "",
        version: 1,
        managed: { instructions: true, config: true, assets: true }
      })
    ).toThrow();
  });

  it("accepts explicit owned asset targets", () => {
    expect(
      AssetPolicySchema.parse({
        ownedDirs: [
          {
            kind: "skill",
            source: "skills/example",
            targetName: "agentenv-daily-example"
          }
        ],
        disabledSkillPaths: ["/Users/example/.agents/skills/old/SKILL.md"]
      }).ownedDirs
    ).toHaveLength(1);
  });
});
