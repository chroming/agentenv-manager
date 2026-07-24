import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationRole
} from "../../shared/types";
import type { AgentConversationCandidate } from "../targets/types";

const execFileAsync = promisify(execFile);
export const MAX_CONVERSATION_SOURCE_BYTES = 24 * 1024 * 1024;

export const trimConversationText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const conversationTitleFrom = (value: string, fallback = "Untitled conversation") => {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 96) : fallback;
};

export const conversationSnippetFrom = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 180);

export const isoDate = (value: unknown, fallback: Date): string => {
  const date = typeof value === "number" || typeof value === "string"
    ? new Date(value)
    : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
};

export const listFilesRecursively = async (
  root: string,
  accepts: (path: string) => boolean
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
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && accepts(path)) files.push(path);
    }
  };
  await visit(root);
  return files;
};

export const candidateForFile = async (
  path: string,
  input: Omit<AgentConversationCandidate, "sourceVersion" | "sourceLocator" | "updatedAt"> & {
    updatedAt?: string;
  }
): Promise<AgentConversationCandidate> => {
  const info = await stat(path);
  return {
    ...input,
    sourceLocator: path,
    sourceVersion: `${info.size}:${Math.trunc(info.mtimeMs)}`,
    updatedAt: input.updatedAt ?? info.mtime.toISOString()
  };
};

export const sourceIdFromFilename = (path: string) => {
  const filename = basename(path).replace(/\.(?:jsonl|json|db)$/i, "");
  const uuid = filename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuid?.[0] ?? filename;
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
  const firstUser = messages.find((message) => message.role === "user")?.text ?? "";
  const firstAssistant = messages.find((message) => message.role === "assistant")?.text ?? "";
  const titleSource = metadata.title || candidate.title || firstUser || firstAssistant;
  const snippetSource =
    metadata.snippet || candidate.snippet || firstUser || firstAssistant;
  return {
    id: `${agent.id}:${candidate.sourceId}`,
    agentId: agent.id,
    agentName: agent.name,
    sourceId: candidate.sourceId,
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
  if ((role !== "user" && role !== "assistant") || !text.trim()) return undefined;
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
