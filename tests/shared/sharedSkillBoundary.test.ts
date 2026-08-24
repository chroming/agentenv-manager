import { describe, expect, it } from "vitest";
import {
  profileSharedSkillBoundary
} from "../../src/shared/sharedSkillBoundary";
import type {
  ProfileDetail,
  SkillInventoryEntry,
  SkillLibraryEntry
} from "../../src/shared/types";

const librarySkill: SkillLibraryEntry = {
  id: "review",
  name: "Code Review",
  description: "Review code",
  path: "/library/review",
  sourceType: "local",
  updatePolicy: "untracked",
  contentHash: "review-hash",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const profile = (enabled = true): ProfileDetail => ({
  id: "daily-coding",
  manifest: {
    version: 2,
    id: "daily-coding",
    name: "Daily Coding",
    description: "Daily work",
    createdAt: "2026-08-18T00:00:00.000Z"
  },
  instructions: "",
  resources: {
    skills: [{ libraryId: "review", targetName: "review", enabled }],
    managementByTarget: {
      opencode: { instructions: "manage", skills: "manage" }
    },
    mcpByTarget: {}
  },
  contentHash: "profile-hash"
});

const sharedSkill = (
  overrides: Partial<SkillInventoryEntry> = {}
): SkillInventoryEntry => ({
  id: "review",
  name: "Code Review",
  description: "Review code",
  path: "/home/test/.agents/skills/review",
  foundIn: ["opencode"],
  status: "managed",
  skillKey: "review",
  runtimeName: "review",
  deploymentName: "review",
  runtimeAvailability: "enabled",
  runtimeConfidence: "verified",
  runtimeStates: [{
    targetId: "opencode",
    availability: "enabled",
    confidence: "verified",
    issues: []
  }],
  contentHash: "review-hash",
  contentMatchesLibrary: true,
  sharedLocation: true,
  sharedLocationId: "agents-skills",
  managedAsShared: true,
  libraryId: "review",
  ...overrides
});

describe("profileSharedSkillBoundary", () => {
  it("treats a matching managed shared copy as active without requiring migration", () => {
    expect(profileSharedSkillBoundary({
      profile: profile(),
      targetId: "opencode",
      policy: "manage",
      inventory: [sharedSkill()],
      librarySkills: [librarySkill]
    })).toEqual({
      activeLibraryIds: ["review"],
      activePaths: ["/home/test/.agents/skills/review"],
      allActiveManaged: true,
      migrationPaths: [],
      retainedPaths: []
    });
  });

  it("requires migration when the Profile wants an active shared Skill turned off", () => {
    expect(profileSharedSkillBoundary({
      profile: profile(false),
      targetId: "opencode",
      policy: "manage",
      inventory: [sharedSkill()],
      librarySkills: [librarySkill]
    }).migrationPaths).toEqual(["/home/test/.agents/skills/review"]);
  });

  it("keeps an unclaimed shared copy in takeover review even when its content matches", () => {
    expect(profileSharedSkillBoundary({
      profile: profile(),
      targetId: "opencode",
      policy: "manage",
      inventory: [sharedSkill({
        status: "library",
        managedAsShared: false
      })],
      librarySkills: [librarySkill]
    }).migrationPaths).toEqual(["/home/test/.agents/skills/review"]);
  });

  it("keeps an explicit outside decision out of migration candidates", () => {
    expect(profileSharedSkillBoundary({
      profile: profile(false),
      targetId: "opencode",
      policy: "manage",
      inventory: [sharedSkill({
        status: "left-unmanaged",
        managedAsShared: false,
        unmanagedCoverage: "exact"
      })],
      librarySkills: [librarySkill]
    })).toEqual({
      activeLibraryIds: [],
      activePaths: [],
      allActiveManaged: false,
      migrationPaths: [],
      retainedPaths: ["/home/test/.agents/skills/review"]
    });
  });

  it("does not ask the Profile to migrate a compatibility copy shadowed by its Target", () => {
    expect(profileSharedSkillBoundary({
      profile: profile(false),
      targetId: "opencode",
      policy: "manage",
      inventory: [sharedSkill({
        path: "/home/test/.claude/skills/review",
        sharedLocation: false,
        sharedLocationId: undefined,
        status: "left-unmanaged",
        managedAsShared: false,
        runtimeStates: [{
          targetId: "opencode",
          availability: "shadowed",
          confidence: "verified",
          issues: []
        }]
      })],
      librarySkills: [librarySkill]
    })).toEqual({
      activeLibraryIds: [],
      activePaths: [],
      allActiveManaged: false,
      migrationPaths: [],
      retainedPaths: []
    });
  });

  it("does not treat an Agent compatibility directory as a shared location", () => {
    expect(profileSharedSkillBoundary({
      profile: profile(false),
      targetId: "opencode",
      policy: "manage",
      inventory: [sharedSkill({
        path: "/home/test/.claude/skills/review",
        sharedLocationId: undefined,
        managedAsShared: false
      })],
      librarySkills: [librarySkill]
    })).toEqual({
      activeLibraryIds: [],
      activePaths: [],
      allActiveManaged: false,
      migrationPaths: [],
      retainedPaths: []
    });
  });
});
