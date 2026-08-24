import { describe, expect, it } from "vitest";
import {
  findSharedSkillCleanupEntry,
  findTargetSkillCleanupEntry,
  indexSkillCleanupInventory
} from "../../src/main/skillCleanupInventory";
import type { SkillInventoryEntry } from "../../src/shared/types";

const entry = (
  overrides: Partial<SkillInventoryEntry> = {}
): SkillInventoryEntry => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Review code",
  path: "/tmp/home/.claude/skills/reviewer",
  foundIn: ["claude-code"],
  status: "managed",
  libraryId: "reviewer",
  skillKey: "reviewer",
  contentHash: "same-hash",
  contentMatchesLibrary: true,
  locationRole: "preferred-runtime",
  locationManagement: "managed",
  ...overrides
});

describe("Skill cleanup inventory matching", () => {
  it("selects the Agent-owned observation when another Agent observes the same path", () => {
    const path = "/tmp/home/.claude/skills/reviewer";
    const index = indexSkillCleanupInventory([
      entry({
        path,
        foundIn: ["opencode"],
        status: "library",
        locationRole: "compatibility-runtime",
        locationManagement: "observed"
      }),
      entry({ path, foundIn: ["claude-code"] })
    ]);

    expect(findTargetSkillCleanupEntry(index, {
      path,
      targetId: "claude-code",
      skillKey: "reviewer",
      contentHash: "same-hash"
    })).toMatchObject({
      status: "managed",
      foundIn: ["claude-code"],
      locationRole: "preferred-runtime"
    });
  });

  it("selects the shared observation instead of a Target observation at the same path", () => {
    const path = "/tmp/home/.agents/skills/reviewer";
    const index = indexSkillCleanupInventory([
      entry({ path, sharedLocation: false }),
      entry({
        path,
        status: "library",
        foundIn: ["codex", "opencode"],
        sharedLocation: true,
        sharedLocationId: "agents-skills",
        locationRole: "compatibility-runtime",
        locationManagement: "shared-runtime"
      })
    ]);

    expect(findSharedSkillCleanupEntry(index, {
      path,
      skillKey: "reviewer",
      contentHash: "same-hash"
    })).toMatchObject({
      sharedLocation: true,
      sharedLocationId: "agents-skills"
    });
  });

  it("rejects a path whose content changed after preview", () => {
    const index = indexSkillCleanupInventory([
      entry({ contentHash: "new-hash" })
    ]);

    expect(findTargetSkillCleanupEntry(index, {
      path: "/tmp/home/.claude/skills/reviewer",
      targetId: "claude-code",
      skillKey: "reviewer",
      contentHash: "same-hash"
    })).toBeUndefined();
  });
});
