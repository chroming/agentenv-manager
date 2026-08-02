import { describe, expect, it } from "vitest";
import { commonSkillSourceDirectory, validateSkillSourceMerge } from "../../src/main/skillSourceMerge";
import type { SkillSourceGroupView } from "../../src/shared/types";

const group = (sourceId: string, directory: string, overrides: Partial<SkillSourceGroupView> = {}): SkillSourceGroupView => ({
  formatVersion: 1,
  sourceId,
  canonicalLink: `https://github.com/acme/skills/tree/main/${directory}`,
  repository: "https://github.com/acme/skills.git",
  ref: "main",
  directory,
  observationState: "unchecked",
  counts: { total: 1, updates: 0, new: 0, removed: 0 },
  candidates: [],
  ...overrides
});

describe("Skill source merge", () => {
  it("computes a common parent using complete path segments", () => {
    expect(commonSkillSourceDirectory([
      "skills/engineering/frontend",
      "skills/engineering/backend"
    ])).toBe("skills/engineering");
    expect(commonSkillSourceDirectory(["skills/a", "skills/ab"])).toBe("skills");
  });

  it("allows an explicit ancestor but rejects a narrower or unrelated directory", () => {
    const sources = [group("frontend", "skills/engineering/frontend"), group("backend", "skills/engineering/backend")];
    expect(validateSkillSourceMerge(sources, "skills").directory).toBe("skills");
    expect(() => validateSkillSourceMerge(sources, "skills/engineering/frontend"))
      .toThrow("does not contain selected source /skills/engineering/backend");
  });

  it("allows the repository root to contain nested source scopes", () => {
    const sources = [group("root", ""), group("nested", "skills/algorithmic-art")];
    expect(commonSkillSourceDirectory(sources.map((source) => source.directory))).toBe("");
    expect(validateSkillSourceMerge(sources, "").directory).toBe("");
  });

  it("rejects sources from different repositories or revisions", () => {
    expect(() => validateSkillSourceMerge([
      group("one", "skills/one"),
      group("two", "skills/two", { repository: "https://github.com/other/skills.git" })
    ])).toThrow("same repository");
    expect(() => validateSkillSourceMerge([
      group("one", "skills/one"),
      group("two", "skills/two", { ref: "next" })
    ])).toThrow("same revision");
  });
});
