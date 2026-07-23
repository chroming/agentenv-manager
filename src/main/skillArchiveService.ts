import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Open, type ZipEntry } from "unzipper";
import type { LocalSkillSourceSelection } from "../shared/types";

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_COUNT = 5_000;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMBOLIC_LINK = 0o120000;

interface PreparedArchive {
  rootPath: string;
}

const safeArchivePath = (entry: ZipEntry) => {
  if (!entry.path || entry.path.includes("\0")) {
    throw new Error("ZIP contains an invalid empty file name");
  }
  const slashPath = entry.path.replace(/\\/g, "/");
  if (isAbsolute(slashPath) || /^[a-zA-Z]:\//.test(slashPath)) {
    throw new Error(`ZIP contains an absolute path: ${entry.path}`);
  }
  const normalized = posix.normalize(slashPath).replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`ZIP contains an unsafe path: ${entry.path}`);
  }
  return normalized.replace(/\/+$/, "");
};

const isSymbolicLink = (entry: ZipEntry) =>
  ((entry.externalFileAttributes >>> 16) & UNIX_FILE_TYPE_MASK) === UNIX_SYMBOLIC_LINK;

export interface SkillArchiveService {
  prepare(archivePath: string): Promise<LocalSkillSourceSelection>;
  release(token: string): Promise<void>;
  dispose(): Promise<void>;
}

export const createSkillArchiveService = (): SkillArchiveService => {
  const prepared = new Map<string, PreparedArchive>();

  const release = async (token: string) => {
    const archive = prepared.get(token);
    if (!archive) return;
    prepared.delete(token);
    await rm(archive.rootPath, { recursive: true, force: true });
  };

  const prepare = async (archivePath: string): Promise<LocalSkillSourceSelection> => {
    const canonicalArchive = resolve(archivePath);
    if (extname(canonicalArchive).toLowerCase() !== ".zip") {
      throw new Error("Choose a ZIP archive or a folder");
    }
    const archiveStats = await stat(canonicalArchive);
    if (!archiveStats.isFile()) throw new Error("Selected ZIP is not a regular file");
    if (archiveStats.size > MAX_ARCHIVE_BYTES) {
      throw new Error("ZIP is larger than the 100 MB import limit");
    }

    const directory = await Open.file(canonicalArchive);
    if (directory.files.length > MAX_ENTRY_COUNT) {
      throw new Error(`ZIP contains more than ${MAX_ENTRY_COUNT} entries`);
    }
    let expandedBytes = 0;
    const seenPaths = new Set<string>();
    const entries = directory.files.map((entry) => {
      const path = safeArchivePath(entry);
      const canonicalKey = path.normalize("NFC");
      if (seenPaths.has(canonicalKey)) {
        throw new Error(`ZIP contains a duplicate path: ${entry.path}`);
      }
      seenPaths.add(canonicalKey);
      if ((entry.flags & 0x1) !== 0) {
        throw new Error(`Encrypted ZIP entries are not supported: ${entry.path}`);
      }
      if (isSymbolicLink(entry)) {
        throw new Error(`ZIP symbolic links are not allowed: ${entry.path}`);
      }
      if (entry.type === "File" && entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw new Error(`ZIP uses an unsupported compression method: ${entry.path}`);
      }
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`ZIP entry is larger than the 32 MB limit: ${entry.path}`);
      }
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new Error("ZIP expands beyond the 128 MB import limit");
      }
      return { entry, path };
    });

    const token = randomUUID();
    const rootPath = await mkdtemp(join(tmpdir(), "agentenv-skill-archive-"));
    let writtenBytes = 0;
    try {
      for (const { entry, path } of entries) {
        const targetPath = resolve(rootPath, path);
        const child = relative(rootPath, targetPath);
        if (!child || child.startsWith("..") || isAbsolute(child)) {
          throw new Error(`ZIP contains an unsafe path: ${entry.path}`);
        }
        if (entry.type === "Directory") {
          await mkdir(targetPath, { recursive: true });
          continue;
        }
        await mkdir(dirname(targetPath), { recursive: true });
        let entryBytes = 0;
        const limitOutput = new Transform({
          transform(chunk, _encoding, callback) {
            entryBytes += chunk.length;
            writtenBytes += chunk.length;
            if (entryBytes > MAX_ENTRY_BYTES) {
              callback(new Error(`ZIP entry is larger than the 32 MB limit: ${entry.path}`));
              return;
            }
            if (writtenBytes > MAX_EXPANDED_BYTES) {
              callback(new Error("ZIP expands beyond the 128 MB import limit"));
              return;
            }
            callback(null, chunk);
          }
        });
        await pipeline(
          entry.stream(),
          limitOutput,
          createWriteStream(targetPath, { flags: "wx", mode: 0o600 })
        );
      }
      prepared.set(token, { rootPath });
      return {
        kind: "archive",
        path: canonicalArchive,
        rootPath,
        archiveToken: token
      };
    } catch (error) {
      await rm(rootPath, { recursive: true, force: true });
      throw error;
    }
  };

  return {
    prepare,
    release,
    dispose: async () => {
      const tokens = [...prepared.keys()];
      await Promise.all(tokens.map(release));
    }
  };
};
