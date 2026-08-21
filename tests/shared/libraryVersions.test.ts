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

  it("does not make a Target stale when Skill management is off", () => {
    const profile = {
      resources: {
        skills: [{ libraryId: "enabled", targetName: "enabled", enabled: true }],
        managementByTarget: {
          opencode: { instructions: "manage", skills: "ignore" }
        },
        mcpByTarget: {}
      }
    } as Pick<ProfileDetail, "resources">;
    const skills = [
      { id: "enabled", contentHash: "enabled-hash" }
    ] as SkillLibraryEntry[];

    expect(collectLibraryResourceVersions(profile, skills, "opencode")).toEqual({
      skills: {}
    });
  });

  it("does not make a disabled Skill category stale when Library content changes", () => {
    const profile = {
      resources: {
        skills: [{ libraryId: "enabled", targetName: "enabled", enabled: true }],
        managementByTarget: {
          opencode: { instructions: "manage", skills: "disable" }
        },
        mcpByTarget: {}
      }
    } as Pick<ProfileDetail, "resources">;
    const skills = [
      { id: "enabled", contentHash: "enabled-hash" }
    ] as SkillLibraryEntry[];

    expect(collectLibraryResourceVersions(profile, skills, "opencode")).toEqual({
      skills: {}
    });
  });

  it("does not track Library revisions hidden by a disabled Skill Group", () => {
    const profile = {
      resources: {
        skills: [{
          libraryId: "enabled",
          targetName: "enabled",
          enabled: true,
          direct: false,
          groupIds: ["manual-group-review"]
        }],
        skillGroups: [{
          id: "manual-group-review",
          kind: "manual",
          groupId: "group-review",
          name: "Review",
          enabled: false,
          memberIds: ["enabled"]
        }],
        mcpByTarget: {}
      }
    } as Pick<ProfileDetail, "resources">;

    expect(collectLibraryResourceVersions(profile, [{
      id: "enabled",
      contentHash: "enabled-hash"
    } as SkillLibraryEntry])).toEqual({ skills: {} });
  });
});
