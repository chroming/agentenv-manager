import type { SkillExternalOwnership } from "./types";

export const normalizeSkillKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const isPortableSkillRuntimeName = (value: string) =>
  value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export const isExternalSkillImportable = (
  ownership: SkillExternalOwnership | undefined
) => ownership?.importable ?? ownership?.manager === "skills-cli";
