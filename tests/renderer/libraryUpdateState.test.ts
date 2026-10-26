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
  it("does not mark preserved copies or their owning Targets as up to date", () => {
    const skippedPath = "/claude/reviewer";
    const result = [{ ...updated[0]!, skippedAgentCopies: [{ path: skippedPath, targetIds: ["claude-code"] }] }];
    const inventory = ["opencode", "claude-code"].map((targetId) => ({
      id: "reviewer", name: "Reviewer", description: "", path: targetId === "claude-code" ? skippedPath : "/opencode/reviewer",
      foundIn: [targetId], status: "managed", libraryId: "reviewer", skillKey: "reviewer",
      contentHash: "previous", installMethod: "copied", contentMatchesLibrary: true
    })) as SkillInventoryEntry[];
    const next = updateSkillInventoryAfterLibraryUpdate(inventory, result, true);
    expect(next[0]).toMatchObject({ contentHash: "next", contentMatchesLibrary: true });
    expect(next[1]).toMatchObject({ contentHash: "previous", contentMatchesLibrary: false });
    const states = ["opencode", "claude-code"].map((targetId) => ({
      targetId, status: "managed", lifecycleStatus: "applied", managedResourceCount: 1, warningCount: 0, errorCount: 0,
      appliedLibraryVersions: { skills: { reviewer: "previous" } }
    })) as TargetManagementState[];
    const nextStates = updateAppliedTargetLibraryVersions(states, result, inventory, true);
    expect(nextStates[0]?.appliedLibraryVersions?.skills.reviewer).toBe("next");
    expect(nextStates[1]?.appliedLibraryVersions?.skills.reviewer).toBe("previous");
  });
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
