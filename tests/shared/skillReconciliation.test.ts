import { describe, expect, it } from "vitest";
import { reconcileSkill } from "../../src/shared/skillReconciliation";
import type {
  SkillInventoryEntry,
  UnmanagedSkillLocation
} from "../../src/shared/types";

const observation = (
  overrides: Partial<SkillInventoryEntry> = {}
): SkillInventoryEntry => ({
  id: "review",
  name: "Review",
  description: "Review code changes",
  path: "/home/.codex/skills/review",
  foundIn: ["codex"],
  status: "outside",
  skillKey: "review",
  runtimeName: "review",
  deploymentName: "review",
  runtimeOwner: "user",
  managedByTarget: false,
  contentHash: "external-hash",
  contentMatchesLibrary: false,
  ...overrides
});

const unmanagedLocation: UnmanagedSkillLocation = {
  id: "unmanaged-review",
  path: "/home/.codex/skills/review",
  targetId: "codex",
  coverage: "exact",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z"
};

const reconcile = (
  desired: "install" | "omit",
  current?: SkillInventoryEntry,
  unmanaged?: UnmanagedSkillLocation
) =>
  reconcileSkill({
    libraryId: "review",
    targetName: "review",
    targetPath: "/home/.codex/skills/review",
    desired,
    observation: current,
    unmanagedLocation: unmanaged
  });

describe("skill reconciliation", () => {
  it.each([
    {
      name: "installs a missing requested Skill",
      desired: "install" as const,
      current: undefined,
      expected: ["missing", "agentenv", "install", "managed-active", false, false]
    },
    {
      name: "keeps an exact managed Skill",
      desired: "install" as const,
      current: observation({
        status: "managed",
        managedByTarget: true,
        runtimeOwner: "agentenv",
        contentMatchesLibrary: true
      }),
      expected: ["managed", "agentenv", "none", "managed-active", false, false]
    },
    {
      name: "reviews changed managed content before replacement",
      desired: "install" as const,
      current: observation({
        status: "managed",
        managedByTarget: true,
        runtimeOwner: "agentenv"
      }),
      expected: ["managed", "agentenv", "replace", "managed-active", true, false]
    },
    {
      name: "adopts an exact external copy",
      desired: "install" as const,
      current: observation({ contentMatchesLibrary: true }),
      expected: ["external", "agentenv", "adopt", "managed-active", false, false]
    },
    {
      name: "reviews a different external copy",
      desired: "install" as const,
      current: observation(),
      expected: ["external", "agentenv", "replace", "managed-active", true, false]
    },
    {
      name: "uses an unmanaged external copy for an enabled Profile Skill",
      desired: "install" as const,
      current: observation(),
      unmanaged: unmanagedLocation,
      expected: [
        "external",
        "leave-unmanaged",
        "preserve",
        "external-active",
        false,
        true
      ]
    },
    {
      name: "reports an unmanaged external copy that remains while omitted",
      desired: "omit" as const,
      current: observation(),
      unmanaged: unmanagedLocation,
      expected: [
        "external",
        "leave-unmanaged",
        "preserve",
        "external-remains",
        false,
        true
      ]
    },
    {
      name: "removes a managed copy omitted by the Profile",
      desired: "omit" as const,
      current: observation({
        status: "managed",
        managedByTarget: true,
        runtimeOwner: "agentenv"
      }),
      expected: ["managed", "agentenv", "remove", "absent", false, false]
    },
    {
      name: "reviews removal of an external copy",
      desired: "omit" as const,
      current: observation(),
      expected: ["external", "agentenv", "remove", "absent", true, false]
    },
    {
      name: "does nothing when an omitted Skill is absent",
      desired: "omit" as const,
      current: undefined,
      expected: ["missing", "agentenv", "none", "absent", false, false]
    }
  ])("$name", ({ desired, current, unmanaged, expected }) => {
    const result = reconcile(desired, current, unmanaged);

    expect([
      result.observed,
      result.authority,
      result.action,
      result.outcome,
      result.requiresReview,
      result.localOverride
    ]).toEqual(expected);
  });

  it("does not let a stale unmanaged policy override an AgentEnv-owned deployment", () => {
    const result = reconcile(
      "install",
      observation({
        status: "managed",
        managedByTarget: true,
        runtimeOwner: "agentenv",
        contentMatchesLibrary: true
      }),
      unmanagedLocation
    );

    expect(result.authority).toBe("agentenv");
    expect(result.localOverride).toBe(false);
  });

  it("keeps unavailable external content visible without allowing mutation", () => {
    const result = reconcile(
      "install",
      observation({
        contentHash: "",
        runtimeIssues: [{
          code: "unreadable-skill",
          severity: "error",
          message: "Skill link target is unavailable"
        }]
      }),
      unmanagedLocation
    );

    expect(result).toMatchObject({
      observed: "unavailable",
      authority: "leave-unmanaged",
      action: "preserve",
      outcome: "external-active",
      localOverride: true
    });
  });
});
