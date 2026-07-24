import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConversationMessage } from "../../../shared/types";
import type { AgentConversationCapability } from "../types";
import {
  MAX_CONVERSATION_SOURCE_BYTES,
  candidateForFile,
  createConversationDetail,
  isoDate,
  listFilesRecursively,
  sourceIdFromFilename,
  trimConversationText,
  visibleMessage
} from "../../conversations/adapterUtils";

const agent = { id: "claude-code", name: "Claude Code" };

const claudeText = (message: unknown) => {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type?: string; text?: unknown } =>
      Boolean(block && typeof block === "object")
    )
    .filter((block) => block.type === "text")
    .map((block) => trimConversationText(block.text))
    .filter(Boolean)
    .join("\n\n");
};

export const parseClaudeConversation = (
  candidate: Parameters<AgentConversationCapability["read"]>[1],
  content: string
) => {
  const messages: ConversationMessage[] = [];
  let sessionId = candidate.sourceId;
  let workspacePath = candidate.workspacePath;
  let createdAt = candidate.createdAt;
  let summary = candidate.title;

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    sessionId = String(record.sessionId ?? sessionId);
    workspacePath = trimConversationText(record.cwd) || workspacePath;
    if (record.timestamp && !createdAt) {
      createdAt = isoDate(record.timestamp, new Date(candidate.updatedAt));
    }
    if (record.type === "summary") {
      summary = trimConversationText(record.summary) || summary;
      continue;
    }
    const message = visibleMessage(
      String(record.uuid ?? `${sessionId}:${index}`),
      record.type,
      claudeText(record.message),
      record.timestamp ? isoDate(record.timestamp, new Date(candidate.updatedAt)) : undefined
    );
    if (message) messages.push(message);
  }

  return createConversationDetail(
    agent,
    { ...candidate, sourceId: sessionId },
    messages,
    { title: summary, workspacePath, createdAt }
  );
};

export const createClaudeConversationCapability = (): AgentConversationCapability => ({
  discover: async ({ targetPaths }) => {
    const paths = await listFilesRecursively(
      join(targetPaths.configDir, "projects"),
      (file) => file.endsWith(".jsonl")
    );
    const candidates = [];
    for (const path of paths) {
      const info = await stat(path);
      if (info.size > MAX_CONVERSATION_SOURCE_BYTES) continue;
      candidates.push(await candidateForFile(path, {
        sourceId: sourceIdFromFilename(path),
        detailState: "full"
      }));
    }
    return candidates;
  },
  read: async (_context, candidate) =>
    parseClaudeConversation(candidate, await readFile(candidate.sourceLocator, "utf8")),
  openOriginal: ({ executablePath }, candidate) => executablePath
    ? {
        executablePath,
        args: ["--resume", candidate.sourceId],
        cwd: candidate.workspacePath
      }
    : undefined,
  continueWithContext: ({ executablePath, conversation, contextFilePath }) => executablePath
    ? {
        executablePath,
        args: [
          "--add-dir",
          dirname(contextFilePath),
          `Read the continuation context at ${contextFilePath}, then continue the user's work.`
        ],
        cwd: conversation.workspacePath
      }
    : undefined
});
