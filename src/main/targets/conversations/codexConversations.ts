import { stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConversationDetail,
  ConversationMessage
} from "../../../shared/types";
import type { AgentConversationCapability } from "../types";
import {
  candidateForFile,
  canResumeJsonLines,
  createConversationDetail,
  forEachJsonLine,
  isoDate,
  listFilesRecursively,
  sourceIdFromFilename,
  sourceByteSize,
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
  const accumulator = createCodexAccumulator(candidate);
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      accumulator.consume(JSON.parse(line), index);
    } catch {
      // A malformed record does not invalidate the remaining transcript.
    }
  }
  return accumulator.finish();
};

const createCodexAccumulator = (
  candidate: Parameters<AgentConversationCapability["read"]>[1],
  seed?: ConversationDetail
) => {
  const messages: ConversationMessage[] = seed ? [...seed.messages] : [];
  let sessionId =
    seed?.sourceId ??
    candidate.providerSession?.id ??
    candidate.recordId;
  let workspacePath = seed?.workspacePath ?? candidate.workspacePath;
  let createdAt = seed?.createdAt ?? candidate.createdAt;

  const consume = (record: any, index: number) => {
    if (record?.type === "session_meta" && record.payload && typeof record.payload === "object") {
      sessionId =
        trimConversationText(record.payload.id) ||
        trimConversationText(record.payload.session_id) ||
        sessionId;
      workspacePath = trimConversationText(record.payload.cwd) || workspacePath;
      createdAt = isoDate(record.payload.timestamp, new Date(candidate.updatedAt));
      return;
    }
    if (record?.type !== "response_item" || record.payload?.type !== "message") return;
    const message = visibleMessage(
      String(record.payload.id ?? `${sessionId}:${index}`),
      record.payload.role,
      contentText(record.payload.content)
    );
    if (message) messages.push(message);
  };

  return {
    consume,
    finish: () => createConversationDetail(
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
      { workspacePath, createdAt }
    )
  };
};

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
  read: async (_context, candidate, previous) => {
    const previousSize = previous
      ? sourceByteSize(previous.sourceVersion)
      : undefined;
    const currentSize = sourceByteSize(candidate.source.version);
    const canResume = Boolean(
      previous &&
      previousSize !== undefined &&
      currentSize !== undefined &&
      currentSize > previousSize &&
      await canResumeJsonLines(
        candidate.source.locator,
        previous!.sourceVersion,
        candidate.source.version
      )
    );
    const accumulator = createCodexAccumulator(
      candidate,
      canResume ? previous?.detail : undefined
    );
    await forEachJsonLine(candidate.source.locator, accumulator.consume, {
      start: canResume ? previousSize : 0
    });
    return accumulator.finish();
  },
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
    : undefined
});
