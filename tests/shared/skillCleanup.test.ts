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
  });

  it("requires review for differing copies, Library conflicts, and external ownership", () => {
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
        expect.objectContaining({ skillKey: "library-copy", state: "conflict", resolution: "manual" }),
        expect.objectContaining({ skillKey: "external", state: "external", resolution: "manual" })
      ])
    );
    expect(groups.map(automaticSkillCleanupRequest)).toEqual([undefined, undefined, undefined]);
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
      resolution: "automatic"
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

    expect(group).toMatchObject({ state: "managed", resolution: "resolved" });
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
      preparedTargetIdsBySkill: { reviewer: ["opencode"] }
    });
    expect(waiting.sharedMigration).toEqual({
      state: "waiting",
      consumers: ["codex", "opencode"],
      pendingConsumers: ["codex"],
      paths: ["/tmp/home/.agents/skills/reviewer"],
      libraryId: "reviewer"
    });
    expect(automaticSkillCleanupRequest(waiting)).toBeUndefined();

    const [ready] = buildSkillCleanupGroups([sharedCopy, openCodeCopy, codexCopy], {
      installedTargetIds: ["opencode", "codex"],
      preparedTargetIdsBySkill: { reviewer: ["opencode", "codex"] }
    });
    expect(ready.sharedMigration).toMatchObject({ state: "ready", pendingConsumers: [] });
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
    expect(groups.find((group) => group.skillKey === "kept")?.sharedMigration?.state)
      .toBe("kept");
    expect(groups.find((group) => group.skillKey === "external")?.sharedMigration?.state)
      .toBe("external");
    expect(groups.find((group) => group.skillKey === "conflict")?.sharedMigration?.state)
      .toBe("conflict");
  });
});
