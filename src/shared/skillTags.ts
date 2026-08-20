export const MAX_SKILL_TAGS = 12;
export const MAX_SKILL_TAG_LENGTH = 32;

const controlCharacters = /[\u0000-\u001f\u007f]/;

export const normalizeSkillTag = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ");

export const skillTagKey = (value: string) =>
  normalizeSkillTag(value).toLocaleLowerCase("en-US");

export const parseSkillTags = (
  value: unknown,
  options: { strict?: boolean } = {}
): string[] => {
  const strict = options.strict !== false;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    if (strict) throw new Error("Skill tags must be a list");
    return [];
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      if (strict) throw new Error("Every Skill tag must be text");
      continue;
    }
    const tag = normalizeSkillTag(item);
    if (!tag) {
      if (strict) throw new Error("Skill tags cannot be empty");
      continue;
    }
    if (controlCharacters.test(tag)) {
      if (strict) throw new Error(`Skill tag contains unsupported characters: ${tag}`);
      continue;
    }
    if (tag.length > MAX_SKILL_TAG_LENGTH) {
      if (strict) {
        throw new Error(`Skill tags can contain at most ${MAX_SKILL_TAG_LENGTH} characters`);
      }
      continue;
    }
    const key = skillTagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > MAX_SKILL_TAGS) {
    if (strict) throw new Error(`A Skill can have at most ${MAX_SKILL_TAGS} tags`);
    return tags.slice(0, MAX_SKILL_TAGS);
  }
  return tags;
};

export const canonicalizeSkillTags = (
  value: unknown,
  availableTags: readonly string[] = []
) => {
  const canonical = new Map(
    parseSkillTags(availableTags, { strict: false }).map((tag) => [skillTagKey(tag), tag])
  );
  return parseSkillTags(value).map((tag) => canonical.get(skillTagKey(tag)) ?? tag);
};

export const collectSkillTags = (
  skills: ReadonlyArray<{ tags?: readonly string[] }>
) => {
  const tags = new Map<string, string>();
  for (const skill of skills) {
    for (const tag of parseSkillTags(skill.tags, { strict: false })) {
      const key = skillTagKey(tag);
      if (!tags.has(key)) tags.set(key, tag);
    }
  }
  return [...tags.values()].sort((left, right) =>
    left.localeCompare(right, "en-US", { sensitivity: "base" })
  );
};
