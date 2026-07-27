import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentConversationCapability } from "../types";
import {
  candidateForFile,
  listFilesRecursively,
  sourceIdFromFilename
} from "../../conversations/adapterUtils";
import {
  parseRolloutConversation,
  readRolloutConversation
} from "./rolloutConversations";

const agent = { id: "codex", name: "Codex" };

export const parseCodexConversation = (
  candidate: Parameters<AgentConversationCapability["read"]>[1],
  content: string
) => parseRolloutConversation(agent, candidate, content);

export const createCodexConversationCapability = (): AgentConversationCapability => ({
  historyDetail: "full",
  discover: async ({ targetPaths }) => {
    const roots = [
      { path: join(targetPaths.configDir, "sessions"), archived: false },
      { path: join(targetPaths.configDir, "archived_sessions"), archived: true }
    ];
    const candidates = [];
    let primaryRootObserved = false;
    for (const root of roots) {
      try {
        await stat(root.path);
        if (!root.archived) primaryRootObserved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const path of await listFilesRecursively(root.path, (file) => file.endsWith(".jsonl"))) {
        const sourceId = sourceIdFromFilename(path);
        candidates.push(await candidateForFile(path, {
          recordId: sourceId,
          providerSession: {
            kind: "native",
            id: sourceId,
            resumeLocator: sourceId
          },
          runtimeHome: targetPaths.configDir,
          detailState: "full",
          archived: root.archived
        }));
      }
    }
    return { candidates, complete: primaryRootObserved };
  },
  read: async (_context, candidate, previous) =>
    readRolloutConversation(agent, candidate, previous),
  openOriginal: ({ executablePath }, candidate) => executablePath
    ? {
        executablePath,
        args: [
          "resume",
          candidate.providerSession?.resumeLocator ??
            candidate.providerSession?.id ??
            candidate.recordId,
          ...(candidate.workspacePath ? ["-C", candidate.workspacePath] : [])
        ],
        cwd: candidate.workspacePath,
        ...(candidate.source.runtimeHome
          ? { env: { CODEX_HOME: candidate.source.runtimeHome } }
          : {})
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
