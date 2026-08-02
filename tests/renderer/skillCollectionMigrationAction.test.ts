import { describe, expect, it, vi } from "vitest";
import { runSkillCollectionMigration } from "../../src/renderer/skillCollectionMigrationAction";
import type { SkillCollectionLinkGroup } from "../../src/shared/skillCleanup";
import type { AgentEnvApi, TargetManagementState } from "../../src/shared/types";

const collection = {
  path: "/tmp/.agents/skills/suite",
  canonicalPath: "/tmp/source/skills",
  name: "suite",
  consumerTargetIds: ["codex"],
  state: "ready",
  libraryReadyCount: 1,
  conflictCount: 0,
  items: [{
    name: "review",
    skillKey: "review",
    path: "/tmp/source/skills/review",
    libraryId: "review",
    contentMatchesLibrary: true,
    foundIn: ["codex"]
  }]
} as SkillCollectionLinkGroup;

const targetStates = [{
  targetId: "codex",
  activeProfileId: "daily-coding",
  status: "managed",
  lifecycleStatus: "pending",
  managedResourceCount: 1,
  warningCount: 0,
  errorCount: 0
}] satisfies TargetManagementState[];

const input = (saveDirtyProfile = vi.fn().mockResolvedValue(undefined)) => ({
  api: {} as AgentEnvApi,
  collection,
  targetStates,
  dirtyProfileId: "daily-coding",
  saveDirtyProfile,
  setBusy: vi.fn(),
  setResult: vi.fn(),
  setSuccess: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined)
});

describe("runSkillCollectionMigration", () => {
  it("returns an in-dialog save prerequisite without starting migration", async () => {
    const action = input();

    await expect(runSkillCollectionMigration(action)).resolves.toEqual({
      status: "needs-save",
      message: "The active Profile has unsaved edits. Save them before moving this collection."
    });
    expect(action.saveDirtyProfile).not.toHaveBeenCalled();
    expect(action.setBusy).not.toHaveBeenCalled();
  });

  it("keeps a failed save in the parent workflow instead of global feedback", async () => {
    const action = input(vi.fn().mockRejectedValue(new Error("Profile could not be saved")));

    await expect(runSkillCollectionMigration(action, {
      saveDirtyProfile: true
    })).resolves.toEqual({
      status: "blocked",
      message: "Profile could not be saved"
    });
    expect(action.setBusy).not.toHaveBeenCalled();
  });
});
