import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import type {
  ProjectSkillCandidate,
  ProjectSkillScanResult,
  SkillLibraryEntry
} from "../shared/types";
import { normalizeSkillKey } from "../shared/skillIdentity";
import { pathExists } from "./fileUtils";
import { hashSkillContent } from "./skillContentHash";
import { parseSkillFrontmatter } from "./skillFrontmatter";
import { createLocalSkillSourceScope } from "./skillSourceScope";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor"
]);

const MAX_DEPTH = 6;
const MAX_DIRECTORIES = 5_000;
const MAX_CANDIDATES = 500;

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const scanProjectSkillRoots = async (
  configuredRoots: readonly string[],
  librarySkills: readonly SkillLibraryEntry[]
): Promise<ProjectSkillScanResult> => {
  const roots: string[] = [];
  const issues: ProjectSkillScanResult["issues"] = [];
  const candidates: ProjectSkillCandidate[] = [];
  const seenCandidatePaths = new Set<string>();
  const libraryByHash = new Map(librarySkills.map((skill) => [skill.contentHash, skill]));
  const libraryBySource = new Map(
    librarySkills
      .filter((skill) => skill.sourceType === "local" && skill.source)
      .map((skill) => [resolve(skill.source!), skill])
  );
  let scannedDirectories = 0;
  let truncated = false;

  for (const configuredRoot of [...new Set(configuredRoots.map((root) => root.trim()).filter(Boolean))]) {
    let root: string;
    try {
      root = await realpath(resolve(configuredRoot));
      if (!(await lstat(root)).isDirectory()) {
        issues.push({ rootPath: configuredRoot, message: "Configured project root is not a directory" });
        continue;
      }
    } catch (error) {
      issues.push({ rootPath: configuredRoot, message: errorMessage(error) });
      continue;
    }
    if (roots.includes(root)) continue;
    roots.push(root);

    const queue = [{ path: root, depth: 0 }];
    while (queue.length > 0) {
      if (scannedDirectories >= MAX_DIRECTORIES || candidates.length >= MAX_CANDIDATES) {
        truncated = true;
        break;
      }
      const current = queue.shift()!;
      scannedDirectories += 1;
      const skillFile = join(current.path, "SKILL.md");
      if (await pathExists(skillFile)) {
        const candidatePath = resolve(current.path);
        if (seenCandidatePaths.has(candidatePath)) continue;
        seenCandidatePaths.add(candidatePath);
        try {
          const markdown = await readFile(skillFile, "utf8");
          const frontmatter = parseSkillFrontmatter(markdown);
          const contentHash = await hashSkillContent(current.path);
          const sourceMatch = libraryBySource.get(resolve(current.path));
          const contentMatch = libraryByHash.get(contentHash);
          const libraryMatch = sourceMatch ?? contentMatch;
          const skillStats = await stat(skillFile);
          const id = normalizeSkillKey(frontmatter.name || basename(current.path) || "skill");
          candidates.push({
            id,
            name: frontmatter.name || basename(current.path),
            description: frontmatter.description,
            version: frontmatter.version,
            rootPath: root,
            path: candidatePath,
            relativePath: relative(root, current.path) || ".",
            contentHash,
            modifiedAt: skillStats.mtime.toISOString(),
            status:
              frontmatter.errors.length > 0
                ? "invalid"
                : libraryMatch && libraryMatch.contentHash === contentHash
                  ? "in-library"
                  : sourceMatch
                    ? "changed"
                    : "ready",
            existingLibraryId: libraryMatch?.id,
            error: frontmatter.errors.length > 0 ? frontmatter.errors.join("; ") : undefined
          });
        } catch (error) {
          candidates.push({
            id: normalizeSkillKey(basename(current.path) || "skill"),
            name: basename(current.path),
            description: "",
            rootPath: root,
            path: candidatePath,
            relativePath: relative(root, current.path) || ".",
            contentHash: "",
            status: "invalid",
            error: errorMessage(error)
          });
        }
        continue;
      }
      if (current.depth >= MAX_DEPTH) continue;

      let entries;
      try {
        entries = await readdir(current.path, { withFileTypes: true });
      } catch (error) {
        issues.push({ rootPath: current.path, message: errorMessage(error) });
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
      }
    }
    if (truncated) break;
  }

  return {
    roots,
    sourceScope: roots.length === 1 ? createLocalSkillSourceScope(roots[0]!) : undefined,
    candidates: candidates.sort((left, right) =>
      left.rootPath.localeCompare(right.rootPath) || left.relativePath.localeCompare(right.relativePath)
    ),
    issues,
    scannedDirectories,
    truncated
  };
};
