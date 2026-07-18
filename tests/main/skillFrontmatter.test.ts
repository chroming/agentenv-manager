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

  it("reads ClawHub top-level versions", () => {
    expect(parseSkillFrontmatter(`---
name: clawhub-skill
description: ClawHub format.
version: 1.2.0
---
`)).toMatchObject({
      version: "1.2.0",
      versionSource: "version",
      errors: []
    });
  });

  it("reads Agent Skills metadata versions", () => {
    expect(parseSkillFrontmatter(`---
name: agent-skill
description: Agent Skills format.
metadata:
  author: example
  version: 2.5
---
`)).toMatchObject({
      version: "2.5",
      versionSource: "metadata.version",
      errors: []
    });
  });

  it("rejects ambiguous versions declared in both formats", () => {
    const result = parseSkillFrontmatter(`---
name: ambiguous-skill
description: Conflicting formats.
version: 1.0.0
metadata:
  version: 2.0.0
---
`);

    expect(result.errors).toEqual([
      "Conflicting Skill versions: version is 1.0.0, metadata.version is 2.0.0"
    ]);
  });

  it("allows legacy skills without frontmatter", () => {
    expect(parseSkillFrontmatter("# Legacy skill\n")).toEqual({
      name: "",
      description: "",
      errors: []
    });
  });
});
