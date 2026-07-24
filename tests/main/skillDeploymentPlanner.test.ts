import { describe, expect, it } from "vitest";
import {
  buildSkillDeploymentPlan,
  deploymentRelevantSkillInventory,
  fingerprintSkillInventory
} from "../../src/main/skillDeploymentPlanner";
import type {
  ProfileDetail,
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetPaths
} from "../../src/shared/types";
import { blockingMessages, reviewMessages } from "../helpers/applyIssues";

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
  targetId = "codex",
  receipt,
  skill = librarySkill(),
  selectedProfile = profile()
}: {
  inventory?: SkillInventoryEntry[];
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

    expect(blockingMessages(result.issues)).toEqual([]);
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

  it("adopts an exact unmanaged copy during takeover and later Apply", () => {
    const firstTakeover = plan({ inventory: [inventoryEntry()] });
    expect(firstTakeover.approvedUnmanagedSkills).toEqual([
      { path: "/home/.codex/skills/reviewer", contentHash: "library-hash" }
    ]);
    expect(firstTakeover.decisions[0]).toMatchObject({
      action: "adopt",
      reason: "matching-outside"
    });

    const managedApply = plan({ inventory: [inventoryEntry()] });
    expect(managedApply.approvedUnmanagedSkills).toEqual([
      { path: "/home/.codex/skills/reviewer", contentHash: "library-hash" }
    ]);
    expect(managedApply.decisions[0]).toMatchObject({ action: "adopt" });

    const changed = plan({
      inventory: [inventoryEntry({ contentHash: "changed", contentMatchesLibrary: false })]
    });
    expect(changed.approvedUnmanagedSkills).toEqual([]);
    expect(changed.decisions[0]).toMatchObject({ action: "replace" });
    expect(reviewMessages(changed.issues)).toEqual([
      expect.stringContaining("backed up and brought under AgentEnv")
    ]);
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
          status: "outside",
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
          status: "outside",
          libraryId: undefined,
          contentMatchesLibrary: undefined
        })
      ]
    });
    expect(staleLibrary.approvedUnmanagedSkills).toEqual([]);
    expect(staleLibrary.decisions[0]).toMatchObject({ action: "replace" });
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

  it("uses a kept shared copy instead of installing a duplicate Target copy", () => {
    const shared = inventoryEntry({
      path: "/home/.agents/skills/reviewer",
      status: "kept-outside",
      pathPolicy: "keep-shared",
      locationRole: "compatibility-runtime",
      sharedLocation: true,
      contentHash: "device-version",
      contentMatchesLibrary: false
    });
    const result = plan({ inventory: [shared] });

    expect(result.effectiveSkills).toEqual([]);
    expect(result.sharedPreparations).toEqual([]);
    expect(result.decisions).toContainEqual(expect.objectContaining({
      action: "preserve",
      reason: "kept-outside",
      path: "/home/.agents/skills/reviewer"
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "kept-outside-skill",
      path: "/home/.agents/skills/reviewer"
    }));
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

    expect(blockingMessages(result.issues)).toEqual([]);
    expect(result.effectiveSkills).toHaveLength(1);
    expect(result.approvedUnmanagedSkills).toEqual([
      { path: "/home/.codex/skills/reviewer", contentHash: "library-hash" }
    ]);
    expect(result.sharedPreparations).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({ action: "adopt" });
  });

  it("keeps an already managed dedicated copy stable while shared migration is pending", () => {
    const result = plan({
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

    expect(blockingMessages(result.issues)).toEqual([]);
    expect(result.effectiveSkills).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      action: "preserve",
      reason: "managed-exact"
    });
  });

  it("backs up a changed dedicated copy while preserving shared migration intent", () => {
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

    expect(result.sharedPreparations).toHaveLength(1);
    expect(result.approvedUnmanagedSkills).toEqual([]);
    expect(blockingMessages(result.issues)).toEqual([]);
    expect(reviewMessages(result.issues)).toEqual([
      expect.stringContaining("backed up and brought under AgentEnv")
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
            status: "outside",
            runtimeOwner: "external",
            externalEvidence: {
              manager: "skills-cli",
              canonicalPath: "/external/reviewer",
              confidence: "confirmed",
              state: "healthy"
            }
          })
        ]
      }).decisions[0]
    ).toMatchObject({ action: "adopt", reason: "matching-outside" });
  });

  it("records kept paths even when the Skill is disabled or absent from the Profile", () => {
    const disabled = plan({
      selectedProfile: profile({ enabled: false }),
      inventory: [inventoryEntry({ status: "kept-outside", pathPolicy: "keep-outside" })]
    });
    expect(disabled.decisions).toContainEqual(expect.objectContaining({
      action: "preserve",
      reason: "kept-outside",
      path: "/home/.codex/skills/reviewer"
    }));

    const extra = plan({
      inventory: [
        inventoryEntry({
          id: "local-only",
          name: "Local only",
          path: "/home/.codex/skills/local-only",
          status: "kept-outside",
          libraryId: undefined,
          skillKey: "local-only",
          runtimeName: "local-only",
          deploymentName: "local-only",
          contentHash: "local-only-hash",
          contentMatchesLibrary: undefined,
          pathPolicy: "keep-outside"
        })
      ]
    });
    expect(extra.decisions).toContainEqual(expect.objectContaining({
      action: "preserve",
      reason: "kept-outside",
      targetName: "local-only",
      path: "/home/.codex/skills/local-only"
    }));
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

  it("projects only inventory facts that can change the current deployment plan", () => {
    const input = {
      profile: profile(),
      skillLibrary: [librarySkill()],
      targetPaths: targetPaths(),
      inventory: [
        inventoryEntry({
          id: "unrelated",
          name: "unrelated",
          skillKey: "unrelated",
          runtimeName: "unrelated",
          deploymentName: "unrelated",
          path: "/home/.codex/skills/unrelated",
          libraryId: undefined,
          contentMatchesLibrary: false
        }),
        inventoryEntry({
          id: "runtime-conflict",
          name: "reviewer",
          skillKey: "reviewer",
          runtimeName: "reviewer",
          deploymentName: "runtime-conflict",
          path: "/home/.codex/skills/runtime-conflict",
          libraryId: undefined,
          contentMatchesLibrary: false
        }),
        inventoryEntry({
          id: "shared-review",
          path: "/home/.agents/skills/review",
          sharedLocation: true
        })
      ]
    };

    expect(
      deploymentRelevantSkillInventory(input).map((entry) => entry.id)
    ).toEqual(["runtime-conflict", "shared-review"]);
  });
});
