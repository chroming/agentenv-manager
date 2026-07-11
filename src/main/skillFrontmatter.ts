import { parseDocument } from "yaml";

export interface SkillFrontmatter {
  name: string;
  description: string;
  errors: string[];
}

const emptyFrontmatter = (): SkillFrontmatter => ({
  name: "",
  description: "",
  errors: []
});

export const parseSkillFrontmatter = (content: string): SkillFrontmatter => {
  const match = content.match(/^---[\t ]*\r?\n([\s\S]*?)\r?\n---(?:[\t ]*\r?\n|[\t ]*$)/);
  if (!match) {
    return emptyFrontmatter();
  }

  const document = parseDocument(match[1], { prettyErrors: true });
  if (document.errors.length > 0) {
    return {
      ...emptyFrontmatter(),
      errors: document.errors.map((error) => error.message)
    };
  }

  const value = document.toJS();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ...emptyFrontmatter(),
      errors: ["Frontmatter must be a YAML mapping"]
    };
  }

  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name.trim() : "",
    description:
      typeof record.description === "string" ? record.description.trim() : "",
    errors: []
  };
};
