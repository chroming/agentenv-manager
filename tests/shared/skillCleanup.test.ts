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
});
