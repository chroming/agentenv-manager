import { parseDocument } from "yaml";

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  versionSource?: "version" | "metadata.version";
  errors: string[];
}

const emptyFrontmatter = (): SkillFrontmatter => ({
  name: "",
  description: "",
  errors: []
});

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
};

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
  const metadata = record.metadata;
  const metadataRecord = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : undefined;
  const topLevelVersion = stringValue(record.version);
  const metadataVersion = stringValue(metadataRecord?.version);
  const versionConflict = topLevelVersion && metadataVersion && topLevelVersion !== metadataVersion
    ? [`Conflicting Skill versions: version is ${topLevelVersion}, metadata.version is ${metadataVersion}`]
    : [];
  return {
    name: typeof record.name === "string" ? record.name.trim() : "",
    description:
      typeof record.description === "string" ? record.description.trim() : "",
    version: topLevelVersion ?? metadataVersion,
    versionSource: topLevelVersion
      ? "version"
      : metadataVersion
        ? "metadata.version"
        : undefined,
    errors: versionConflict
  };
};
