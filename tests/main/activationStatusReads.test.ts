import { afterEach, describe, expect, it, vi } from "vitest";
import * as hashes from "../../src/main/managedResourceHashes";
import { createActivationStatusReads, hasCurrentManagedSkillLocations } from "../../src/main/activationStatusReads";
import type { ProfileDetail } from "../../src/shared/types";

afterEach(() => vi.restoreAllMocks());

describe("Activation observation reads", () => {
  it("requires active Skill receipts at current runtime paths, not just matching Library versions", () => {
    const current = "/test/.gemini/config/skills/review";
    const previous = "/test/.gemini/skills/review";
    expect(hasCurrentManagedSkillLocations([{ kind: "skill", path: previous }], [current])).toBe(false);
    expect(hasCurrentManagedSkillLocations([{ kind: "skill", path: current, paused: true }], [current])).toBe(false);
    expect(hasCurrentManagedSkillLocations([{ kind: "file", path: current }], [current])).toBe(false);
    expect(hasCurrentManagedSkillLocations([{ kind: "skill", path: current }], [current])).toBe(true);
    expect(hasCurrentManagedSkillLocations([], [])).toBe(true);
  });

  it("keeps exact Agent paths and resource kinds separate, including failed reads", async () => {
    const readHash = vi.spyOn(hashes, "hashManagedResourcePath").mockRejectedValue(new Error("unreadable"));
    const reads = createActivationStatusReads({ readProfile: vi.fn() });
    const outcomes = await Promise.allSettled([
      reads.readResourceHash("/test/claude/skills/review", "skill"),
      reads.readResourceHash("/test/claude/skills/../skills/review", "skill"),
      reads.readResourceHash("/test/codex/skills/review", "skill"),
      reads.readResourceHash("/test/claude/skills/review", "instructions")
    ]);
    expect(outcomes.every((result) => result.status === "rejected")).toBe(true);
    expect(readHash).toHaveBeenCalledTimes(3);
  });

  it("retries unreadable Profiles in the next observation rather than caching failure", async () => {
    const profile = { id: "daily" } as ProfileDetail;
    const store = { readProfile: vi.fn().mockRejectedValueOnce(new Error("missing")).mockResolvedValue(profile) };
    const first = createActivationStatusReads(store);
    await expect(Promise.all([first.readProfile("daily"), first.readProfile("daily")])).resolves.toEqual([undefined, undefined]);
    await expect(createActivationStatusReads(store).readProfile("daily")).resolves.toEqual(profile);
    expect(store.readProfile).toHaveBeenCalledTimes(2);
  });
});
