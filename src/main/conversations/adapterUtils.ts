import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationRole
} from "../../shared/types";
import type { AgentConversationCandidate } from "../targets/types";

const execFileAsync = promisify(execFile);

export const trimConversationText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const conversationTitleFrom = (value: string, fallback = "Untitled conversation") => {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 96) : fallback;
};

export const conversationSnippetFrom = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 180);

const conversationScaffoldingPrefixes = [
  "<app-context",
  "<apps_instructions",
  "<collaboration_mode",
  "<environment_context",
  "<permissions instructions",
  "<plugins_instructions",
  "<recommended_plugins",
  "<skill>",
  "<skill ",
  "<skills_instructions",
  "<image name=",
  "# AGENTS.md instructions"
];

export const isConversationScaffolding = (value: string) => {
  const normalized = value.trimStart().toLowerCase();
  return conversationScaffoldingPrefixes.some((prefix) =>
    normalized.startsWith(prefix.toLowerCase()));
};

export const isoDate = (value: unknown, fallback: Date): string => {
  const date = typeof value === "number" || typeof value === "string"
    ? new Date(value)
    : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
};

export const listFilesRecursively = async (
  root: string,
  accepts: (path: string) => boolean,
  options: {
    shouldEnterDirectory?: (path: string, name: string) => boolean;
  } = {}
): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (directory: string) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (
        entry.isDirectory() &&
        (options.shouldEnterDirectory?.(path, entry.name) ?? true)
      ) {
        await visit(path);
      }
      else if (entry.isFile() && accepts(path)) files.push(path);
    }
  };
  await visit(root);
  return files;
};

export const candidateForFile = async (
  path: string,
  input: Omit<AgentConversationCandidate, "source" | "updatedAt"> & {
    updatedAt?: string;
    runtimeHome?: string;
  }
): Promise<AgentConversationCandidate> => {
  const info = await stat(path);
  const handle = await open(path, "r");
  const sampleHash = async (position: number, length: number) => {
    if (length === 0) return createHash("sha256").digest("hex");
    const bytes = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(bytes, 0, length, position);
    return createHash("sha256").update(bytes.subarray(0, bytesRead)).digest("hex");
  };
  const sampleSize = Math.min(info.size, 4 * 1024);
  let headHash: string;
  let tailHash: string;
  try {
    [headHash, tailHash] = await Promise.all([
      sampleHash(0, sampleSize),
      sampleHash(Math.max(0, info.size - sampleSize), sampleSize)
    ]);
  } finally {
    await handle.close();
  }
  const { runtimeHome, ...candidate } = input;
  return {
    ...candidate,
    source: {
      locator: path,
      version: [
        info.size,
        Math.trunc(info.mtimeMs),
        info.dev,
        info.ino,
        headHash,
        tailHash
      ].join(":"),
      runtimeHome
    },
    updatedAt: input.updatedAt ?? info.mtime.toISOString()
  };
};

export const sourceIdFromFilename = (path: string) => {
  const filename = basename(path).replace(/\.(?:jsonl|json|db)$/i, "");
  const uuid = filename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuid?.[0] ?? filename;
};

export const forEachJsonLine = async (
  path: string,
  visitor: (record: unknown, index: number) => void,
  options: { start?: number } = {}
) => {
  const input = createReadStream(path, {
    encoding: "utf8",
    start: options.start ?? 0
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const line of lines) {
      const current = index++;
      if (!line.trim()) continue;
      try {
        visitor(JSON.parse(line), current);
      } catch {
        // A malformed record does not invalidate the rest of an append-only transcript.
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
};

export const sourceByteSize = (version: string): number | undefined => {
  const value = Number(version.split(":", 1)[0]);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

const parseFileSourceVersion = (version: string) => {
  const [size, _mtime, dev, ino, headHash, tailHash] = version.split(":");
  const byteSize = Number(size);
  return Number.isSafeInteger(byteSize) && byteSize >= 0 && dev && ino && headHash && tailHash
    ? { byteSize, dev, ino, headHash, tailHash }
    : undefined;
};

export const canResumeJsonLines = async (
  path: string,
  previousVersion: string,
  currentVersion: string
) => {
  const previous = parseFileSourceVersion(previousVersion);
  const current = parseFileSourceVersion(currentVersion);
  if (
    !previous ||
    !current ||
    current.byteSize <= previous.byteSize ||
    current.dev !== previous.dev ||
    current.ino !== previous.ino
  ) {
    return false;
  }
  const handle = await open(path, "r");
  try {
    const sampleSize = Math.min(previous.byteSize, 4 * 1024);
    const readHash = async (position: number, length: number) => {
      const bytes = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(bytes, 0, length, position);
      return {
        bytes: bytes.subarray(0, bytesRead),
        hash: createHash("sha256")
          .update(bytes.subarray(0, bytesRead))
          .digest("hex")
      };
    };
    const [head, tail] = await Promise.all([
      readHash(0, sampleSize),
      readHash(Math.max(0, previous.byteSize - sampleSize), sampleSize)
    ]);
    return (
      head.hash === previous.headHash &&
      tail.hash === previous.tailHash &&
      tail.bytes.length > 0 &&
      tail.bytes[tail.bytes.length - 1] === 0x0a
    );
  } finally {
    await handle.close();
  }
};

export const createConversationDetail = (
  agent: { id: string; name: string },
  candidate: AgentConversationCandidate,
  messages: ConversationMessage[],
  metadata: {
    title?: string;
    snippet?: string;
    workspacePath?: string;
    createdAt?: string;
  } = {}
): ConversationDetail => {
  const firstUser = messages.find(
    (message) => message.role === "user" && !isConversationScaffolding(message.text)
  )?.text ?? "";
  const firstAssistant = messages.find((message) => message.role === "assistant")?.text ?? "";
  const firstMeaningful = (...values: Array<string | undefined>) =>
    values.find((value) => value?.trim() && !isConversationScaffolding(value)) ?? "";
  const titleSource = firstMeaningful(
    metadata.title,
    candidate.title,
    firstUser,
    firstAssistant
  );
  const snippetSource = firstMeaningful(
    metadata.snippet,
    candidate.snippet,
    firstUser,
    firstAssistant
  );
  return {
    id: `${agent.id}:${candidate.recordId}`,
    agentId: agent.id,
    agentName: agent.name,
    sourceId: candidate.providerSession?.id ?? candidate.recordId,
    title: conversationTitleFrom(titleSource),
    snippet: conversationSnippetFrom(snippetSource),
    workspacePath: metadata.workspacePath ?? candidate.workspacePath,
    createdAt: metadata.createdAt ?? candidate.createdAt ?? candidate.updatedAt,
    updatedAt: candidate.updatedAt,
    messageCount: messages.length || candidate.messageCount || 0,
    detailState: candidate.detailState,
    archived: candidate.archived,
    messages
  };
};

export const visibleMessage = (
  id: string,
  role: unknown,
  text: string,
  createdAt?: string
): ConversationMessage | undefined => {
  if (
    (role !== "user" && role !== "assistant") ||
    !text.trim() ||
    (role === "user" && isConversationScaffolding(text))
  ) {
    return undefined;
  }
  return {
    id,
    role: role as ConversationRole,
    text: text.trim(),
    createdAt
  };
};

export const runJsonCommand = async (
  executablePath: string,
  args: string[]
): Promise<unknown> => {
  const { stdout } = await execFileAsync(executablePath, args, {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env
  });
  return JSON.parse(stdout);
};
