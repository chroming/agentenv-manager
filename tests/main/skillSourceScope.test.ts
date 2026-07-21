import { describe, expect, it } from "vitest";
import {
  createSkillSourceScope,
  validateSkillSourceCollection
} from "../../src/main/skillSourceScope";

describe("skill source scope", () => {
  it("preserves an exact normalized web tree link as source identity", () => {
    expect(createSkillSourceScope(
      {
        repository: "https://github.com/acme/skills/tree/main/skills/engineering/",
        transport: "system-git"
      },
      {
        repository: "https://github.com/acme/skills.git",
        ref: "main",
        directory: "skills/engineering"
      }
    )).toEqual({
      formatVersion: 1,
      canonicalLink: "https://github.com/acme/skills/tree/main/skills/engineering",
      repository: "https://github.com/acme/skills.git",
      ref: "main",
      directory: "skills/engineering"
    });
  });

  it("keeps repository root, nested directory, and ref scopes distinct", () => {
    const root = createSkillSourceScope(
      { repository: "https://github.com/acme/skills", ref: "main" },
      { repository: "https://github.com/acme/skills.git", ref: "main", directory: "" }
    );
    const nested = createSkillSourceScope(
      { repository: "https://github.com/acme/skills", ref: "main", directory: "skills" },
      { repository: "https://github.com/acme/skills.git", ref: "main", directory: "skills" }
    );
    const nextRef = createSkillSourceScope(
      { repository: "https://github.com/acme/skills", ref: "next" },
      { repository: "https://github.com/acme/skills.git", ref: "next", directory: "" }
    );

    expect(new Set([root.canonicalLink, nested.canonicalLink, nextRef.canonicalLink]).size).toBe(3);
  });

  it("rejects Renderer-supplied collection data that does not match the imported candidate", () => {
    const collection = {
      formatVersion: 1 as const,
      canonicalLink: "https://github.com/acme/skills/tree/main/engineering",
      repository: "https://github.com/acme/skills.git",
      ref: "main",
      directory: "engineering",
      sourceSubpath: "review"
    };

    expect(validateSkillSourceCollection(collection, {
      repository: "https://github.com/acme/skills.git",
      ref: "main",
      directory: "engineering/review"
    })).toEqual(collection);
    expect(() => validateSkillSourceCollection(collection, {
      repository: "https://github.com/other/skills.git",
      ref: "main",
      directory: "engineering/review"
    })).toThrow("does not match");
  });
});
