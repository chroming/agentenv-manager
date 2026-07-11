import { describe, expect, it } from "vitest";
import { parseSkillFrontmatter } from "../../src/main/skillFrontmatter";

describe("skill frontmatter", () => {
  it("parses quoted and folded YAML values", () => {
    expect(
      parseSkillFrontmatter(`---
name: "Review: carefully"
description: >
  Review changes across
  multiple files.
---

# Review
`)
    ).toEqual({
      name: "Review: carefully",
      description: "Review changes across multiple files.",
      errors: []
    });
  });

  it("reports malformed YAML without treating body text as metadata", () => {
    const result = parseSkillFrontmatter(`---
name: [broken
---
description: body text
`);

    expect(result.name).toBe("");
    expect(result.description).toBe("");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("allows legacy skills without frontmatter", () => {
    expect(parseSkillFrontmatter("# Legacy skill\n")).toEqual({
      name: "",
      description: "",
      errors: []
    });
  });
});
