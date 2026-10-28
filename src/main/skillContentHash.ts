import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
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

export interface SkillHashOptions {
  /** Internal materialization preview; safe relative paths may replace or add regular files. */
  fileOverrides?: ReadonlyMap<string, Buffer>;
  maxEntries?: number;
  maxBytes?: number;
  maxDepth?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

class ChangedSkillError extends Error { }

const stamp = (value: NonNullable<Awaited<ReturnType<typeof stat>>>) =>
  `${value.dev}:${value.ino}:${value.mode}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;

const hashSnapshot = async (rootPath: string, options: SkillHashOptions) => {
  const hash = createHash("sha256");
  const stamps = new Map<string, string>();
  const started = Date.now();
  let count = 0;
  let bytes = 0;
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const overrideChildren = new Map<string, Set<string>>();
  for (const path of options.fileOverrides?.keys() ?? []) {
    const parts = path.split("/");
    if (path.includes("\\") || path.includes(":") || parts.some((part) => !part || part === "." || part === ".." || EXCLUDED_METADATA_FILES.has(part))) {
      throw new Error(`Invalid Skill override path: ${path}`);
    }
    for (let index = 0; index < parts.length; index++) {
      const parent = parts.slice(0, index).join("/");
      if (options.fileOverrides?.has(parent)) throw new Error(`Skill override file is also a directory: ${parent}`);
      const children = overrideChildren.get(parent) ?? new Set<string>();
      children.add(parts[index]);
      overrideChildren.set(parent, children);
    }
  }
  const check = () => {
    options.signal?.throwIfAborted();
    if (Date.now() - started > (options.timeoutMs ?? 30_000)) {
      throw new Error(`Skill read timed out; inspect the folder and retry: ${rootPath} (elapsed ${Date.now() - started} ms, ${count} entries, ${bytes} bytes)`);
    }
  };
  const remember = async (path: string) => {
    const value = stamp(await lstat(path));
    const previous = stamps.get(path);
    if (previous && previous !== value) throw new ChangedSkillError(`Skill changed while reading: ${path}`);
    stamps.set(path, value);
  };
  const hashDirectory = async (path: string, ancestorPaths = new Set<string>(), depth = 0, virtual = false): Promise<void> => {
    check();
    if (depth > (options.maxDepth ?? 64)) throw new Error(`Skill directory nesting exceeds the read limit: ${path}`);
    if (!virtual) await remember(path);
    const canonicalPath = virtual ? path : await realpath(path);
    if (!virtual) await remember(canonicalPath);
    if (ancestorPaths.has(canonicalPath)) {
      throw new Error(`Skill contains a symbolic link cycle: ${path}`);
    }
    const nextAncestors = new Set(ancestorPaths).add(canonicalPath);
    const entries = new Map((virtual ? [] : await readdir(path, { withFileTypes: true })).map((entry) => [entry.name, entry]));
    const parentRelative = relative(rootPath, path).split(sep).join("/");
    const names = new Set([...entries.keys(), ...(overrideChildren.get(parentRelative) ?? [])]);
    for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
      if (EXCLUDED_METADATA_FILES.has(name)) {
        continue;
      }
      const entry = entries.get(name);
      const child = join(path, name);
      check();
      if (++count > (options.maxEntries ?? 100_000)) throw new Error(`Skill contains too many entries to read completely: ${rootPath}`);
      const relativePath = relative(rootPath, child);
      const normalizedPath = relativePath.split(sep).join("/");
      const override = options.fileOverrides?.get(normalizedPath);
      if (!entry) {
        if (override !== undefined) {
          bytes += override.length;
          if (bytes > (options.maxBytes ?? 512 * 1024 * 1024)) throw new Error(`Skill exceeds the content read limit: ${rootPath}`);
          writeFrame(hash, "file", relativePath, override);
        } else {
          writeFrame(hash, "directory", relativePath);
          await hashDirectory(child, nextAncestors, depth + 1, true);
        }
        continue;
      }
      await remember(child);
      const childStats = entry.isSymbolicLink() ? await stat(child) : undefined;
      if (entry.isSymbolicLink()) await remember(await realpath(child));
      if (entry.isDirectory() || childStats?.isDirectory()) {
        if (override !== undefined) throw new Error(`Skill override cannot replace a directory: ${normalizedPath}`);
        writeFrame(hash, "directory", relativePath);
        await hashDirectory(child, nextAncestors, depth + 1);
      } else if (entry.isFile() || childStats?.isFile()) {
        if (overrideChildren.has(normalizedPath)) throw new Error(`Skill override parent is not a directory: ${normalizedPath}`);
        const file = await open(child, "r");
        try {
          const before = await file.stat();
          if (!before.isFile()) throw new Error(`Skill entry is not a regular file: ${child}`);
          bytes += override?.length ?? before.size;
          if (bytes > (options.maxBytes ?? 512 * 1024 * 1024)) throw new Error(`Skill exceeds the content read limit: ${rootPath}`);
          if (override !== undefined) {
            writeFrame(hash, "file", relativePath, override);
            continue;
          }
          const pathBytes = Buffer.from(relativePath.split(sep).join("/"), "utf8");
          hash.update("F");
          writeLength(hash, pathBytes.length);
          hash.update(pathBytes);
          writeLength(hash, before.size);
          let readBytes = 0;
          // Stream bounded chunks instead of allocating each complete file.
          while (readBytes < before.size) {
            check();
            const read = await file.read(buffer, 0, Math.min(buffer.length, before.size - readBytes), readBytes);
            if (!read.bytesRead) break;
            hash.update(buffer.subarray(0, read.bytesRead));
            readBytes += read.bytesRead;
          }
          if (readBytes !== before.size || stamp(await file.stat()) !== stamp(before)) {
            throw new ChangedSkillError(`Skill changed while reading: ${child}`);
          }
        } finally {
          await file.close();
        }
      } else {
        throw new Error(`Skill contains an unsupported filesystem entry: ${child}`);
      }
    }
  };
  await hashDirectory(rootPath);
  // Verification order does not affect the digest. Bound filesystem concurrency.
  const pending = [...stamps];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
    while (next < pending.length) {
      const [path, expected] = pending[next++];
      check();
      if (stamp(await lstat(path)) !== expected) throw new ChangedSkillError(`Skill changed while reading: ${path}`);
    }
  }));
  return hash.digest("hex");
};

export const hashSkillContent = async (path: string, options: SkillHashOptions = {}): Promise<string> => {
  try {
    return await hashSnapshot(path, options);
  } catch (error) {
    if (!(error instanceof ChangedSkillError)) throw error;
    return hashSnapshot(path, options);
  }
};
