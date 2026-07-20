import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

const hashDirectory = async (
  path: string,
  hash = createHash("sha256"),
  ancestorPaths = new Set<string>()
) => {
  const canonicalPath = await realpath(path);
  if (ancestorPaths.has(canonicalPath)) {
    throw new Error(`Skill contains a symbolic link cycle: ${path}`);
  }
  const nextAncestors = new Set(ancestorPaths).add(canonicalPath);
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".agentenv-skill.json" || entry.name === ".agentenv-owner.json") {
      continue;
    }
    const child = join(path, entry.name);
    hash.update(entry.name);
    const childStats = entry.isSymbolicLink() ? await stat(child) : undefined;
    if (entry.isDirectory() || childStats?.isDirectory()) {
      await hashDirectory(child, hash, nextAncestors);
    } else if (entry.isFile() || childStats?.isFile()) {
      hash.update(await readFile(child));
    }
  }
  return hash;
};

export const hashSkillContent = async (path: string): Promise<string> =>
  (await hashDirectory(path)).digest("hex");
