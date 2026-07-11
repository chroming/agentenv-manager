import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

export const hashComparableResource = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  const walk = async (
    currentPath: string,
    relativePath: string,
    ancestorPaths = new Set<string>()
  ) => {
    const canonicalPath = await realpath(currentPath);
    if (ancestorPaths.has(canonicalPath)) {
      throw new Error(`Resource contains a symbolic link cycle: ${currentPath}`);
    }
    const stats = await stat(currentPath);
    if (stats.isDirectory()) {
      hash.update(`directory:${relativePath}`);
      const nextAncestors = new Set(ancestorPaths).add(canonicalPath);
      for (const entry of (await readdir(currentPath, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === ".agentenv-owner.json" || entry.name === ".agentenv-skill.json") continue;
        await walk(join(currentPath, entry.name), join(relativePath, entry.name), nextAncestors);
      }
      return;
    }
    hash.update(`file:${relativePath}`);
    hash.update(await readFile(currentPath));
  };
  await walk(path, ".");
  return hash.digest("hex");
};
