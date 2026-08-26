import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentConversationCapability } from "../types";
import {
  candidateForFile,
  forEachJsonLine,
  listFilesRecursively,
  sourceIdFromFilename
} from "../../conversations/adapterUtils";
import {
  parseRolloutConversation,
  readRolloutConversation
} from "./rolloutConversations";
import {
  rewriteConversationJsonLines,
  setNestedString
} from "../../conversations/conversationMoveStorage";

const agent = { id: "codex", name: "Codex" };

interface CodexTitleIndexCache {
  version: string;
  titles: Map<string, string>;
}

const titleVersion = (title?: string) => createHash("sha256")
  .update(title ?? "")
  .digest("hex");

const readCodexTitleIndex = async (
  configDir: string,
  previous?: CodexTitleIndexCache
): Promise<{
  cache: CodexTitleIndexCache;
  failure?: string;
}> => {
  const path = join(configDir, "session_index.jsonl");
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        cache: previous?.version === "missing"
          ? previous
          : { version: "missing", titles: new Map() }
      };
    }
    return {
      cache: previous ?? { version: "unavailable", titles: new Map() },
      failure: "Codex native conversation titles could not be read; generated titles were kept."
    };
  }
  const version = [info.size, Math.trunc(info.mtimeMs), info.dev, info.ino].join(":");
  if (previous?.version === version) return { cache: previous };

  const titles = new Map<string, string>();
  try {
    await forEachJsonLine(path, (record) => {
      if (!record || typeof record !== "object") return;
      const entry = record as { id?: unknown; thread_name?: unknown };
      if (typeof entry.id !== "string" || typeof entry.thread_name !== "string") return;
      const id = entry.id.trim();
      const title = entry.thread_name.trim();
      if (id && title) titles.set(id, title);
    });
    return { cache: { version, titles } };
  } catch {
    return {
      cache: previous ?? { version: "unavailable", titles: new Map() },
      failure: "Codex native conversation titles could not be read; generated titles were kept."
    };
  }
};

export const parseCodexConversation = (
  candidate: Parameters<AgentConversationCapability["read"]>[1],
  content: string
) => parseRolloutConversation(agent, candidate, content);

export const createCodexConversationCapability = (): AgentConversationCapability => {
  let titleIndexCache: CodexTitleIndexCache | undefined;
  return {
    historyDetail: "full",
    discover: async ({ targetPaths }) => {
      const titleIndex = await readCodexTitleIndex(targetPaths.configDir, titleIndexCache);
      titleIndexCache = titleIndex.cache;
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
        for (const path of await listFilesRecursively(
          root.path,
          (file) => file.endsWith(".jsonl")
        )) {
          const sourceId = sourceIdFromFilename(path);
          const title = titleIndexCache.titles.get(sourceId);
          const candidate = await candidateForFile(path, {
            recordId: sourceId,
            providerSession: {
              kind: "native",
              id: sourceId,
              resumeLocator: sourceId
            },
            runtimeHome: targetPaths.configDir,
            detailState: "full",
            archived: root.archived,
            title
          });
          candidate.source.version = `${candidate.source.version}:${titleVersion(title)}`;
          candidates.push(candidate);
        }
      }
      return {
        candidates,
        complete: primaryRootObserved,
        ...(titleIndex.failure ? { failures: [titleIndex.failure] } : {})
      };
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
    continueWithContext: ({ executablePath, conversation, contextFilePath }) =>
      executablePath
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
        : undefined,
    move: ({ candidate, destinationPath }) =>
      rewriteConversationJsonLines(candidate.source.locator, (record) => {
        if (record.type === "session_meta") {
          return setNestedString(record, ["payload", "cwd"], destinationPath);
        }
        if (record.type === "turn_context") {
          return setNestedString(record, ["payload", "cwd"], destinationPath);
        }
        return false;
      })
  };
};
