import { describe, expect, it } from "vitest";
import {
  materializeTargetResourcePolicy,
  profileManagesResource,
  profileResourceMode,
  profileUsesResource,
  setProfileResourceMode
} from "../../src/shared/profileResources";
import type { ProfileDetail, ProfileResources } from "../../src/shared/types";

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

  it("keeps disabled categories managed while withholding their saved content", () => {
    const profile: ProfileDetail = {
      id: "daily",
      manifest: {
        id: "daily",
        name: "Daily",
        description: "",
        version: 2
      },
      instructions: "# Saved instructions\n",
      resources: {
        skills: [{ libraryId: "reviewer", targetName: "reviewer", enabled: true }],
        managementByTarget: {
          opencode: { instructions: "disable", skills: "disable" }
        },
        mcpByTarget: {
          opencode: {
            mode: "disable",
            selections: [{ name: "docs", enabled: true }]
          }
        }
      }
    };

    expect(profileManagesResource(profile.resources, "opencode", "skills")).toBe(true);
    expect(profileUsesResource(profile.resources, "opencode", "skills")).toBe(false);

    const effective = materializeTargetResourcePolicy(profile, "opencode");

    expect(effective.instructions).toBe("");
    expect(effective.resources.skills).toEqual([
      { libraryId: "reviewer", targetName: "reviewer", enabled: false }
    ]);
    expect(effective.resources.mcpByTarget.opencode).toEqual({
      mode: "manage",
      selections: [{ name: "docs", enabled: false }]
    });
    expect(profile.instructions).toBe("# Saved instructions\n");
    expect(profile.resources.skills[0].enabled).toBe(true);
  });
});
