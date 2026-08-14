import { describe, expect, it } from "vitest";
import { profileWithoutLocalSkillOverrides } from "../../src/shared/effectiveProfile";
import type { ProfileDetail } from "../../src/shared/types";

const profile: ProfileDetail = {
  id: "daily",
  manifest: {
    id: "daily",
    name: "Daily",
    description: "",
    version: 2
  },
  instructions: "",
  resources: {
    skills: [
      { libraryId: "reviewer", targetName: "reviewer", enabled: true },
      { libraryId: "reviewer", targetName: "reviewer-copy", enabled: true },
      { libraryId: "tests", targetName: "tests", enabled: true }
    ],
    mcpByTarget: {}
  }
};

describe("effective Profile", () => {
  it("excludes only concrete local overrides or deferred Skill references", () => {
    const effective = profileWithoutLocalSkillOverrides(
      profile,
      [{
        path: "/target/reviewer",
        libraryId: "reviewer",
        targetName: "reviewer",
        desired: "install",
        observed: "external",
        authority: "leave-unmanaged",
        action: "preserve",
        outcome: "external-active",
        requiresReview: false,
        localOverride: true
      }],
      [{
        skillKey: "tests",
        libraryId: "tests",
        sharedPaths: ["/shared/tests"],
        targetName: "tests",
        disposition: "install",
        profileId: "daily",
        profileHash: "hash"
      }]
    );

    expect(effective.resources.skills).toEqual([
      { libraryId: "reviewer", targetName: "reviewer-copy", enabled: true }
    ]);
  });

  it("keeps an active managed Skill while its shared copy still awaits migration", () => {
    const effective = profileWithoutLocalSkillOverrides(
      profile,
      [{
        path: "/target/tests",
        libraryId: "tests",
        targetName: "tests",
        desired: "install",
        observed: "managed",
        authority: "agentenv",
        action: "none",
        outcome: "managed-active",
        requiresReview: false,
        localOverride: false
      }],
      [{
        skillKey: "tests",
        libraryId: "tests",
        sharedPaths: ["/shared/tests"],
        targetName: "tests",
        disposition: "install",
        profileId: "daily",
        profileHash: "hash"
      }],
      { skills: { tests: "tests-hash" } }
    );

    expect(effective.resources.skills).toContainEqual(
      { libraryId: "tests", targetName: "tests", enabled: true }
    );
  });
});
