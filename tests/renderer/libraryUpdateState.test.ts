import { describe, expect, it } from "vitest";
import {
  updateAppliedTargetLibraryVersions,
  updateCopiedSkillInventory,
  updateProfileLibraryVersions
} from "../../src/renderer/libraryUpdateState";
import type {
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetManagementState
} from "../../src/shared/types";

const updated = [{
  id: "reviewer",
  name: "Reviewer",
  description: "",
  path: "/library/reviewer",
  sourceType: "local",
  source: "/source/reviewer",
  updatePolicy: "tracked",
  contentHash: "next"
}] as SkillLibraryEntry[];

describe("Library update renderer state", () => {
  it("keeps copied installs and persisted version summaries current", () => {
    const inventory = [{
      id: "reviewer",
      name: "Reviewer",
      description: "",
      path: "/target/reviewer",
      foundIn: ["opencode"],
      status: "managed",
      libraryId: "reviewer",
      skillKey: "reviewer",
      contentHash: "previous",
      installMethod: "copied",
      contentMatchesLibrary: true
    }] as SkillInventoryEntry[];
    expect(updateCopiedSkillInventory(inventory, updated)[0]).toMatchObject({
      contentHash: "next",
      contentMatchesLibrary: true
    });
    expect(updateProfileLibraryVersions({
      daily: { skills: { reviewer: "previous", other: "same" } }
    }, updated)).toEqual({
      daily: { skills: { reviewer: "next", other: "same" } }
    });
  });

  it("advances an affected Target version without hiding unrelated drift", () => {
    const states = [{
      targetId: "opencode",
      status: "managed",
      lifecycleStatus: "drifted",
      lifecycleReason: "Instructions changed",
      managedResourceCount: 2,
      warningCount: 0,
      errorCount: 1,
      appliedLibraryVersions: { skills: { reviewer: "previous" } }
    }] as TargetManagementState[];

    expect(updateAppliedTargetLibraryVersions(states, updated)[0]).toMatchObject({
      lifecycleStatus: "drifted",
      lifecycleReason: "Instructions changed",
      appliedLibraryVersions: { skills: { reviewer: "next" } }
    });
  });
});
