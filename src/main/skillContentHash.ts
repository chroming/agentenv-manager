import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const SKILL_CONTENT_HASH_VERSION = 2 as const;

const EXCLUDED_METADATA_FILES = new Set([
  ".agentenv-skill.json",
  ".agentenv-owner.json"
]);

const writeLength = (hash: ReturnType<typeof createHash>, value: number) => {
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeBigUInt64BE(BigInt(value));
  hash.update(buffer);
};

const writeFrame = (
  hash: ReturnType<typeof createHash>,
  type: "directory" | "file",
  relativePath: string,
  content?: Buffer
) => {
  const normalizedPath = relativePath.split(sep).join("/");
  const pathBytes = Buffer.from(normalizedPath, "utf8");
  hash.update(type === "directory" ? "D" : "F");
  writeLength(hash, pathBytes.length);
  hash.update(pathBytes);
  if (content) {
    writeLength(hash, content.length);
    hash.update(content);
  } else {
    writeLength(hash, 0);
  }
};

const hashDirectory = async (
  path: string,
  rootPath: string,
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
    if (EXCLUDED_METADATA_FILES.has(entry.name)) {
      continue;
    }
    const child = join(path, entry.name);
    const relativePath = relative(rootPath, child);
    const childStats = entry.isSymbolicLink() ? await stat(child) : undefined;
    if (entry.isDirectory() || childStats?.isDirectory()) {
      writeFrame(hash, "directory", relativePath);
      await hashDirectory(child, rootPath, hash, nextAncestors);
    } else if (entry.isFile() || childStats?.isFile()) {
      writeFrame(hash, "file", relativePath, await readFile(child));
    }
  }
  return hash;
};

export const hashSkillContent = async (path: string): Promise<string> =>
  (await hashDirectory(path, path)).digest("hex");
