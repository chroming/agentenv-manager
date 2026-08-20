import { describe, expect, it } from "vitest";
import {
  canonicalizeSkillTags,
  collectSkillTags,
  MAX_SKILL_TAGS,
  normalizeSkillTag,
  parseSkillTags
} from "../../src/shared/skillTags";

describe("skill tags", () => {
  it("normalizes whitespace and deduplicates case-insensitively", () => {
    expect(parseSkillTags(["  Code   Review  ", "code review", "React"])).toEqual([
      "Code Review",
      "React"
    ]);
    expect(normalizeSkillTag("Ｒｅａｃｔ")).toBe("React");
  });

  it("rejects invalid or excessive tags", () => {
    expect(() => parseSkillTags([""])).toThrow("cannot be empty");
    expect(() => parseSkillTags(["a\u0000b"])).toThrow("unsupported characters");
    expect(() => parseSkillTags(["x".repeat(33)])).toThrow("32 characters");
    expect(() => parseSkillTags(
      Array.from({ length: MAX_SKILL_TAGS + 1 }, (_, index) => `tag-${index}`)
    )).toThrow("at most 12 tags");
  });

  it("reuses the established spelling and derives suggestions from Library entries", () => {
    expect(canonicalizeSkillTags(["react", "Writing"], ["React", "Docs"])).toEqual([
      "React",
      "Writing"
    ]);
    expect(collectSkillTags([
      { tags: ["React", "Testing"] },
      { tags: ["react", "Docs"] },
      {}
    ])).toEqual(["Docs", "React", "Testing"]);
  });
});
