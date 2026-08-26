import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { hashPathEntry } from "../filesystemIntegrity";
import { pathEntryExists, writeAtomic } from "../fileUtils";
import type { ConversationMoveCommit } from "../targets/types";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const rewriteJsonLines = (
  content: string,
  transform: (record: JsonRecord) => boolean
) => {
  let changed = 0;
  const lines = content.split("\n").map((line) => {
    if (!line.trim()) return line;
    try {
      const record = JSON.parse(line) as unknown;
      if (!isRecord(record) || !transform(record)) return line;
      changed += 1;
      return JSON.stringify(record);
    } catch {
      return line;
    }
  });
  return { content: lines.join("\n"), changed };
};

const contentHash = (content: string) =>
  createHash("sha256").update(content).digest("hex");

export const rewriteConversationJsonLines = async (
  path: string,
  transform: (record: JsonRecord) => boolean
): Promise<ConversationMoveCommit> => {
  const original = await readFile(path, "utf8");
  const expectedHash = await hashPathEntry(path);
  const rewritten = rewriteJsonLines(original, transform);
  if (rewritten.changed === 0 || rewritten.content === original) {
    throw new Error("The conversation does not contain a writable working-directory record");
  }
  await writeAtomic(path, rewritten.content, { expectedTargetHash: expectedHash });
  const committedHash = await hashPathEntry(path);
  return {
    rollback: async () => {
      await writeAtomic(path, original, { expectedTargetHash: committedHash });
    }
  };
};

export const rewriteConversationJsonFile = async (
  path: string,
  transform: (record: JsonRecord) => boolean
): Promise<ConversationMoveCommit> => {
  const original = await readFile(path, "utf8");
  const expectedHash = await hashPathEntry(path);
  const parsed = JSON.parse(original) as unknown;
  if (!isRecord(parsed) || !transform(parsed)) {
    throw new Error("The conversation does not contain a writable working-directory record");
  }
  const rewritten = `${JSON.stringify(parsed, null, 2)}\n`;
  await writeAtomic(path, rewritten, { expectedTargetHash: expectedHash });
  const committedHash = await hashPathEntry(path);
  return {
    rollback: () => writeAtomic(path, original, { expectedTargetHash: committedHash })
  };
};

export const moveAndRewriteConversationJsonLines = async (
  sourcePath: string,
  destinationPath: string,
  transform: (record: JsonRecord) => boolean
): Promise<ConversationMoveCommit> => {
  if (await pathEntryExists(destinationPath)) {
    throw new Error(`A conversation already exists at ${destinationPath}`);
  }
  const original = await readFile(sourcePath, "utf8");
  const sourceHash = await hashPathEntry(sourcePath);
  const rewritten = rewriteJsonLines(original, transform);
  if (rewritten.changed === 0) {
    throw new Error("The conversation does not contain a writable working-directory record");
  }
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
  await writeAtomic(destinationPath, rewritten.content, { mode: 0o600 });
  const destinationHash = await hashPathEntry(destinationPath);
  try {
    if (await hashPathEntry(sourcePath) !== sourceHash) {
      throw new Error("The conversation changed while it was being moved");
    }
    await rm(sourcePath);
  } catch (error) {
    if (
      await pathEntryExists(destinationPath) &&
      await hashPathEntry(destinationPath) === destinationHash
    ) {
      await rm(destinationPath, { force: true });
    }
    throw error;
  }
  return {
    rollback: async () => {
      if (await pathEntryExists(sourcePath)) {
        if (await hashPathEntry(sourcePath) !== sourceHash) {
          throw new Error("The original conversation path changed after the move");
        }
      } else {
        await writeAtomic(sourcePath, original, { mode: 0o600 });
      }
      if (await pathEntryExists(destinationPath)) {
        if (await hashPathEntry(destinationPath) !== destinationHash) {
          throw new Error("The moved conversation changed before rollback");
        }
        await rm(destinationPath, { force: true });
      }
    }
  };
};

export const setNestedString = (
  record: JsonRecord,
  keys: string[],
  value: string
) => {
  let current: JsonRecord = record;
  for (const key of keys.slice(0, -1)) {
    const next = current[key];
    if (!isRecord(next)) return false;
    current = next;
  }
  const key = keys.at(-1);
  if (!key || typeof current[key] !== "string") return false;
  if (current[key] === value) return false;
  current[key] = value;
  return true;
};

export const stableConversationContentHash = (value: {
  sourceId: string;
  title: string;
  messages: Array<{ id: string; role: string; text: string }>;
}) => contentHash(JSON.stringify({
  sourceId: value.sourceId,
  title: value.title,
  messages: value.messages.map(({ id, role, text }) => ({ id, role, text }))
}));
