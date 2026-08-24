import { describe, expect, it } from "vitest";
import {
  automaticSkillCleanupRequest,
  buildSkillCollectionLinkGroups,
  buildSkillCleanupGroups,
  filterSkillInventoryForManagementScope,
  missingSkillCleanupMutationPaths
} from "../../src/shared/skillCleanup";
import type { SkillInventoryEntry } from "../../src/shared/types";

const inventoryItem = (
  overrides: Partial<SkillInventoryEntry> = {}
): SkillInventoryEntry => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Review code",
  path: "/tmp/opencode/skills/reviewer",
  foundIn: ["opencode"],
  status: "outside",
  skillKey: "reviewer",
  contentHash: "same-hash",
  sharedLocationId: overrides.sharedLocation ? "agents-skills" : undefined,
  ...overrides
});

describe("skill cleanup groups", () => {
  it("keeps Local Skills global while shared review remains a conditional subflow", () => {
    const inventory = [
      inventoryItem({
        id: "profile-skill",
        libraryId: "profile-skill",
        deploymentName: "profile-skill",
        foundIn: ["opencode"]
      }),
      inventoryItem({
        id: "agent-only",
        skillKey: "agent-only",
        deploymentName: "agent-only",
        foundIn: ["opencode"]
      }),
      inventoryItem({
        id: "other-agent",
        skillKey: "other-agent",
        foundIn: ["codex"]
      }),
      inventoryItem({
        id: "same-library-other-agent",
        libraryId: "profile-skill",
        deploymentName: "profile-skill",
        foundIn: ["codex"]
      }),
      inventoryItem({
        id: "shared-copy",
        skillKey: "shared-copy",
        sharedLocation: true,
        sharedLocationId: "agents-skills",
        foundIn: ["opencode", "codex"]
      })
    ];

    expect(filterSkillInventoryForManagementScope(inventory, { kind: "all" }))
      .toHaveLength(5);
    expect(filterSkillInventoryForManagementScope(inventory, { kind: "shared" })
      .map((item) => item.id)).toEqual(["shared-copy"]);
  });

  it("keeps Agent compatibility directories out of shared management", () => {
    const compatibilityCopy = inventoryItem({
      path: "/tmp/home/.claude/skills/reviewer",
      locationRole: "compatibility-runtime",
      locationManagement: "observed",
      sharedLocation: true,
      sharedLocationId: undefined
    });

    expect(filterSkillInventoryForManagementScope(
      [compatibilityCopy],
      { kind: "shared" }
    )).toEqual([]);
    expect(buildSkillCleanupGroups([compatibilityCopy])[0]).toMatchObject({
      sharedMigration: undefined
    });
  });

  it("requires a decision when a managed copy changed locally", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        status: "managed",
        libraryId: "reviewer",
        contentMatchesLibrary: false
      })
    ]);

    expect(group).toMatchObject({
      state: "stale",
      resolution: "manual",
      bucket: "decision"
    });
    expect(automaticSkillCleanupRequest(group)).toBeUndefined();
  });

  it("makes validated legacy ownership markers a safe management-format upgrade", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        status: "managed",
        libraryId: "reviewer",
        contentMatchesLibrary: true,
        installMethod: "linked",
        legacyOwnershipMarkerPaths: [
          "/tmp/opencode/skills/reviewer.agentenv-owner.json"
        ],
        legacyOwnershipMigrationReady: true
      })
    ]);

    expect(group).toMatchObject({
      resolution: "automatic",
      bucket: "ready",
      automaticEffect: "migrate-legacy-ownership",
      presentation: { state: "legacy-records", action: "manage-copies" }
    });
    expect(automaticSkillCleanupRequest(group)).toMatchObject({
      skillKey: "reviewer",
      libraryId: "reviewer",
      libraryAction: "keep",
      locations: [{
        targetId: "opencode",
        path: "/tmp/opencode/skills/reviewer"
      }]
    });
  });

  it("keeps a legacy link outside the canonical Library path in explicit review", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        status: "managed",
        libraryId: "reviewer",
        contentMatchesLibrary: true,
        installMethod: "linked",
        legacyOwnershipMarkerPaths: [
          "/tmp/opencode/skills/reviewer.agentenv-owner.json"
        ],
        legacyOwnershipMigrationReady: false
      })
    ]);

    expect(group).toMatchObject({
      resolution: "manual",
      bucket: "decision",
      presentation: { state: "outside-agentenv", action: "review-paths" }
    });
    expect(automaticSkillCleanupRequest(group)).toBeUndefined();
  });

  it("does not report two deployment aliases of one physical Skill as duplicate copies", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        path: "/tmp/codex/skills/reviewer",
        canonicalPath: "/tmp/library/reviewer",
        foundIn: ["codex"]
      }),
      inventoryItem({
        path: "/tmp/opencode/skills/reviewer",
        canonicalPath: "/tmp/library/reviewer",
        foundIn: ["opencode"]
      })
    ]);

    expect(group).toMatchObject({
      state: "outside",
      presentation: { state: "not-in-library", action: "add-to-library" }
    });
    expect(group.activeItems).toHaveLength(2);
  });

  it("treats one managed path observed by another Agent as one managed copy", () => {
    const sharedPath = "/tmp/home/.claude/skills/reviewer";
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        path: sharedPath,
        foundIn: ["opencode"],
        status: "library",
        libraryId: "reviewer",
        contentMatchesLibrary: true,
        locationRole: "compatibility-runtime",
        locationManagement: "observed",
        runtimeAvailability: "shadowed"
      }),
      inventoryItem({
        path: sharedPath,
        foundIn: ["claude-code"],
        status: "managed",
        libraryId: "reviewer",
        contentMatchesLibrary: true,
        installMethod: "copied",
        locationRole: "preferred-runtime",
        locationManagement: "managed",
        runtimeAvailability: "enabled"
      })
    ]);

    expect(group).toMatchObject({
      state: "managed",
      resolution: "resolved",
      bucket: "managed",
      presentation: { state: "managed", action: "none" }
    });
    expect(group.activeItems).toHaveLength(1);
    expect(group.activeItems[0]).toMatchObject({
      path: sharedPath,
      status: "managed",
      foundIn: ["claude-code", "opencode"],
      locationRole: "preferred-runtime",
      locationManagement: "managed"
    });
  });

  it("does not merge observations when one physical path changed during scanning", () => {
    const sharedPath = "/tmp/home/.claude/skills/reviewer";
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        path: sharedPath,
        foundIn: ["opencode"],
        contentHash: "before",
        status: "library",
        libraryId: "reviewer",
        contentMatchesLibrary: true,
        locationRole: "compatibility-runtime",
        locationManagement: "observed"
      }),
      inventoryItem({
        path: sharedPath,
        foundIn: ["claude-code"],
        contentHash: "after",
        status: "managed",
        libraryId: "reviewer",
        contentMatchesLibrary: false,
        locationRole: "preferred-runtime",
        locationManagement: "managed"
      })
    ]);

    expect(group).toMatchObject({
      state: "conflict",
      resolution: "manual",
      bucket: "decision"
    });
    expect(group.activeItems).toHaveLength(2);
  });

  it("ignores observed discovery-only plugin copies when deciding whether managed copies conflict", () => {
    const groups = buildSkillCleanupGroups([
      inventoryItem({
        status: "managed",
        libraryId: "dispatching-parallel-agents",
        contentHash: "managed-hash",
        contentMatchesLibrary: true,
        path: "/tmp/opencode/skills/dispatching-parallel-agents"
      }),
      inventoryItem({
        status: "library",
        libraryId: "dispatching-parallel-agents",
        contentHash: "plugin-hash",
        contentMatchesLibrary: false,
        path: "/tmp/claude/plugins/cache/superpowers/skills/dispatching-parallel-agents",
        foundIn: ["claude-code"],
        locationRole: "discovery-only",
        locationManagement: "observed",
        runtimeAvailability: "unknown",
        externalEvidence: {
          manager: "claude-plugin",
          displayName: "Claude Code plugin",
          canonicalPath: "/tmp/claude/plugins/cache/superpowers",
          confidence: "confirmed",
          state: "healthy",
          importable: false
        }
      })
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      state: "managed",
      resolution: "resolved",
      bucket: "managed",
      presentation: { state: "managed", action: "none" }
    });
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].path).toBe(
      "/tmp/opencode/skills/dispatching-parallel-agents"
    );
  });

  it("does not list a discovery-only plugin Skill as a local cleanup task", () => {
    expect(buildSkillCleanupGroups([
      inventoryItem({
        status: "outside",
        path: "/tmp/claude/plugins/cache/superpowers/skills/brainstorming",
        foundIn: ["claude-code"],
        locationRole: "discovery-only",
        locationManagement: "observed",
        runtimeAvailability: "unknown"
      })
    ])).toEqual([]);
  });

  it("keeps an observed alternate runtime visible without offering automatic management", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        status: "library",
        libraryId: "reviewer",
        contentMatchesLibrary: true,
        path: "/tmp/opencode/skill/reviewer",
        locationRole: "alternate-runtime",
        locationManagement: "observed"
      })
    ]);

    expect(group).toMatchObject({
      state: "outside",
      resolution: "manual",
      bucket: "decision",
      presentation: { state: "outside-agentenv", action: "review-paths" }
    });
    expect(automaticSkillCleanupRequest(group)).toBeUndefined();
  });

  it("does not call an orphaned managed receipt healthy", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        status: "managed",
        libraryId: undefined,
        contentMatchesLibrary: undefined
      })
    ]);

    expect(group).toMatchObject({
      state: "orphaned",
      resolution: "manual",
      bucket: "decision",
      presentation: { state: "management-record-missing", action: "review-paths" }
    });
  });

  it("shows a content conflict before legacy-record migration", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        status: "managed",
        libraryId: "reviewer",
        contentHash: "library-content",
        contentMatchesLibrary: true,
        legacyOwnershipMarkerPaths: [
          "/tmp/opencode/skills/reviewer.agentenv-owner.json"
        ],
        legacyOwnershipMigrationReady: true
      }),
      inventoryItem({
        status: "library",
        libraryId: "reviewer",
        path: "/tmp/codex/skills/reviewer",
        foundIn: ["codex"],
        contentHash: "different-content",
        contentMatchesLibrary: false
      })
    ]);

    expect(group).toMatchObject({
      state: "conflict",
      resolution: "manual",
      presentation: { state: "local-changes-found", action: "review-differences" }
    });
  });

  it("requires every unresolved manageable location in one cleanup", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        status: "managed",
        libraryId: "reviewer",
        contentMatchesLibrary: true
      }),
      inventoryItem({
        status: "library",
        libraryId: "reviewer",
        contentMatchesLibrary: false,
        path: "/tmp/codex/skills/reviewer",
        foundIn: ["codex"],
        contentHash: "different-content"
      })
    ]);

    expect(missingSkillCleanupMutationPaths(group, [group.activeItems[0].path]))
      .toEqual(["/tmp/codex/skills/reviewer"]);
    expect(missingSkillCleanupMutationPaths(group, group.activeItems.map((item) => item.path)))
      .toEqual([]);
  });

  it("groups nested Skills by their collection link and removes them from per-Skill cleanup", () => {
    const collectionLink = {
      path: "/tmp/home/.agents/skills/superpowers",
      canonicalPath: "/tmp/home/.codex/superpowers/skills"
    };
    const inventory = [
      inventoryItem({
        id: "brainstorming",
        name: "Brainstorming",
        path: `${collectionLink.path}/brainstorming`,
        skillKey: "brainstorming",
        collectionLink,
        libraryId: "brainstorming",
        contentMatchesLibrary: true,
        foundIn: ["codex", "opencode"]
      }),
      inventoryItem({
        id: "debugging",
        name: "Systematic debugging",
        path: `${collectionLink.path}/debugging`,
        skillKey: "systematic-debugging",
        collectionLink,
        foundIn: ["codex"]
      })
    ];

    expect(buildSkillCleanupGroups(inventory)).toEqual([]);
    expect(buildSkillCollectionLinkGroups(inventory)).toEqual([
      expect.objectContaining({
        path: collectionLink.path,
        canonicalPath: collectionLink.canonicalPath,
        name: "superpowers",
        state: "needs-library",
        libraryReadyCount: 1,
        conflictCount: 0,
        consumerTargetIds: ["codex", "opencode"],
        items: expect.arrayContaining([
          expect.objectContaining({ skillKey: "brainstorming" }),
          expect.objectContaining({ skillKey: "systematic-debugging" })
        ])
      })
    ]);
  });

  it("treats an explicit Library-version decision as reviewed without claiming an exact match", () => {
    const collectionLink = {
      path: "/tmp/home/.agents/skills/superpowers",
      canonicalPath: "/tmp/home/.codex/superpowers/skills"
    };
    const [group] = buildSkillCollectionLinkGroups([
      inventoryItem({
        path: `${collectionLink.path}/brainstorming`,
        skillKey: "brainstorming",
        collectionLink,
        libraryId: "brainstorming",
        contentMatchesLibrary: false,
        collectionDecision: "use-library"
      }),
      inventoryItem({
        path: `${collectionLink.path}/debugging`,
        skillKey: "debugging",
        collectionLink,
        libraryId: "debugging",
        contentMatchesLibrary: true
      })
    ]);

    expect(group).toMatchObject({
      state: "ready",
      libraryReadyCount: 2,
      conflictCount: 0
    });
    expect(group.items[0]).toMatchObject({
      contentMatchesLibrary: false,
      collectionDecision: "use-library"
    });
  });

  it("makes an unowned broken Skill link ready for reversible removal", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        contentHash: "",
        runtimeAvailability: "unknown",
        runtimeIssues: [{
          code: "unreadable-skill",
          severity: "warning",
          message: "Skill link target is unavailable"
        }]
      })
    ]);

    expect(group).toMatchObject({
      state: "broken",
      resolution: "automatic",
      bucket: "ready",
      automaticEffect: "remove-broken-link",
      presentation: { state: "unavailable", action: "review-details" }
    });
    expect(automaticSkillCleanupRequest(group)).toMatchObject({
      libraryAction: "keep",
      locations: [{ path: "/tmp/opencode/skills/reviewer", contentHash: "" }]
    });
  });

  it("makes broken shared compatibility links ready for reversible removal", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        path: "/tmp/home/.agents/skills/reviewer",
        foundIn: ["opencode", "codex"],
        contentHash: "",
        locationRole: "compatibility-runtime",
        sharedLocation: true,
        runtimeAvailability: "unknown",
        runtimeIssues: [{
          code: "unreadable-skill",
          severity: "warning",
          message: "Skill link target is unavailable"
        }]
      })
    ]);

    expect(group).toMatchObject({
      state: "broken",
      resolution: "automatic",
      bucket: "ready",
      automaticEffect: "remove-broken-link"
    });
    expect(automaticSkillCleanupRequest(group)).toMatchObject({
      libraryAction: "keep",
      locations: [{
        targetId: "opencode",
        path: "/tmp/home/.agents/skills/reviewer",
        contentHash: ""
      }]
    });
  });

  it("removes only a broken Agent link when healthy managed copies share the Skill key", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        path: "/tmp/opencode/skills/debug-helper",
        status: "managed",
        libraryId: "debug-helper",
        skillKey: "debug-helper",
        contentHash: "4a6d205",
        contentMatchesLibrary: true
      }),
      inventoryItem({
        path: "/tmp/pi/skills/debug-helper",
        foundIn: ["pi"],
        status: "managed",
        libraryId: "debug-helper",
        skillKey: "debug-helper",
        contentHash: "4a6d205",
        contentMatchesLibrary: true
      }),
      inventoryItem({
        path: "/tmp/trae/skills/debug-helper",
        foundIn: ["trae-cli"],
        status: "outside",
        libraryId: "debug-helper",
        skillKey: "debug-helper",
        contentHash: "",
        runtimeAvailability: "unknown",
        runtimeIssues: [{
          code: "unreadable-skill",
          severity: "warning",
          message: "Skill link target is unavailable: /tmp/trae/skills/debug-helper"
        }]
      })
    ]);

    expect(group).toMatchObject({
      state: "broken",
      resolution: "automatic",
      bucket: "ready",
      automaticEffect: "remove-broken-link"
    });
    expect(automaticSkillCleanupRequest(group)).toMatchObject({
      libraryAction: "keep",
      locations: [{
        targetId: "trae-cli",
        path: "/tmp/trae/skills/debug-helper",
        contentHash: ""
      }]
    });
  });

  it("makes stale externally tracked broken links ready without relaxing healthy ownership", () => {
    const brokenOwnership = {
      manager: "skills-cli" as const,
      displayName: "Skills CLI",
      canonicalPath: "/tmp/missing/reviewer",
      confidence: "confirmed" as const,
      state: "broken-link" as const
    };
    const brokenIssues = [{
      code: "unreadable-skill" as const,
      severity: "warning" as const,
      message: "Skill link target is unavailable"
    }];
    const brokenGroup = buildSkillCleanupGroups([
      inventoryItem({
        path: "/tmp/trae/skills/reviewer",
        status: "outside",
        contentHash: "",
        externalEvidence: brokenOwnership,
        runtimeIssues: brokenIssues
      }),
      inventoryItem({
        path: "/tmp/trae-cn/skills/reviewer",
        status: "outside",
        contentHash: "",
        externalEvidence: brokenOwnership,
        runtimeIssues: brokenIssues
      }),
      inventoryItem({
        path: "/tmp/coco/skills/reviewer",
        status: "outside",
        contentHash: "",
        externalEvidence: brokenOwnership,
        runtimeIssues: brokenIssues
      })
    ])[0];

    expect(brokenGroup).toMatchObject({
      state: "broken",
      resolution: "automatic",
      bucket: "ready",
      automaticEffect: "remove-broken-link"
    });
    expect(automaticSkillCleanupRequest(brokenGroup)?.locations).toHaveLength(3);

    const healthyExternal = buildSkillCleanupGroups([
      inventoryItem({
        status: "outside",
        contentHash: "",
        externalEvidence: { ...brokenOwnership, state: "healthy" },
        runtimeIssues: brokenIssues
      })
    ])[0];
    expect(healthyExternal).toMatchObject({ resolution: "automatic", bucket: "ready" });
    expect(automaticSkillCleanupRequest(healthyExternal)).toBeDefined();
  });

  it("keeps an unreadable manifest decision-only", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        contentHash: "",
        runtimeAvailability: "unknown",
        runtimeIssues: [{
          code: "unreadable-skill",
          severity: "warning",
          message: "Skill manifest is unreadable: /tmp/opencode/skills/reviewer/SKILL.md"
        }]
      })
    ]);

    expect(group).toMatchObject({
      state: "broken",
      resolution: "manual",
      bucket: "decision"
    });
    expect(automaticSkillCleanupRequest(group)).toBeUndefined();
  });

  it("marks a single unmanaged copy and identical duplicates as auto-ready", () => {
    const groups = buildSkillCleanupGroups([
      inventoryItem(),
      inventoryItem({
        id: "formatter",
        skillKey: "formatter",
        name: "Formatter",
        path: "/tmp/opencode/skills/formatter"
      }),
      inventoryItem({
        id: "formatter",
        skillKey: "formatter",
        name: "Formatter",
        path: "/tmp/codex/skills/formatter",
        foundIn: ["codex"]
      })
    ]);

    expect(groups.map(({ skillKey, state, resolution }) => ({ skillKey, state, resolution }))).toEqual([
      { skillKey: "formatter", state: "duplicate", resolution: "automatic" },
      { skillKey: "reviewer", state: "outside", resolution: "automatic" }
    ]);
    expect(automaticSkillCleanupRequest(groups[0])).toMatchObject({
      libraryId: "formatter",
      locations: [
        { targetId: "opencode", path: "/tmp/opencode/skills/formatter" },
        { targetId: "codex", path: "/tmp/codex/skills/formatter" }
      ]
    });
    expect(groups.map(({ skillKey, presentation }) => ({ skillKey, presentation }))).toEqual([
      {
        skillKey: "formatter",
        presentation: { state: "duplicate-copies", action: "add-to-library" }
      },
      {
        skillKey: "reviewer",
        presentation: { state: "not-in-library", action: "add-to-library" }
      }
    ]);
  });

  it("requires a decision for content conflicts and automates only unambiguous imports", () => {
    const groups = buildSkillCleanupGroups([
      inventoryItem(),
      inventoryItem({ path: "/tmp/codex/skills/reviewer", foundIn: ["codex"], contentHash: "other" }),
      inventoryItem({
        id: "library-copy",
        skillKey: "library-copy",
        path: "/tmp/opencode/skills/library-copy",
        status: "library",
        libraryId: "library-copy",
        contentMatchesLibrary: false
      }),
      inventoryItem({
        id: "external",
        skillKey: "external",
        path: "/tmp/opencode/skills/external",
        status: "outside"
      })
    ]);

    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skillKey: "reviewer", state: "conflict", resolution: "manual" }),
        expect.objectContaining({
          skillKey: "library-copy",
          state: "conflict",
          resolution: "manual",
          bucket: "decision"
        }),
        expect.objectContaining({ skillKey: "external", state: "outside", resolution: "automatic" })
      ])
    );
    expect(groups.find((group) => group.skillKey === "reviewer")?.presentation).toEqual({
      state: "multiple-versions",
      action: "add-to-library"
    });
    expect(groups.find((group) => group.skillKey === "library-copy")?.presentation).toEqual({
      state: "local-changes-found",
      action: "review-differences"
    });
    expect(groups.find((group) => group.skillKey === "external")?.presentation).toEqual({
      state: "not-in-library",
      action: "add-to-library"
    });
    expect(automaticSkillCleanupRequest(
      groups.find((group) => group.skillKey === "library-copy")!
    )).toBeUndefined();
  });

  it("treats an externally managed copy with matching Library content as represented", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        id: "external",
        skillKey: "external",
        status: "outside",
        libraryId: "external-2",
        contentMatchesLibrary: true
      })
    ]);

    expect(group).toMatchObject({
      state: "outside",
      resolution: "automatic",
      presentation: { state: "copies-not-managed", action: "manage-copies" }
    });
  });

  it("requires review for stale managed copies and excludes resolved or kept groups", () => {
    const groups = buildSkillCleanupGroups([
      inventoryItem({
        status: "managed",
        libraryId: "reviewer",
        contentMatchesLibrary: false,
        installMethod: "copied"
      }),
      inventoryItem({
        id: "current",
        skillKey: "current",
        status: "managed",
        libraryId: "current",
        contentMatchesLibrary: true,
        installMethod: "linked"
      }),
      inventoryItem({
        id: "kept",
        skillKey: "kept",
        status: "left-unmanaged",
        unmanagedLocationId: "unmanaged-kept",
        unmanagedCoverage: "exact"
      })
    ]);

    expect(groups.find((group) => group.skillKey === "reviewer")).toMatchObject({
      state: "stale",
      resolution: "manual",
      presentation: { state: "managed-copy-changed", action: "review-drift" }
    });
    expect(
      automaticSkillCleanupRequest(groups.find((group) => group.skillKey === "reviewer")!)
    ).toBeUndefined();
    expect(groups.find((group) => group.skillKey === "current")?.resolution).toBe("resolved");
    expect(groups.find((group) => group.skillKey === "kept")?.resolution).toBe("resolved");
  });

  it("treats multiple current managed locations as one resolved group", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        status: "managed",
        libraryId: "reviewer",
        contentMatchesLibrary: true,
        installMethod: "linked"
      }),
      inventoryItem({
        path: "/tmp/codex/skills/reviewer",
        foundIn: ["codex"],
        status: "managed",
        libraryId: "reviewer",
        contentMatchesLibrary: true,
        installMethod: "copied"
      })
    ]);

    expect(group).toMatchObject({ state: "managed", resolution: "resolved", bucket: "managed" });
    expect(group.presentation).toEqual({ state: "managed", action: "none" });
    expect(automaticSkillCleanupRequest(group)).toBeUndefined();
  });

  it("keeps shared Skills managed in place until Profiles-only migration is explicit", () => {
    const sharedCopy = inventoryItem({
      path: "/tmp/home/.agents/skills/reviewer",
      foundIn: ["opencode", "codex"],
      status: "library",
      libraryId: "reviewer",
      contentMatchesLibrary: true,
      locationRole: "compatibility-runtime",
      sharedLocation: true
    });
    const [notManaged] = buildSkillCleanupGroups([sharedCopy], {
      installedTargetIds: ["opencode", "codex"],
      preparedTargetsBySkill: {
        reviewer: [{
          targetId: "opencode",
          libraryId: "reviewer",
          sharedPaths: ["/tmp/home/.agents/skills/reviewer"]
        }]
      }
    });
    expect(notManaged.sharedMigration).toEqual({
      state: "not-managed",
      consumers: ["codex", "opencode"],
      pendingConsumers: ["codex", "opencode"],
      paths: ["/tmp/home/.agents/skills/reviewer"],
      libraryId: "reviewer"
    });
    expect(notManaged.presentation).toEqual({
      state: "copies-not-managed",
      action: "manage-copies"
    });
    expect(notManaged).toMatchObject({
      resolution: "automatic",
      bucket: "ready",
      automaticEffect: "import-shared"
    });
    expect(automaticSkillCleanupRequest(notManaged)).toMatchObject({
      mode: "shared-compatibility",
      libraryAction: "keep",
      sharedLocations: [{ path: "/tmp/home/.agents/skills/reviewer" }]
    });

    const [managed] = buildSkillCleanupGroups([inventoryItem({
      ...sharedCopy,
      status: "managed",
      managedAsShared: true
    })]);
    expect(managed.sharedMigration).toMatchObject({ state: "managed" });
    expect(managed.presentation).toEqual({ state: "managed", action: "none" });
    expect(managed).toMatchObject({ resolution: "resolved", bucket: "managed" });
    expect(automaticSkillCleanupRequest(managed)).toBeUndefined();
  });

  it("distinguishes unimported, retained, external, and conflicting shared copies", () => {
    const shared = {
      path: "/tmp/home/.agents/skills/reviewer",
      foundIn: ["opencode", "codex"],
      locationRole: "compatibility-runtime" as const,
      sharedLocation: true
    };
    const groups = buildSkillCleanupGroups([
      inventoryItem({ ...shared }),
      inventoryItem({
        ...shared,
        id: "kept",
        skillKey: "kept",
        status: "left-unmanaged",
        unmanagedLocationId: "unmanaged-kept",
        unmanagedCoverage: "exact"
      }),
      inventoryItem({
        ...shared,
        id: "external",
        skillKey: "external",
        status: "outside"
      }),
      inventoryItem({
        ...shared,
        id: "conflict",
        skillKey: "conflict",
        status: "library",
        libraryId: "conflict",
        contentMatchesLibrary: false
      })
    ]);

    expect(groups.find((group) => group.skillKey === "reviewer")?.sharedMigration?.state)
      .toBe("not-imported");
    expect(
      automaticSkillCleanupRequest(groups.find((group) => group.skillKey === "reviewer")!)
    ).toMatchObject({
      mode: "shared-compatibility",
      libraryAction: "create",
      canonicalPath: "/tmp/home/.agents/skills/reviewer",
      sharedLocations: [{
        path: "/tmp/home/.agents/skills/reviewer",
        contentHash: "same-hash"
      }],
      locations: []
    });
    expect(groups.find((group) => group.skillKey === "kept")?.sharedMigration?.state)
      .toBe("unmanaged");
    expect(groups.find((group) => group.skillKey === "external")?.sharedMigration?.state)
      .toBe("not-imported");
    expect(groups.find((group) => group.skillKey === "conflict")?.sharedMigration?.state)
      .toBe("conflict");
    expect(groups.find((group) => group.skillKey === "reviewer")?.presentation).toEqual({
      state: "not-in-library",
      action: "add-to-library"
    });
    expect(groups.find((group) => group.skillKey === "kept")?.presentation).toEqual({
      state: "shared-left-unmanaged",
      action: "none"
    });
    expect(groups.find((group) => group.skillKey === "external")?.presentation).toEqual({
      state: "not-in-library",
      action: "add-to-library"
    });
    expect(groups.find((group) => group.skillKey === "conflict")?.presentation).toEqual({
      state: "local-changes-found",
      action: "review-differences"
    });
  });

  it("keeps a retained shared copy from masking a remaining Library-backed copy", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        path: "/tmp/home/.agents/skills/external-cli-skill",
        foundIn: ["codex", "opencode", "pi", "trae-cli"],
        status: "left-unmanaged",
        libraryId: "external-cli-skill",
        skillKey: "external-cli-skill",
        sharedLocation: true,
        locationRole: "compatibility-runtime",
        unmanagedLocationId: "unmanaged-external-cli-skill",
        unmanagedCoverage: "exact",
        contentMatchesLibrary: true
      }),
      inventoryItem({
        path: "/tmp/claude/skills/external-cli-skill",
        foundIn: ["claude-code", "opencode"],
        status: "library",
        libraryId: "external-cli-skill",
        skillKey: "external-cli-skill",
        sharedLocation: false,
        locationRole: "preferred-runtime",
        contentMatchesLibrary: true
      })
    ]);

    expect(group).toMatchObject({
      state: "library",
      resolution: "automatic",
      bucket: "ready",
      presentation: {
        state: "copies-not-managed",
        action: "manage-copies"
      },
      sharedMigration: {
        state: "unmanaged"
      }
    });
    expect(automaticSkillCleanupRequest(group)).toEqual({
      skillKey: "external-cli-skill",
      libraryId: "external-cli-skill",
      canonicalPath: "/tmp/claude/skills/external-cli-skill",
      libraryAction: "keep",
      locations: [{
        targetId: "claude-code",
        path: "/tmp/claude/skills/external-cli-skill",
        contentHash: "same-hash"
      }]
    });
  });

  it("excludes a retained shared path from migration when another shared copy stays managed", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        path: "/tmp/home/.agents/skills/reviewer",
        foundIn: ["codex"],
        status: "left-unmanaged",
        libraryId: "reviewer",
        skillKey: "reviewer",
        sharedLocation: true,
        locationRole: "compatibility-runtime",
        unmanagedLocationId: "unmanaged-reviewer",
        unmanagedCoverage: "exact",
        contentMatchesLibrary: true
      }),
      inventoryItem({
        path: "/tmp/home/.shared/skills/reviewer",
        foundIn: ["opencode"],
        status: "managed",
        managedAsShared: true,
        libraryId: "reviewer",
        skillKey: "reviewer",
        sharedLocation: true,
        locationRole: "compatibility-runtime",
        contentMatchesLibrary: true
      })
    ]);

    expect(group.sharedMigration).toMatchObject({
      state: "managed",
      consumers: ["opencode"],
      paths: ["/tmp/home/.shared/skills/reviewer"]
    });
  });

  it("keeps version choice inside Add to Library for conflicting shared and Target copies", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        path: "/tmp/home/.agents/skills/reviewer",
        foundIn: ["opencode", "codex"],
        contentHash: "shared-version",
        locationRole: "compatibility-runtime",
        sharedLocation: true
      }),
      inventoryItem({
        path: "/tmp/home/.codex/skills/reviewer",
        foundIn: ["codex"],
        contentHash: "codex-version"
      })
    ], { installedTargetIds: ["opencode", "codex"] });

    expect(group.sharedMigration?.state).toBe("conflict");
    expect(group.presentation).toEqual({
      state: "multiple-versions",
      action: "add-to-library"
    });
    expect(group.bucket).toBe("decision");
    expect(automaticSkillCleanupRequest(group)).toBeUndefined();
  });

  it("auto-imports identical shared and Target copies with the shared cleanup mode", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        path: "/tmp/home/.agents/skills/reviewer",
        foundIn: ["opencode", "codex"],
        locationRole: "compatibility-runtime",
        sharedLocation: true
      }),
      inventoryItem({
        path: "/tmp/opencode/skills/reviewer",
        foundIn: ["opencode"],
        locationRole: "preferred-runtime",
        sharedLocation: false
      })
    ]);

    expect(group.presentation).toEqual({
      state: "duplicate-copies",
      action: "add-to-library"
    });
    expect(group).toMatchObject({
      resolution: "automatic",
      bucket: "ready",
      automaticEffect: "import-shared"
    });
    expect(automaticSkillCleanupRequest(group)).toMatchObject({
      mode: "shared-compatibility",
      libraryAction: "create",
      canonicalPath: "/tmp/home/.agents/skills/reviewer",
      sharedLocations: [{
        path: "/tmp/home/.agents/skills/reviewer",
        contentHash: "same-hash"
      }],
      locations: [{
        targetId: "opencode",
        path: "/tmp/opencode/skills/reviewer",
        contentHash: "same-hash"
      }]
    });
  });
});
