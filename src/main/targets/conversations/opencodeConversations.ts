import type { ConversationMessage } from "../../../shared/types";
import type { AgentConversationCapability } from "../types";
import {
  conversationSnippetFrom,
  createConversationDetail,
  isoDate,
  runJsonCommand,
  trimConversationText,
  visibleMessage
} from "../../conversations/adapterUtils";

const agent = { id: "opencode", name: "OpenCode" };

interface OpenCodeSession {
  id: string;
  title?: string;
  directory?: string;
  created?: number;
  updated?: number;
}

export const parseOpenCodeExportMessages = (value: any): ConversationMessage[] => {
  if (!Array.isArray(value?.messages)) return [];
  return value.messages.flatMap((entry: any, index: number) => {
    const role = entry?.info?.role;
    const text = Array.isArray(entry?.parts)
      ? entry.parts
          .filter((part: any) => part?.type === "text")
          .map((part: any) => trimConversationText(part.text))
          .filter(Boolean)
          .join("\n\n")
      : "";
    const created = entry?.info?.time?.created;
    const message = visibleMessage(
      String(entry?.info?.id ?? `${index}`),
      role,
      text,
      created ? isoDate(created, new Date()) : undefined
    );
    return message ? [message] : [];
  });
};

export const createOpenCodeConversationCapability = (): AgentConversationCapability => ({
  discover: async ({ executablePath }) => {
    if (!executablePath) return [];
    const raw = await runJsonCommand(executablePath, ["session", "list", "--format", "json"]);
    if (!Array.isArray(raw)) throw new Error("OpenCode returned an invalid session list");
    return raw.flatMap((item: OpenCodeSession) => {
      if (!item || typeof item.id !== "string") return [];
      const updatedAt = isoDate(item.updated, new Date());
      return [{
        sourceId: item.id,
        sourceVersion: String(item.updated ?? item.created ?? ""),
        sourceLocator: item.id,
        title: trimConversationText(item.title),
        snippet: conversationSnippetFrom(trimConversationText(item.title)),
        workspacePath: trimConversationText(item.directory) || undefined,
        createdAt: isoDate(item.created, new Date(updatedAt)),
        updatedAt,
        detailState: "full" as const
      }];
    });
  },
  read: async ({ executablePath }, candidate) => {
    if (!executablePath) throw new Error("OpenCode command is unavailable");
    const exported = await runJsonCommand(executablePath, [
      "export",
      candidate.sourceId,
      "--sanitize"
    ]);
    return createConversationDetail(agent, candidate, parseOpenCodeExportMessages(exported));
  },
  openOriginal: ({ executablePath }, candidate) => executablePath
    ? {
        executablePath,
        args: [
          ...(candidate.workspacePath ? [candidate.workspacePath] : []),
          "--session",
          candidate.sourceId
        ],
        cwd: candidate.workspacePath
      }
    : undefined,
  continueWithContext: ({ executablePath, conversation, contextFilePath }) => executablePath
    ? {
        executablePath,
        args: [
          "run",
          "--interactive",
          ...(conversation.workspacePath ? ["--dir", conversation.workspacePath] : []),
          "--file",
          contextFilePath,
          "--title",
          "Continued conversation",
          "Continue the work using the attached conversation context."
        ],
        cwd: conversation.workspacePath
      }
    : undefined
});
