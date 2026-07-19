import { describe, expect, it } from "vitest";
import { collectLibraryResourceVersions } from "../../src/shared/libraryVersions";
import type { ProfileDetail, SkillLibraryEntry } from "../../src/shared/types";

describe("library resource versions", () => {
  it("tracks only Profile-enabled and globally enabled Skills", () => {
    const profile = {
      resources: {
        skills: [
          { libraryId: "enabled", targetName: "enabled", enabled: true },
          { libraryId: "profile-disabled", targetName: "profile-disabled", enabled: false },
          { libraryId: "global-disabled", targetName: "global-disabled", enabled: true }
        ],
        mcpByTarget: {}
      }
    } as Pick<ProfileDetail, "resources">;
    const skills = [
      { id: "enabled", contentHash: "enabled-hash" },
      { id: "profile-disabled", contentHash: "profile-disabled-hash" },
      { id: "global-disabled", contentHash: "global-disabled-hash", globallyEnabled: false }
    ] as SkillLibraryEntry[];

    expect(collectLibraryResourceVersions(profile, skills)).toEqual({
      skills: { enabled: "enabled-hash" }
    });
  });
});
