import type { SkillLibraryEntry } from "../shared/types";

export const skillSourceLabel = (skill: SkillLibraryEntry) => {
  if (skill.sourceType === "github") return skill.source ?? "GitHub source";
  if (skill.sourceType === "local") return skill.source ?? skill.path;
  if (skill.sourceType === "git" && skill.source) {
    const scope = [skill.remoteRef, skill.upstream?.subpath].filter(Boolean).join(":");
    return scope ? `${skill.source}#${scope}` : skill.source;
  }
  return skill.source ?? skill.sourceType;
};

export const shortSkillRevision = (skill: SkillLibraryEntry) =>
  (skill.remoteRevision ?? skill.contentHash ?? "local").slice(0, 7);

export const skillSourceName = (skill: SkillLibraryEntry) => {
  if (skill.sourceType === "local" && !skill.source) return "Local import";
  if (skill.sourceType === "local") return "Local folder";
  const source = skillSourceLabel(skill);
  if (source.startsWith("https://github.com/")) {
    return source.replace("https://github.com/", "").replace("/tree/", "/");
  }
  if (skill.sourceType === "git" && skill.source) {
    let repository = skill.source;
    try {
      const url = new URL(repository);
      repository = `${url.hostname}${url.pathname}`;
    } catch {
      const scpLike = repository.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
      if (scpLike) repository = `${scpLike[1]}/${scpLike[2]}`;
    }
    repository = repository.replace(/\.git$/, "").replace(/^\/+/, "");
    return [repository, skill.upstream?.subpath].filter(Boolean).join("/");
  }
  return source;
};
