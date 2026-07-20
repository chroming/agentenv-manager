import { describe, expect, it } from "vitest";
import {
  profileResourceMode,
  setProfileResourceMode
} from "../../src/shared/profileResources";
import type { ProfileResources } from "../../src/shared/types";

const resources: ProfileResources = { skills: [], mcpByTarget: {} };

describe("Profile resource management", () => {
  it("manages Instructions and Skills by default while leaving MCPs alone", () => {
    expect(profileResourceMode(resources, "opencode", "instructions")).toBe("manage");
    expect(profileResourceMode(resources, "opencode", "skills")).toBe("manage");
    expect(profileResourceMode(resources, "opencode", "mcp")).toBe("ignore");
  });

  it("stores modes per Agent without removing configured resources", () => {
    const configured: ProfileResources = {
      skills: [{ libraryId: "reviewer", targetName: "reviewer", enabled: true }],
      mcpByTarget: {
        opencode: {
          mode: "manage",
          selections: [{ name: "docs", enabled: true }]
        }
      }
    };
    const pausedSkills = setProfileResourceMode(configured, "opencode", "skills", "ignore");
    const pausedMcp = setProfileResourceMode(pausedSkills, "opencode", "mcp", "ignore");

    expect(pausedMcp.skills).toEqual(configured.skills);
    expect(pausedMcp.mcpByTarget.opencode.selections).toEqual(
      configured.mcpByTarget.opencode.selections
    );
    expect(profileResourceMode(pausedMcp, "opencode", "skills")).toBe("ignore");
    expect(profileResourceMode(pausedMcp, "opencode", "mcp")).toBe("ignore");
    expect(profileResourceMode(pausedMcp, "codex", "skills")).toBe("manage");
  });
});
