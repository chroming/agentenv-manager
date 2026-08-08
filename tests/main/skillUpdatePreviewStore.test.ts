import { describe, expect, it, vi } from "vitest";
import {
  createRecentSkillUpdateCheckStore,
  createSkillUpdatePreviewStore,
  type PendingSkillUpdate
} from "../../src/main/skillUpdatePreviewStore";

const pending = (overrides: Partial<PendingSkillUpdate> = {}): PendingSkillUpdate => ({
  previewId: "preview-1",
  id: "skill-a",
  candidateDir: "/tmp/candidate-a",
  candidateContentHash: "candidate",
  expectedLibraryContentHash: "library",
  expectedMetadataHash: "metadata",
  createdAt: 100,
  nextMetadata: {} as PendingSkillUpdate["nextMetadata"],
  ...overrides
});

describe("skill update preview stores", () => {
  it("owns candidate cleanup and expires previews without exposing the backing map", async () => {
    const removeCandidate = vi.fn().mockResolvedValue(undefined);
    const store = createSkillUpdatePreviewStore({
      now: () => 1_000,
      ttlMs: 500,
      removeCandidate
    });
    store.set(pending({ createdAt: 100 }));
    store.set(pending({ previewId: "preview-2", candidateDir: "/tmp/candidate-b", createdAt: 900 }));

    await store.discardExpired();

    expect(store.get("preview-1")).toBeUndefined();
    expect(store.get("preview-2")).toBeDefined();
    expect(store.ownsCandidateDirectory("/tmp/candidate-b")).toBe(true);
    expect(removeCandidate).toHaveBeenCalledWith("/tmp/candidate-a");
  });

  it("discards all stale previews for one Skill except the active preview", async () => {
    const removeCandidate = vi.fn().mockResolvedValue(undefined);
    const store = createSkillUpdatePreviewStore({ removeCandidate });
    store.set(pending());
    store.set(pending({ previewId: "preview-2", candidateDir: "/tmp/candidate-b" }));

    await store.discardForSkill("skill-a", "preview-2");

    expect(store.get("preview-1")).toBeUndefined();
    expect(store.get("preview-2")).toBeDefined();
  });

  it("returns recent source observations only while metadata and TTL still match", () => {
    const checks = createRecentSkillUpdateCheckStore({ now: () => 1_000, ttlMs: 500 });
    checks.set("skill-a", { checkedAt: 800, metadataHash: "metadata", sourceStatus: "removed" });

    expect(checks.getFresh("skill-a", "metadata")?.sourceStatus).toBe("removed");
    expect(checks.getFresh("skill-a", "changed")).toBeUndefined();
  });
});
