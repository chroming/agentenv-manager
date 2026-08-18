import { describe, expect, it } from "vitest";
import {
  projectSkillCleanupGroup,
  projectSkillCollection
} from "../../src/shared/skillManagementProjection";
import type {
  SkillCleanupGroup,
  SkillCollectionLinkGroup
} from "../../src/shared/skillCleanup";
import type { SkillInventoryEntry } from "../../src/shared/types";

const item = (overrides: Partial<SkillInventoryEntry> = {}): SkillInventoryEntry => ({
  id: "review",
  skillKey: "review",
  name: "review",
  description: "Review code",
  path: "/home/test/.config/opencode/skills/review",
  foundIn: ["opencode"],
  status: "managed",
  contentHash: "same",
  ...overrides
});

const group = (overrides: Partial<SkillCleanupGroup> = {}): SkillCleanupGroup => ({
  skillKey: "review",
  items: [item({ libraryId: "review" })],
  activeItems: [item({ libraryId: "review" })],
  primary: item({ libraryId: "review" }),
  state: "managed",
  resolution: "resolved",
  resolutionReason: "Managed by AgentEnv",
  bucket: "managed",
  presentation: { state: "managed", action: "none" },
  ...overrides
});

describe("skill management projection", () => {
  it("presents a managed shared copy as managed and shared", () => {
    expect(projectSkillCleanupGroup(group({
      sharedMigration: {
        state: "managed",
        consumers: ["codex", "opencode"],
        pendingConsumers: [],
        paths: ["/home/test/.agents/skills/review"],
        libraryId: "review"
      }
    }))).toEqual({
      state: "managed",
      runtimeControl: "shared",
      health: "current",
      nextAction: "none"
    });
  });

  it("keeps an intentionally unmanaged copy out of decision state", () => {
    expect(projectSkillCleanupGroup(group({
      state: "left-unmanaged",
      bucket: "unmanaged",
      presentation: { state: "left-unmanaged", action: "none" },
      sharedMigration: {
        state: "unmanaged",
        consumers: ["codex"],
        pendingConsumers: [],
        paths: ["/home/test/.agents/skills/review"],
        libraryId: "review"
      }
    }))).toMatchObject({
      state: "not-managed",
      runtimeControl: "external",
      nextAction: "none"
    });
  });

  it("asks for one version choice when readable copies differ", () => {
    const library = item({ libraryId: "review", contentHash: "library" });
    const local = item({ contentHash: "local", status: "outside" });
    expect(projectSkillCleanupGroup(group({
      items: [library, local],
      activeItems: [library, local],
      state: "conflict",
      bucket: "decision",
      presentation: { state: "multiple-versions", action: "review-differences" }
    }))).toMatchObject({
      state: "needs-decision",
      health: "different",
      nextAction: "choose-version"
    });
  });

  it("presents an unreadable link as unavailable with a repair action", () => {
    expect(projectSkillCleanupGroup(group({
      state: "broken",
      bucket: "decision",
      presentation: { state: "unavailable", action: "review-paths" }
    }))).toMatchObject({
      state: "unavailable",
      health: "unavailable",
      nextAction: "repair"
    });
  });

  it("uses the same four-state model for collection links", () => {
    const collection: SkillCollectionLinkGroup = {
      path: "/home/test/.agents/skills/superpowers",
      canonicalPath: "/external/superpowers",
      name: "superpowers",
      items: [],
      consumerTargetIds: ["codex"],
      state: "conflict",
      libraryReadyCount: 4,
      conflictCount: 1
    };
    expect(projectSkillCollection(collection)).toEqual({
      state: "needs-decision",
      runtimeControl: "shared",
      health: "different",
      nextAction: "choose-version"
    });
  });
});
