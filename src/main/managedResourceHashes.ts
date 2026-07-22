import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type {
  ManagedResourceKind,
  ProfileDetail,
  SkillLibraryEntry,
  TargetPaths
} from "../shared/types";
import { pathExists } from "./fileUtils";
import { hashSkillContent } from "./skillContentHash";

export const hashPath = async (path: string): Promise<string | undefined> => {
  if (!(await pathExists(path))) return undefined;

  const hash = createHash("sha256");
  const walk = async (currentPath: string) => {
    const stats = await lstat(currentPath);
    hash.update(relative(dirname(path), currentPath));
    if (stats.isSymbolicLink()) {
      hash.update(`symlink:${await readlink(currentPath)}`);
      return;
    }
    if (stats.isDirectory()) {
      const entries = await readdir(currentPath, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        await walk(join(currentPath, entry.name));
      }
      return;
    }
    if (stats.isFile()) hash.update(await readFile(currentPath));
  };

  await walk(path);
  return hash.digest("hex");
};

export const hashManagedResourcePath = async (
  path: string,
  kind?: ManagedResourceKind
): Promise<string | undefined> => {
  if (kind !== "skill") return hashPath(path);
  if (!(await pathExists(path))) return undefined;
  return hashSkillContent(path);
};

export const expectedManagedSkillHashes = (
  profile: ProfileDetail,
  targetPaths: TargetPaths,
  skillLibrary: SkillLibraryEntry[]
) => {
  const skillsDir = targetPaths.skillsDir;
  if (!skillsDir) return new Map<string, string>();
  const libraryById = new Map(skillLibrary.map((skill) => [skill.id, skill]));
  return new Map(
    profile.resources.skills
      .filter((reference) => reference.enabled)
      .flatMap((reference) => {
        const contentHash = libraryById.get(reference.libraryId)?.contentHash;
        return contentHash
          ? [[resolve(join(skillsDir, reference.targetName)), contentHash] as const]
          : [];
      })
  );
};
