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

const agent = { id: "codex", name: "Codex" };

const contentText = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type?: string; text?: unknown } =>
      Boolean(item && typeof item === "object")
    )
    .filter((item) => item.type === "input_text" || item.type === "output_text")
    .map((item) => trimConversationText(item.text))
    .filter(Boolean)
    .join("\n\n");
};

export const parseCodexConversation = (
  candidate: Parameters<AgentConversationCapability["read"]>[1],
  content: string
) => {
  const messages: ConversationMessage[] = [];
  let sessionId = candidate.sourceId;
  let workspacePath = candidate.workspacePath;
  let createdAt = candidate.createdAt;

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type === "session_meta" && record.payload && typeof record.payload === "object") {
      sessionId = String(record.payload.id ?? record.payload.session_id ?? sessionId);
      workspacePath = trimConversationText(record.payload.cwd) || workspacePath;
      createdAt = isoDate(record.payload.timestamp, new Date(candidate.updatedAt));
      continue;
    }
    if (record?.type !== "response_item" || record.payload?.type !== "message") continue;
    const message = visibleMessage(
      String(record.payload.id ?? `${sessionId}:${index}`),
      record.payload.role,
      contentText(record.payload.content)
    );
    if (message) messages.push(message);
  }

  return createConversationDetail(
    agent,
    { ...candidate, sourceId: sessionId },
    messages,
    { workspacePath, createdAt }
  );
};

export const createCodexConversationCapability = (): AgentConversationCapability => ({
  discover: async ({ targetPaths }) => {
    const roots = [
      { path: join(targetPaths.configDir, "sessions"), archived: false },
      { path: join(targetPaths.configDir, "archived_sessions"), archived: true }
    ];
    const candidates = [];
    for (const root of roots) {
      for (const path of await listFilesRecursively(root.path, (file) => file.endsWith(".jsonl"))) {
        const info = await stat(path);
        if (info.size > MAX_CONVERSATION_SOURCE_BYTES) continue;
        candidates.push(await candidateForFile(path, {
          sourceId: sourceIdFromFilename(path),
          detailState: "full",
          archived: root.archived
        }));
      }
    }
    return candidates;
  },
  read: async (_context, candidate) =>
    parseCodexConversation(candidate, await readFile(candidate.sourceLocator, "utf8")),
  openOriginal: ({ executablePath }, candidate) => executablePath
    ? {
        executablePath,
        args: [
          "resume",
          candidate.sourceId,
          ...(candidate.workspacePath ? ["-C", candidate.workspacePath] : [])
        ],
        cwd: candidate.workspacePath
      }
    : undefined,
  continueWithContext: ({ executablePath, conversation, contextFilePath }) => executablePath
    ? {
        executablePath,
        args: [
          ...(conversation.workspacePath ? ["-C", conversation.workspacePath] : []),
          "--add-dir",
          dirname(contextFilePath),
          `Read the continuation context at ${contextFilePath}, then continue the user's work.`
        ],
        cwd: conversation.workspacePath
      }
    : undefined
});
