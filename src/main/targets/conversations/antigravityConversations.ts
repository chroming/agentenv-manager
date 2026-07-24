import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentConversationCapability } from "../types";
import {
  conversationSnippetFrom,
  createConversationDetail,
  isoDate,
  trimConversationText
} from "../../conversations/adapterUtils";

const agent = { id: "antigravity", name: "Antigravity CLI" };

export const createAntigravityConversationCapability = (): AgentConversationCapability => ({
  historyDetail: "summary-only",
  discover: async ({ targetPaths }) => {
    const summariesPath = join(
      targetPaths.configDir,
      "..",
      "antigravity-cli",
      "conversation_summaries.db"
    );
    try {
      await access(summariesPath);
    } catch {
      return { candidates: [], complete: false };
    }
    const database = new DatabaseSync(summariesPath, { readOnly: true });
    try {
      const rows = database.prepare(`
        SELECT conversation_id, title, preview, step_count, last_modified_time,
               workspace_uris, last_user_input_time
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
      `).all() as Array<Record<string, string | number>>;
      return {
        candidates: rows.map((row) => {
        let workspacePath: string | undefined;
        try {
          const uris = JSON.parse(String(row.workspace_uris ?? "[]"));
          const first = Array.isArray(uris) ? uris[0] : undefined;
          if (typeof first === "string") workspacePath = first.replace(/^file:\/\//, "");
        } catch {
          // A malformed optional workspace field does not invalidate the summary.
        }
        const updatedAt = isoDate(row.last_modified_time, new Date());
        const sourceId = String(row.conversation_id);
        return {
          recordId: sourceId,
          source: {
            version: `${row.last_modified_time}:${row.step_count}`,
            locator: summariesPath,
            runtimeHome: targetPaths.configDir
          },
          providerSession: {
            kind: "database" as const,
            id: sourceId,
            resumeLocator: sourceId
          },
          title: trimConversationText(row.title),
          snippet: conversationSnippetFrom(trimConversationText(row.preview)),
          workspacePath,
          createdAt: isoDate(row.last_user_input_time, new Date(updatedAt)),
          updatedAt,
          messageCount: Number(row.step_count ?? 0),
          detailState: "summary-only" as const
        };
        }),
        complete: true
      };
    } finally {
      database.close();
    }
  },
  read: async (_context, candidate) => createConversationDetail(agent, candidate, [], {
    title: candidate.title,
    snippet: candidate.snippet,
    workspacePath: candidate.workspacePath,
    createdAt: candidate.createdAt
  }),
  openOriginal: ({ executablePath }, candidate) => executablePath
    ? {
        executablePath,
        args: [
          "--conversation",
          candidate.providerSession?.resumeLocator ??
            candidate.providerSession?.id ??
            candidate.recordId
        ],
        cwd: candidate.workspacePath
      }
    : undefined,
  continueWithContext: ({ executablePath, conversation, contextFilePath }) => executablePath
    ? {
        executablePath,
        args: [
          "--add-dir",
          dirname(contextFilePath),
          "--prompt-interactive",
          `Read the continuation context at ${contextFilePath}, then continue the user's work.`
        ],
        cwd: conversation.workspacePath
      }
    : undefined
});
