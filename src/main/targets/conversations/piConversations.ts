import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  ConversationDetail,
  ConversationMessage
} from "../../../shared/types";
import type {
  AgentConversationCandidate,
  AgentConversationCapability
} from "../types";
import {
  candidateForFile,
  conversationTitleFrom,
  createConversationDetail,
  forEachJsonLine,
  isoDate,
  listFilesRecursively,
  sourceIdFromFilename,
  trimConversationText,
  visibleMessage
} from "../../conversations/adapterUtils";
import {
  rewriteConversationJsonLines,
  setNestedString
} from "../../conversations/conversationMoveStorage";

const agent = { id: "pi", name: "Pi" };

const contentText = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type?: string; text?: unknown } =>
      Boolean(item && typeof item === "object")
    )
    .filter((item) => item.type === "text")
    .map((item) => trimConversationText(item.text))
    .filter(Boolean)
    .join("\n\n");
};

const createPiAccumulator = (
  candidate: AgentConversationCandidate
) => {
  const entries = new Map<string, any>();
  let leafId: string | undefined;
  let sessionId =
    candidate.providerSession?.id ??
    candidate.recordId;
  let workspacePath = candidate.workspacePath;
  let createdAt = candidate.createdAt;
  let sessionName = candidate.title;

  const consume = (record: any) => {
    if (record?.type === "session") {
      sessionId = trimConversationText(record.id) || sessionId;
      workspacePath = trimConversationText(record.cwd) || workspacePath;
      createdAt = isoDate(record.timestamp, new Date(candidate.updatedAt));
      return;
    }
    if (!record || typeof record !== "object" || typeof record.id !== "string") {
      return;
    }
    entries.set(record.id, record);
    leafId = record.id;
    if (record.type === "session_info") {
      sessionName = trimConversationText(record.name) || undefined;
    }
  };

  const finish = (): ConversationDetail => {
    const activePath: any[] = [];
    const seen = new Set<string>();
    let currentId = leafId;
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const entry = entries.get(currentId);
      if (!entry) break;
      activePath.push(entry);
      currentId =
        typeof entry.parentId === "string" && entry.parentId
          ? entry.parentId
          : undefined;
    }
    activePath.reverse();

    const messages: ConversationMessage[] = [];
    for (const entry of activePath) {
      if (entry.type !== "message" || !entry.message) continue;
      const message = visibleMessage(
        entry.id,
        entry.message.role,
        contentText(entry.message.content),
        entry.timestamp
          ? isoDate(entry.timestamp, new Date(candidate.updatedAt))
          : undefined
      );
      if (message) messages.push(message);
    }

    return createConversationDetail(
      agent,
      {
        ...candidate,
        providerSession: {
          kind: "native",
          id: sessionId,
          resumeLocator: sessionId
        }
      },
      messages,
      { title: sessionName, workspacePath, createdAt }
    );
  };

  return { consume, finish };
};

export const parsePiConversation = (
  candidate: AgentConversationCandidate,
  content: string
) => {
  const accumulator = createPiAccumulator(candidate);
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      accumulator.consume(JSON.parse(line));
    } catch {
      // A malformed record does not invalidate the remaining transcript.
    }
  }
  return accumulator.finish();
};

export const createPiConversationCapability = (): AgentConversationCapability => ({
  historyDetail: "full",
  discover: async ({ targetPaths }) => {
    const roots = [...new Set([
      targetPaths.runtimeDir,
      join(targetPaths.configDir, "sessions")
    ].filter((path): path is string => Boolean(path)).map((path) => resolve(path)))];
    const candidates: AgentConversationCandidate[] = [];
    const failures: string[] = [];
    let selectedRoot: string | undefined;

    for (const root of roots) {
      try {
        const info = await stat(root);
        if (!info.isDirectory()) {
          failures.push(`History path is not a directory: ${root}`);
          continue;
        }
        selectedRoot = root;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        failures.push(
          `Could not inspect ${root}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (!selectedRoot) {
      return {
        candidates,
        complete: false,
        ...(failures.length > 0 ? { failures } : {})
      };
    }

    let files: string[];
    try {
      files = await listFilesRecursively(
        selectedRoot,
        (path) => path.toLowerCase().endsWith(".jsonl")
      );
    } catch (error) {
      return {
        candidates,
        complete: false,
        failures: [
          ...failures,
          `Could not scan ${selectedRoot}: ${
            error instanceof Error ? error.message : String(error)
          }`
        ]
      };
    }

    for (const path of files) {
      const sourceId = sourceIdFromFilename(path);
      try {
        candidates.push(await candidateForFile(path, {
          recordId: sourceId,
          providerSession: {
            kind: "native",
            id: sourceId,
            resumeLocator: sourceId
          },
          runtimeHome: selectedRoot,
          detailState: "full"
        }));
      } catch (error) {
        failures.push(
          `Could not read ${path}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return {
      candidates,
      complete: failures.length === 0,
      ...(failures.length > 0 ? { failures } : {})
    };
  },
  read: async (_context, candidate) => {
    const accumulator = createPiAccumulator(candidate);
    await forEachJsonLine(candidate.source.locator, accumulator.consume);
    return accumulator.finish();
  },
  openOriginal: ({ executablePath, targetPaths }, candidate) => executablePath
    ? {
        executablePath,
        args: [
          "--session",
          candidate.providerSession?.resumeLocator ??
            candidate.providerSession?.id ??
            candidate.recordId
        ],
        cwd: candidate.workspacePath,
        env: {
          PI_CODING_AGENT_DIR: targetPaths.configDir,
          PI_CODING_AGENT_SESSION_DIR:
            candidate.source.runtimeHome ?? targetPaths.runtimeDir!
        }
      }
    : undefined,
  openContinuation: ({
    executablePath,
    targetPaths,
    conversation
  }) => executablePath
    ? {
        executablePath,
        args: [
          "--name",
          conversationTitleFrom(conversation.title)
        ],
        cwd: conversation.workspacePath,
        env: {
          PI_CODING_AGENT_DIR: targetPaths.configDir,
          ...(targetPaths.runtimeDir
            ? { PI_CODING_AGENT_SESSION_DIR: targetPaths.runtimeDir }
            : {})
        }
      }
    : undefined,
  move: ({ candidate, destinationPath }) =>
    rewriteConversationJsonLines(candidate.source.locator, (record) =>
      record.type === "session" && setNestedString(record, ["cwd"], destinationPath)
    )
});
