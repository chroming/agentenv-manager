import { describe, expect, it } from "vitest";
import {
  updateAppliedTargetLibraryVersions,
  updateSkillInventoryAfterLibraryUpdate,
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
  it("marks copied installs pending while advancing the desired Profile version", () => {
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
    expect(updateSkillInventoryAfterLibraryUpdate(inventory, updated)[0]).toMatchObject({
      contentHash: "previous",
      contentMatchesLibrary: false
    });
    expect(updateProfileLibraryVersions({
      daily: { skills: { reviewer: "previous", other: "same" } }
    }, updated)).toEqual({
      daily: { skills: { reviewer: "next", other: "same" } }
    });
  });

  it("advances only linked Target versions without hiding unrelated drift", () => {
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

    const linkedInventory = [{
      id: "reviewer",
      name: "Reviewer",
      description: "",
      path: "/target/reviewer",
      foundIn: ["opencode"],
      status: "managed",
      libraryId: "reviewer",
      skillKey: "reviewer",
      contentHash: "previous",
      installMethod: "linked",
      contentMatchesLibrary: true
    }] as SkillInventoryEntry[];

    expect(updateAppliedTargetLibraryVersions(states, updated, linkedInventory)[0]).toMatchObject({
      lifecycleStatus: "drifted",
      lifecycleReason: "Instructions changed",
      appliedLibraryVersions: { skills: { reviewer: "next" } }
    });

    linkedInventory[0]!.installMethod = "copied";
    expect(updateAppliedTargetLibraryVersions(states, updated, linkedInventory)[0])
      .toMatchObject({ appliedLibraryVersions: { skills: { reviewer: "previous" } } });
    expect(updateAppliedTargetLibraryVersions(states, updated, linkedInventory, true)[0])
      .toMatchObject({ appliedLibraryVersions: { skills: { reviewer: "next" } } });
  });
});
