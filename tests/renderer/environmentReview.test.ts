import { describe, expect, it } from "vitest";
import type {
  ProfileSummary,
  SkillInventoryEntry,
  TargetManagementState
} from "../../src/shared/types";
import { deriveEnvironmentReview } from "../../src/renderer/environmentReview";

const profile: ProfileSummary = {
  id: "daily",
  name: "Daily",
  description: "",
  createdAt: "2026-07-28T00:00:00.000Z"
};

const targetState = (
  lifecycleStatus: TargetManagementState["lifecycleStatus"]
): TargetManagementState => ({
  targetId: "opencode",
  status: lifecycleStatus === "unmanaged" ? "unmanaged" : "managed",
  lifecycleStatus,
  managedResourceCount: 0,
  warningCount: 0,
  errorCount: 0
});

const sharedSkill = (
  overrides: Partial<SkillInventoryEntry> = {}
): SkillInventoryEntry => ({
  id: "shared-review",
  name: "Shared review",
  description: "",
  path: "/home/.agents/skills/shared-review",
  foundIn: ["opencode", "codex"],
  status: "outside",
  skillKey: "shared-review",
  contentHash: "hash",
  sharedLocation: true,
  sharedLocationId: "agents-skills",
  locationManagement: "migration-only",
  ...overrides
});

const derive = (
  overrides: Partial<Parameters<typeof deriveEnvironmentReview>[0]> = {}
) =>
  deriveEnvironmentReview({
    scanStatus: "ready",
    inventory: [],
    installedTargetIds: ["opencode"],
    profiles: [profile],
    targetStates: [targetState("applied")],
    ...overrides
  });

describe("environment review", () => {
  it("keeps the stable shell in a checking state while inventory loads", () => {
    expect(derive({ scanStatus: "checking" }).state).toBe("checking");
  });

  it("prioritizes actionable shared compatibility Skills", () => {
    const result = derive({
      inventory: [sharedSkill()],
      installedTargetIds: ["opencode", "codex"]
    });

    expect(result).toMatchObject({
      state: "shared-review",
      sharedSkillCount: 1,
      sharedAutomaticCount: 1,
      affectedTargetIds: ["codex", "opencode"]
    });
  });

  it("does not reopen review for a shared path explicitly kept outside", () => {
    const result = derive({
      inventory: [
        sharedSkill({
          status: "kept-outside",
          pathPolicy: "keep-shared"
        })
      ]
    });

    expect(result.state).toBe("ready");
    expect(result.sharedSkillCount).toBe(0);
  });

  it("shows first setup only after local inventory is ready", () => {
    expect(derive({ profiles: [] }).state).toBe("setup");
  });

  it("separates stable outside resources from Agents that require review", () => {
    expect(
      derive({ targetStates: [targetState("applied-with-outside")] })
    ).toMatchObject({
      state: "ready-with-outside",
      attentionTargetIds: [],
      outsideResourceTargetIds: ["opencode"]
    });
    expect(
      derive({ targetStates: [targetState("pending")] }).state
    ).toBe("agent-review");
    expect(
      derive({
        installedTargetIds: ["opencode", "codex"],
        targetStates: [
          targetState("applied-with-outside"),
          { ...targetState("pending"), targetId: "codex" }
        ]
      })
    ).toMatchObject({
      state: "agent-review",
      attentionTargetIds: ["codex"],
      outsideResourceTargetIds: ["opencode"]
    });
  });

  it("reports no Agents separately from first setup", () => {
    expect(
      derive({ installedTargetIds: [], profiles: [], targetStates: [] }).state
    ).toBe("no-agents");
  });
});
