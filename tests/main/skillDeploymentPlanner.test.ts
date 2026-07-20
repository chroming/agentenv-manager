import { describe, expect, it } from "vitest";
import {
  buildSkillDeploymentPlan,
  fingerprintSkillInventory
} from "../../src/main/skillDeploymentPlanner";
import type {
  ProfileDetail,
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetPaths
} from "../../src/shared/types";

const librarySkill = (
  overrides: Partial<SkillLibraryEntry> = {}
): SkillLibraryEntry => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Review code",
  path: "/data/skills-library/reviewer",
  sourceType: "local",
  updatePolicy: "untracked",
  contentHash: "library-hash",
  updatedAt: "2026-07-20T00:00:00.000Z",
  ...overrides
});

const profile = (
  overrides: Partial<ProfileDetail["resources"]["skills"][number]> = {}
): ProfileDetail => ({
  id: "daily",
  manifest: {
    id: "daily",
    name: "Daily",
    description: "",
    preferredTargetId: "codex",
    version: 2
  },
  instructions: "# Daily\n",
  resources: {
    skills: [{ libraryId: "reviewer", targetName: "reviewer", enabled: true, ...overrides }],
    mcpByTarget: {}
  }
});

const targetPaths = (
  targetId = "codex"
): TargetPaths => ({
  targetId,
  configDir: `/home/.${targetId}`,
  instructionsPath: `/home/.${targetId}/AGENTS.md`,
  configPath: `/home/.${targetId}/config`,
  skillsDir: `/home/.${targetId}/skills`
});

const inventoryEntry = (
  overrides: Partial<SkillInventoryEntry> = {}
): SkillInventoryEntry => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Review code",
  path: "/home/.codex/skills/reviewer",
  foundIn: ["codex"],
  status: "library",
  libraryId: "reviewer",
  skillKey: "reviewer",
  runtimeName: "Reviewer",
  deploymentName: "reviewer",
  runtimeOwner: "user",
  managedByTarget: false,
  runtimeAvailability: "enabled",
  contentHash: "library-hash",
  contentMatchesLibrary: true,
  locationRole: "preferred-runtime",
  sharedLocation: false,
  ...overrides
});

const plan = ({
  inventory = [],
  takeover = true,
  targetId = "codex",
  receipt,
  skill = librarySkill(),
  selectedProfile = profile()
}: {
  inventory?: SkillInventoryEntry[];
  takeover?: boolean;
  targetId?: string;
  receipt?: Parameters<typeof buildSkillDeploymentPlan>[0]["captureReceipt"];
  skill?: SkillLibraryEntry;
  selectedProfile?: ProfileDetail;
} = {}) =>
  buildSkillDeploymentPlan({
    profile: selectedProfile,
    targetPaths: targetPaths(targetId),
    profileHash: "profile-hash",
    skillLibrary: [skill],
    inventory,
    takeover,
    captureReceipt: receipt
  });

describe("skill deployment planner", () => {
  it("does not plan or validate Skill deployment when this Agent is not managed", () => {
    const selectedProfile = profile();
    selectedProfile.resources.managementByTarget = {
      codex: { instructions: "manage", skills: "ignore" }
    };
    const result = plan({
      selectedProfile,
      inventory: [inventoryEntry({ contentHash: "occupied", contentMatchesLibrary: false })]
    });

    expect(result.errors).toEqual([]);
    expect(result.decisions).toEqual([]);
    expect(result.approvedUnmanagedSkills).toEqual([]);
    expect(result.effectiveSkills).toEqual(selectedProfile.resources.skills);
  });

  it.each(["codex", "opencode", "claude-code", "antigravity", "trae-cli"])(
    "plans a missing dedicated copy for %s without Target-specific branches",
    (targetId) => {
      expect(plan({ targetId }).decisions).toContainEqual(
        expect.objectContaining({ action: "install", reason: "target-missing" })
      );
    }
  );

  it("approves only an exact unmanaged copy during first takeover", () => {
    const firstTakeover = plan({ inventory: [inventoryEntry()] });
    expect(firstTakeover.approvedUnmanagedSkills).toEqual([
      { path: "/home/.codex/skills/reviewer", contentHash: "library-hash" }
    ]);
    expect(firstTakeover.decisions[0]).toMatchObject({
      action: "adopt",
      reason: "matching-unmanaged"
    });

    const managedApply = plan({ inventory: [inventoryEntry()], takeover: false });
    expect(managedApply.approvedUnmanagedSkills).toEqual([]);
    expect(managedApply.decisions[0]).toMatchObject({ action: "block" });

    const changed = plan({
      inventory: [inventoryEntry({ contentHash: "changed", contentMatchesLibrary: false })]
    });
    expect(changed.approvedUnmanagedSkills).toEqual([]);
    expect(changed.decisions[0]).toMatchObject({ action: "block" });
  });

  it("uses a current Capture receipt as explicit takeover evidence", () => {
    const receipt = {
      formatVersion: 1 as const,
      profileId: "daily",
      targetId: "codex",
      createdAt: "2026-07-20T00:00:00.000Z",
      skills: [{
        libraryId: "reviewer",
        targetName: "reviewer",
        copies: [{ path: "/home/.codex/skills/reviewer", contentHash: "library-hash" }]
      }]
    };
    const captured = plan({
      receipt,
      inventory: [
        inventoryEntry({
          status: "unmanaged",
          libraryId: undefined,
          contentMatchesLibrary: undefined
        })
      ]
    });
    expect(captured.decisions[0]).toMatchObject({
      action: "adopt",
      reason: "captured-exact"
    });

    const staleLibrary = plan({
      receipt,
      skill: librarySkill({ contentHash: "new-library-hash" }),
      inventory: [
        inventoryEntry({
          status: "unmanaged",
          libraryId: undefined,
          contentMatchesLibrary: undefined
        })
      ]
    });
    expect(staleLibrary.approvedUnmanagedSkills).toEqual([]);
    expect(staleLibrary.decisions[0]).toMatchObject({ action: "block" });
  });

  it("defers deployment while an exact shared compatibility copy remains active", () => {
    const shared = inventoryEntry({
      path: "/home/.agents/skills/reviewer",
      locationRole: "compatibility-runtime",
      sharedLocation: true
    });
    const result = plan({ inventory: [shared] });

    expect(result.effectiveSkills).toEqual([]);
    expect(result.sharedPreparations).toEqual([
      expect.objectContaining({
        libraryId: "reviewer",
        disposition: "install",
        sharedPaths: ["/home/.agents/skills/reviewer"]
      })
    ]);
    expect(result.decisions[0]).toMatchObject({ action: "defer" });
  });

  it("adopts an exact dedicated copy without losing shared migration intent", () => {
    const result = plan({
      inventory: [
        inventoryEntry({
          path: "/home/.agents/skills/reviewer",
          locationRole: "compatibility-runtime",
          sharedLocation: true
        }),
        inventoryEntry()
      ]
    });

    expect(result.errors).toEqual([]);
    expect(result.effectiveSkills).toHaveLength(1);
    expect(result.approvedUnmanagedSkills).toEqual([
      { path: "/home/.codex/skills/reviewer", contentHash: "library-hash" }
    ]);
    expect(result.sharedPreparations).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({ action: "adopt" });
  });

  it("keeps an already managed dedicated copy stable while shared migration is pending", () => {
    const result = plan({
      takeover: false,
      inventory: [
        inventoryEntry({
          path: "/home/.agents/skills/reviewer",
          locationRole: "compatibility-runtime",
          sharedLocation: true
        }),
        inventoryEntry({
          status: "managed",
          runtimeOwner: "agentenv",
          managedByTarget: true
        })
      ]
    });

    expect(result.errors).toEqual([]);
    expect(result.effectiveSkills).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      action: "preserve",
      reason: "managed-exact"
    });
  });

  it("blocks a changed dedicated copy before preparing shared migration", () => {
    const result = plan({
      inventory: [
        inventoryEntry({
          path: "/home/.agents/skills/reviewer",
          locationRole: "compatibility-runtime",
          sharedLocation: true
        }),
        inventoryEntry({ contentHash: "changed", contentMatchesLibrary: false })
      ]
    });

    expect(result.sharedPreparations).toEqual([]);
    expect(result.approvedUnmanagedSkills).toEqual([]);
    expect(result.errors).toEqual([
      expect.stringContaining("occupied by a non-AgentEnv Skill")
    ]);
  });

  it("separates managed and external content decisions from takeover approval", () => {
    expect(
      plan({
        inventory: [
          inventoryEntry({
            status: "managed",
            runtimeOwner: "agentenv",
            managedByTarget: true
          })
        ]
      }).decisions[0]
    ).toMatchObject({ action: "preserve", reason: "managed-exact" });

    expect(
      plan({
        inventory: [
          inventoryEntry({
            status: "managed",
            runtimeOwner: "agentenv",
            managedByTarget: true,
            contentHash: "changed",
            contentMatchesLibrary: false
          })
        ]
      }).decisions[0]
    ).toMatchObject({ action: "replace", reason: "managed-changed" });

    expect(
      plan({
        inventory: [
          inventoryEntry({
            status: "external",
            runtimeOwner: "external",
            externalOwnership: {
              manager: "skills-cli",
              canonicalPath: "/external/reviewer",
              confidence: "confirmed",
              state: "healthy"
            }
          })
        ]
      }).decisions[0]
    ).toMatchObject({ action: "preserve", reason: "external-exact" });
  });

  it("fingerprints every deployment fact used by Apply freshness checks", () => {
    const initial = inventoryEntry();
    const fingerprint = fingerprintSkillInventory([initial]);
    expect(fingerprintSkillInventory([initial])).toBe(fingerprint);
    expect(
      fingerprintSkillInventory([inventoryEntry({ contentHash: "changed" })])
    ).not.toBe(fingerprint);
    expect(
      fingerprintSkillInventory([inventoryEntry({ status: "managed" })])
    ).not.toBe(fingerprint);
    expect(
      fingerprintSkillInventory([inventoryEntry({ sharedLocation: true })])
    ).not.toBe(fingerprint);
  });
});
