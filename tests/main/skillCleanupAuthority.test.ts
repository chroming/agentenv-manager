import { describe, expect, it } from "vitest";
import { isSkillCleanupPathAllowed } from "../../src/main/skillCleanupAuthority";
import type { TargetPaths } from "../../src/shared/types";

const targetPaths = (scanDepth: "direct" | "recursive"): TargetPaths => ({
  targetId: "fixture-agent",
  configDir: "/tmp/fixture",
  instructionsPath: "/tmp/fixture/AGENTS.md",
  configPath: "/tmp/fixture/config.json",
  skillsDir: "/tmp/fixture/skills",
  skillLocations: [{
    path: "/tmp/fixture/skills",
    role: "preferred-runtime",
    shared: false,
    scanDepth,
    management: "managed"
  }]
});

describe("Skill cleanup path authority", () => {
  it("allows a nested Skill only when the Agent declares recursive discovery", () => {
    const nested = "/tmp/fixture/skills/team/reviewer";

    expect(isSkillCleanupPathAllowed(targetPaths("recursive"), nested)).toBe(true);
    expect(isSkillCleanupPathAllowed(targetPaths("direct"), nested)).toBe(false);
  });

  it("never grants authority over the Skill root itself or a sibling path", () => {
    expect(isSkillCleanupPathAllowed(targetPaths("recursive"), "/tmp/fixture/skills"))
      .toBe(false);
    expect(isSkillCleanupPathAllowed(targetPaths("recursive"), "/tmp/fixture/other/reviewer"))
      .toBe(false);
  });
});
