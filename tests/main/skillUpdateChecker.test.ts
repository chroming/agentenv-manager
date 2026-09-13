import { expect, it, vi } from "vitest";
import { createSkillUpdateChecker } from "../../src/main/skillUpdateChecker";
import type { SkillLibraryEntry } from "../../src/shared/types";

it("does not fail healthy checks when one metadata file is unreadable", async () => {
  const recentChecks = { set: vi.fn() };
  const skills = ["broken", "healthy"].map((id): SkillLibraryEntry => ({
    id, name: id, path: id, source: id, sourceType: "local", globallyEnabled: true,
    description: "", contentHash: "same", updatedAt: "", updatePolicy: "tracked"
  }));
  const check = createSkillUpdateChecker({
    listSkills: async () => skills,
    readMetadata: async (path) => {
      if (path === "broken") throw new Error("EACCES metadata");
      return { sourceType: "local", source: path, contentHash: "same" };
    },
    pathExists: async () => true,
    computeContentHash: async () => "same",
    metadataHash: () => "metadata",
    githubClient: {} as never,
    recentChecks: recentChecks as never
  });
  expect(await check()).toEqual([
    expect.objectContaining({ id: "broken", updateAvailable: false, error: "EACCES metadata" }),
    expect.objectContaining({ id: "healthy", updateAvailable: false, latestRevision: "same" })
  ]);
  expect(recentChecks.set).toHaveBeenCalledTimes(1);
  expect(recentChecks.set.mock.calls[0][0]).toBe("healthy");
});
