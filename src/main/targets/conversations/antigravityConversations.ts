import { access, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { ConversationMessage } from "../../../shared/types";
import type {
  AgentConversationCandidate,
  AgentConversationCapability
} from "../types";
import {
  candidateForFile,
  conversationSnippetFrom,
  createConversationDetail,
  forEachJsonLine,
  isoDate,
  listFilesRecursively,
  stripConversationScaffolding,
  trimConversationText,
  visibleMessage
} from "../../conversations/adapterUtils";

const agent = { id: "antigravity", name: "Antigravity CLI" };

const appDataDirFor = (configDir: string) =>
  join(configDir, "..", "antigravity-cli");

const userRequestText = (content: string) => {
  const request = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i)?.[1];
  return trimConversationText(request ?? stripConversationScaffolding(content));
};

const readTranscript = async (
  candidate: Parameters<AgentConversationCapability["read"]>[1]
) => {
  const messages: ConversationMessage[] = [];
  let createdAt = candidate.createdAt;
  await forEachJsonLine(candidate.source.locator, (record: any, index) => {
    const timestamp = record?.created_at
      ? isoDate(record.created_at, new Date(candidate.updatedAt))
      : undefined;
    let message: ConversationMessage | undefined;
    if (record?.source === "USER_EXPLICIT" && record?.type === "USER_INPUT") {
      message = visibleMessage(
        `${candidate.recordId}:${record.step_index ?? index}`,
        "user",
        userRequestText(trimConversationText(record.content)),
        timestamp
      );
      createdAt ??= timestamp;
    } else if (record?.source === "MODEL" && typeof record?.content === "string") {
      message = visibleMessage(
        `${candidate.recordId}:${record.step_index ?? index}`,
        "assistant",
        trimConversationText(record.content),
        timestamp
      );
    }
    if (message) messages.push(message);
  });
  return createConversationDetail(agent, candidate, messages, {
    workspacePath: candidate.workspacePath,
    createdAt
  });
};

const workspaceByConversation = async (appDataDir: string) => {
  const result = new Map<string, string>();
  try {
    const value = JSON.parse(
      await readFile(join(appDataDir, "cache", "last_conversations.json"), "utf8")
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [workspacePath, conversationId] of Object.entries(value)) {
      if (typeof conversationId === "string" && conversationId) {
        result.set(conversationId, workspacePath);
      }
    }
  } catch {
    // Optional workspace metadata must not hide readable transcripts.
  }
  return result;
};

export const createAntigravityConversationCapability = (): AgentConversationCapability => ({
  historyDetail: "full",
  discover: async ({ targetPaths }) => {
    const appDataDir = appDataDirFor(targetPaths.configDir);
    const summariesPath = join(appDataDir, "conversation_summaries.db");
    const candidates = new Map<string, AgentConversationCandidate>();
    let summarySourceObserved = false;
    let summaryReadFailed = false;
    try {
      await access(summariesPath);
      const database = new DatabaseSync(summariesPath, { readOnly: true });
      try {
        const rows = database.prepare(`
          SELECT conversation_id, title, preview, step_count, last_modified_time,
                 workspace_uris, last_user_input_time
          FROM conversation_summaries
          ORDER BY last_modified_time DESC
        `).all() as Array<Record<string, string | number>>;
        for (const row of rows) {
          let workspacePath: string | undefined;
          try {
            const uris = JSON.parse(String(row.workspace_uris ?? "[]"));
            const first = Array.isArray(uris) ? uris[0] : undefined;
            if (typeof first === "string") {
              workspacePath = first.startsWith("file:")
                ? fileURLToPath(first)
                : first;
            }
          } catch {
            // A malformed optional workspace field does not invalidate the summary.
          }
          const updatedAt = isoDate(row.last_modified_time, new Date());
          const sourceId = String(row.conversation_id);
          candidates.set(sourceId, {
            recordId: sourceId,
            source: {
              version: `${row.last_modified_time}:${row.step_count}`,
              locator: summariesPath,
              runtimeHome: appDataDir
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
          });
        }
        summarySourceObserved = true;
      } finally {
        database.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        summaryReadFailed = true;
      }
    }

    const brainRoot = join(appDataDir, "brain");
    const workspaces = await workspaceByConversation(appDataDir);
    const transcriptPaths = await listFilesRecursively(
      brainRoot,
      (path) => path.endsWith(join(".system_generated", "logs", "transcript.jsonl"))
    );
    for (const path of transcriptPaths) {
      const conversationId = basename(dirname(dirname(dirname(path))));
      const summary = candidates.get(conversationId);
      const transcript = await candidateForFile(path, {
        recordId: conversationId,
        providerSession: {
          kind: "file",
          id: conversationId,
          resumeLocator: conversationId
        },
        runtimeHome: appDataDir,
        title: summary?.title,
        workspacePath: workspaces.get(conversationId) ?? summary?.workspacePath,
        createdAt: summary?.createdAt,
        detailState: "full"
      });
      candidates.set(conversationId, {
        ...transcript,
        source: {
          ...transcript.source,
          version: summary
            ? `${transcript.source.version}:${summary.source.version}`
            : transcript.source.version
        },
        updatedAt: summary && summary.updatedAt > transcript.updatedAt
          ? summary.updatedAt
          : transcript.updatedAt
      });
    }

    let transcriptSourceObserved = transcriptPaths.length > 0;
    if (!transcriptSourceObserved) {
      try {
        await access(brainRoot);
        transcriptSourceObserved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return {
      candidates: [...candidates.values()],
      complete: !summaryReadFailed && (summarySourceObserved || transcriptSourceObserved)
    };
  },
  read: async (_context, candidate) =>
    candidate.detailState === "full"
      ? readTranscript(candidate)
      : createConversationDetail(agent, candidate, [], {
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
