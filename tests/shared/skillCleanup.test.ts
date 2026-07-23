import { describe, expect, it } from "vitest";
import {
  automaticSkillCleanupRequest,
  buildSkillCleanupGroups
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
  status: "unmanaged",
  skillKey: "reviewer",
  contentHash: "same-hash",
  ...overrides
});

describe("skill cleanup groups", () => {
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
        status: "external",
        contentHash: "",
        externalOwnership: brokenOwnership,
        runtimeIssues: brokenIssues
      }),
      inventoryItem({
        path: "/tmp/trae-cn/skills/reviewer",
        status: "external",
        contentHash: "",
        externalOwnership: brokenOwnership,
        runtimeIssues: brokenIssues
      }),
      inventoryItem({
        path: "/tmp/coco/skills/reviewer",
        status: "external",
        contentHash: "",
        externalOwnership: brokenOwnership,
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
        status: "external",
        contentHash: "",
        externalOwnership: { ...brokenOwnership, state: "healthy" },
        runtimeIssues: brokenIssues
      })
    ])[0];
    expect(healthyExternal).toMatchObject({ resolution: "manual", bucket: "decision" });
    expect(automaticSkillCleanupRequest(healthyExternal)).toBeUndefined();
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
      { skillKey: "reviewer", state: "unmanaged", resolution: "automatic" }
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

  it("requires a decision without a canonical version but normalizes Library conflicts", () => {
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
        status: "external"
      })
    ]);

    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skillKey: "reviewer", state: "conflict", resolution: "manual" }),
        expect.objectContaining({
          skillKey: "library-copy",
          state: "conflict",
          resolution: "automatic",
          bucket: "ready",
          automaticEffect: "archive-and-link"
        }),
        expect.objectContaining({ skillKey: "external", state: "external", resolution: "manual" })
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
      state: "managed-elsewhere",
      action: "review-ownership"
    });
    expect(automaticSkillCleanupRequest(
      groups.find((group) => group.skillKey === "library-copy")!
    )).toMatchObject({
      libraryId: "library-copy",
      libraryAction: "keep"
    });
  });

  it("treats an externally managed copy with matching Library content as represented", () => {
    const [group] = buildSkillCleanupGroups([
      inventoryItem({
        id: "external",
        skillKey: "external",
        status: "external",
        libraryId: "external-2",
        contentMatchesLibrary: true
      })
    ]);

    expect(group).toMatchObject({
      state: "external",
      resolution: "resolved",
      presentation: { state: "managed-elsewhere", action: "review-ownership" }
    });
  });

  it("auto-refreshes stale managed copies and excludes resolved or ignored groups", () => {
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
        id: "ignored",
        skillKey: "ignored",
        status: "ignored",
        ignoreRuleId: "ignore-ignored"
      })
    ]);

    expect(groups.find((group) => group.skillKey === "reviewer")).toMatchObject({
      state: "stale",
      resolution: "automatic",
      presentation: { state: "managed-copy-changed", action: "review-drift" }
    });
    expect(
      automaticSkillCleanupRequest(groups.find((group) => group.skillKey === "reviewer")!)
    ).toMatchObject({ libraryId: "reviewer" });
    expect(groups.find((group) => group.skillKey === "current")?.resolution).toBe("resolved");
    expect(groups.find((group) => group.skillKey === "ignored")?.resolution).toBe("resolved");
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

  it("tracks a shared compatibility copy through import and Target migration", () => {
    const sharedCopy = inventoryItem({
      path: "/tmp/home/.agents/skills/reviewer",
      foundIn: ["opencode", "codex"],
      status: "library",
      libraryId: "reviewer",
      contentMatchesLibrary: true,
      locationRole: "compatibility-runtime",
      sharedLocation: true
    });
    const openCodeCopy = inventoryItem({
      path: "/tmp/home/.config/opencode/skills/reviewer",
      foundIn: ["opencode"],
      status: "managed",
      libraryId: "reviewer",
      contentMatchesLibrary: true
    });
    const codexCopy = inventoryItem({
      path: "/tmp/home/.codex/skills/reviewer",
      foundIn: ["codex"],
      status: "managed",
      libraryId: "reviewer",
      contentMatchesLibrary: true
    });

    const [waiting] = buildSkillCleanupGroups([sharedCopy, openCodeCopy], {
      installedTargetIds: ["opencode", "codex"],
      preparedTargetsBySkill: {
        reviewer: [{
          targetId: "opencode",
          libraryId: "reviewer",
          sharedPaths: ["/tmp/home/.agents/skills/reviewer"]
        }]
      }
    });
    expect(waiting.sharedMigration).toEqual({
      state: "waiting",
      consumers: ["codex", "opencode"],
      pendingConsumers: ["codex"],
      paths: ["/tmp/home/.agents/skills/reviewer"],
      libraryId: "reviewer"
    });
    expect(waiting.presentation).toEqual({
      state: "shared-copy-in-use",
      action: "open-profiles"
    });
    expect(waiting).toMatchObject({ resolution: "resolved", bucket: "managed" });
    expect(automaticSkillCleanupRequest(waiting)).toBeUndefined();

    const [ready] = buildSkillCleanupGroups([sharedCopy, openCodeCopy, codexCopy], {
      installedTargetIds: ["opencode", "codex"],
      preparedTargetsBySkill: {
        reviewer: ["opencode", "codex"].map((targetId) => ({
          targetId,
          libraryId: "reviewer",
          sharedPaths: ["/tmp/home/.agents/skills/reviewer"]
        }))
      }
    });
    expect(ready.sharedMigration).toMatchObject({ state: "ready", pendingConsumers: [] });
    expect(ready.presentation).toEqual({
      state: "shared-copy-replaceable",
      action: "review-replacement"
    });
    expect(ready).toMatchObject({ resolution: "manual", bucket: "ready" });

    const [stale] = buildSkillCleanupGroups([sharedCopy, openCodeCopy, codexCopy], {
      installedTargetIds: ["opencode", "codex"],
      preparedTargetsBySkill: {
        reviewer: ["opencode", "codex"].map((targetId) => ({
          targetId,
          libraryId: "reviewer",
          sharedPaths: ["/tmp/home/.agents/skills/older-reviewer"]
        }))
      }
    });
    expect(stale.sharedMigration).toMatchObject({
      state: "waiting",
      pendingConsumers: ["codex", "opencode"]
    });
    expect(stale.presentation).toEqual({
      state: "shared-copy-in-use",
      action: "open-profiles"
    });
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
        status: "ignored",
        ignoreReason: "keep-shared"
      }),
      inventoryItem({
        ...shared,
        id: "external",
        skillKey: "external",
        status: "external"
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
      .toBe("kept");
    expect(groups.find((group) => group.skillKey === "external")?.sharedMigration?.state)
      .toBe("external");
    expect(groups.find((group) => group.skillKey === "conflict")?.sharedMigration?.state)
      .toBe("conflict");
    expect(groups.find((group) => group.skillKey === "reviewer")?.presentation).toEqual({
      state: "not-in-library",
      action: "add-to-library"
    });
    expect(groups.find((group) => group.skillKey === "kept")?.presentation).toEqual({
      state: "kept-shared",
      action: "none"
    });
    expect(groups.find((group) => group.skillKey === "external")?.presentation).toEqual({
      state: "managed-elsewhere",
      action: "review-ownership"
    });
    expect(groups.find((group) => group.skillKey === "conflict")?.presentation).toEqual({
      state: "local-changes-found",
      action: "review-differences"
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
