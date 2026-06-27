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
    const policy = AssetPolicySchema.parse({
        ownedDirs: [
          {
            kind: "skill",
            source: "skills/example",
            targetName: "agentenv-daily-example"
          }
        ],
        ownedFiles: [
          {
            kind: "agent",
            source: "agents/reviewer.toml",
            targetName: "reviewer.toml"
          }
        ],
        skillRefs: [
          {
            libraryId: "shared-reviewer",
            targetName: "agentenv-shared-reviewer"
          }
        ],
        mcpRefs: [
          {
            libraryId: "context7",
            targetName: "context7"
          }
        ],
        disabledSkillPaths: ["/Users/example/.agents/skills/old/SKILL.md"]
      });

    expect(policy.ownedDirs).toHaveLength(1);
    expect(policy.ownedFiles).toEqual([
      {
        kind: "agent",
        source: "agents/reviewer.toml",
        targetName: "reviewer.toml"
      }
    ]);
    expect(policy.skillRefs).toEqual([
      {
        libraryId: "shared-reviewer",
        targetName: "agentenv-shared-reviewer"
      }
    ]);
    expect(policy.mcpRefs).toEqual([
      {
        libraryId: "context7",
        targetName: "context7"
      }
    ]);
  });
});
