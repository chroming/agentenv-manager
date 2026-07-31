import { posix } from "node:path";

const MARKDOWN_LINK = /\[[^\]]*]\(([^)\s]+)\)/g;

export const safeRepositoryRelativePath = (value: string): string | undefined => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.split("#", 1)[0] ?? "");
  } catch {
    return undefined;
  }
  const normalized = decoded.replace(/^<|>$/g, "").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)
  ) {
    return undefined;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return undefined;
  }
  return normalized;
};

export const indexedSkillFiles = (
  manifest: string,
  manifestDirectory: string,
  availableSkillFiles: ReadonlySet<string>
): string[] => {
  const matches = new Set<string>();
  for (const match of manifest.matchAll(MARKDOWN_LINK)) {
    const relative = safeRepositoryRelativePath(match[1] ?? "");
    if (!relative || posix.basename(relative).toLowerCase() !== "skill.md") continue;
    const candidates = [
      manifestDirectory ? posix.join(manifestDirectory, relative) : relative,
      relative
    ];
    const resolved = candidates.find((candidate) => availableSkillFiles.has(candidate));
    if (resolved) matches.add(resolved);
  }
  return [...matches].sort((left, right) => left.localeCompare(right));
};

export const commonSkillDirectory = (
  skillFiles: readonly string[],
  fallback: string
): string => {
  const directories = skillFiles.map((path) => {
    const directory = posix.dirname(path);
    return directory === "." ? "" : directory;
  });
  if (directories.length === 0) return fallback;
  const segments = directories[0]!.split("/").filter(Boolean);
  let length = segments.length;
  for (const directory of directories.slice(1)) {
    const candidate = directory.split("/").filter(Boolean);
    length = Math.min(length, candidate.length);
    for (let index = 0; index < length; index += 1) {
      if (segments[index] !== candidate[index]) {
        length = index;
        break;
      }
    }
  }
  return segments.slice(0, length).join("/");
};

export const boundedSkillFiles = (
  skillFiles: readonly string[],
  selectedDirectory: string,
  preferDirect = true
): string[] => {
  const sortedSkillFiles = [...skillFiles].sort((left, right) =>
    left.localeCompare(right)
  );
  if (!preferDirect) return sortedSkillFiles;
  const directSkillPath = selectedDirectory
    ? `${selectedDirectory}/SKILL.md`
    : "SKILL.md";
  if (selectedDirectory && sortedSkillFiles.includes(directSkillPath)) {
    return [directSkillPath];
  }
  return sortedSkillFiles.filter((item, index, items) => {
      const candidateDir = posix.dirname(item) === "." ? "" : posix.dirname(item);
      return !items.slice(0, index).some((parent) => {
        const parentDir = posix.dirname(parent) === "." ? "" : posix.dirname(parent);
        return Boolean(parentDir) && candidateDir.startsWith(`${parentDir}/`);
      });
    });
};
