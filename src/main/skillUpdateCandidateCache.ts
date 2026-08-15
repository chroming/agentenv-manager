import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { pathEntryExists } from "./fileUtils";
import { hashSkillContent } from "./skillContentHash";

interface CandidateManifest {
  formatVersion: 1;
  keyHash: string;
  contentHash: string;
  createdAt: string;
}

interface SkillUpdateCandidateCacheOptions {
  root: string;
  maxAgeMs?: number;
  maxBytes?: number;
  maxEntries?: number;
  now?: () => number;
}

const MANIFEST = "candidate.json";
const CONTENT = "content";

const keyHashFor = (key: string) => createHash("sha256").update(key).digest("hex");

const readManifest = async (path: string): Promise<CandidateManifest | undefined> => {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<CandidateManifest>;
    return value.formatVersion === 1 &&
      typeof value.keyHash === "string" &&
      typeof value.contentHash === "string" &&
      typeof value.createdAt === "string"
      ? value as CandidateManifest
      : undefined;
  } catch {
    return undefined;
  }
};

const directorySize = async (root: string): Promise<number> => {
  let total = 0;
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) total += (await lstat(path)).size;
    }
  };
  await walk(root);
  return total;
};

export const createSkillUpdateCandidateCache = ({
  root,
  maxAgeMs = 14 * 24 * 60 * 60 * 1000,
  maxBytes = 512 * 1024 * 1024,
  maxEntries = 32,
  now = Date.now
}: SkillUpdateCandidateCacheOptions) => {
  const writes = new Map<string, Promise<void>>();

  const entryPathFor = (keyHash: string) => join(root, keyHash);

  const removeInvalid = async (entryPath: string) => {
    await rm(entryPath, { recursive: true, force: true }).catch(() => undefined);
  };

  const restore = async (key: string, destination: string): Promise<boolean> => {
    const keyHash = keyHashFor(key);
    const entryPath = entryPathFor(keyHash);
    const manifest = await readManifest(join(entryPath, MANIFEST));
    if (!manifest || manifest.keyHash !== keyHash) {
      if (await pathEntryExists(entryPath)) await removeInvalid(entryPath);
      return false;
    }
    if (now() - Date.parse(manifest.createdAt) > maxAgeMs) {
      await removeInvalid(entryPath);
      return false;
    }
    const contentPath = join(entryPath, CONTENT);
    try {
      if (await hashSkillContent(contentPath) !== manifest.contentHash) {
        await removeInvalid(entryPath);
        return false;
      }
      await cp(contentPath, destination, { recursive: true, dereference: true });
      return true;
    } catch {
      await removeInvalid(entryPath);
      return false;
    }
  };

  const prune = async () => {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    const candidates = (await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".staging-"))
      .map(async (entry) => {
        const path = join(root, entry.name);
        const manifest = await readManifest(join(path, MANIFEST));
        const createdAt = manifest ? Date.parse(manifest.createdAt) : 0;
        const size = manifest ? await directorySize(path).catch(() => 0) : 0;
        return { path, createdAt, size, valid: Boolean(manifest) };
      })))
      .sort((left, right) => right.createdAt - left.createdAt);
    let retainedBytes = 0;
    await Promise.all(candidates.map(async (entry, index) => {
      const expired = !entry.valid || now() - entry.createdAt > maxAgeMs;
      const overEntryLimit = index >= maxEntries;
      const overSizeLimit = retainedBytes + entry.size > maxBytes;
      if (expired || overEntryLimit || overSizeLimit) {
        await removeInvalid(entry.path);
      } else {
        retainedBytes += entry.size;
      }
    }));
  };

  const save = (key: string, source: string, contentHash: string): Promise<void> => {
    const keyHash = keyHashFor(key);
    const existing = writes.get(keyHash);
    if (existing) return existing;
    const operation = (async () => {
      await mkdir(root, { recursive: true });
      const staging = await mkdtemp(join(root, ".staging-"));
      try {
        const contentPath = join(staging, CONTENT);
        await cp(source, contentPath, { recursive: true, dereference: true });
        if (await hashSkillContent(contentPath) !== contentHash) {
          throw new Error("Skill update candidate changed while entering cache");
        }
        await writeFile(join(staging, MANIFEST), `${JSON.stringify({
          formatVersion: 1,
          keyHash,
          contentHash,
          createdAt: new Date(now()).toISOString()
        } satisfies CandidateManifest, null, 2)}\n`, { mode: 0o600 });
        const entryPath = entryPathFor(keyHash);
        await rm(entryPath, { recursive: true, force: true });
        await rename(staging, entryPath);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      void prune().catch(() => undefined);
    })();
    writes.set(keyHash, operation);
    void operation.then(
      () => {
        if (writes.get(keyHash) === operation) writes.delete(keyHash);
      },
      () => {
        if (writes.get(keyHash) === operation) writes.delete(keyHash);
      }
    );
    return operation;
  };

  return { prune, restore, save };
};
