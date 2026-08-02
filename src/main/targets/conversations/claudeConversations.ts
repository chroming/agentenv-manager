import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  const accumulator = createClaudeAccumulator(candidate);
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

const createClaudeAccumulator = (
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
  let summary = seed?.title ?? candidate.title;

  const consume = (record: any, index: number) => {
    sessionId = trimConversationText(record.sessionId) || sessionId;
    workspacePath = trimConversationText(record.cwd) || workspacePath;
    if (record.timestamp && !createdAt) {
      createdAt = isoDate(record.timestamp, new Date(candidate.updatedAt));
    }
    if (record.type === "summary") {
      summary = trimConversationText(record.summary) || summary;
      return;
    }
    const message = visibleMessage(
      String(record.uuid ?? `${sessionId}:${index}`),
      record.type,
      claudeText(record.message),
      record.timestamp ? isoDate(record.timestamp, new Date(candidate.updatedAt)) : undefined
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
      { title: summary, workspacePath, createdAt }
    )
  };
};

export const createClaudeConversationCapability = (): AgentConversationCapability => ({
  historyDetail: "full",
  discover: async ({ targetPaths }) => {
    const projectsRoot = join(targetPaths.configDir, "projects");
    try {
      await stat(projectsRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { candidates: [], complete: false };
      }
      throw error;
    }
    const paths = await listFilesRecursively(
      projectsRoot,
      (file) => file.endsWith(".jsonl"),
      {
        shouldEnterDirectory: (_path, name) => name !== "subagents"
      }
    );
    const candidates = [];
    for (const path of paths) {
      const sourceId = sourceIdFromFilename(path);
      candidates.push(await candidateForFile(path, {
        recordId: sourceId,
        providerSession: {
          kind: "native",
          id: sourceId,
          resumeLocator: sourceId
        },
        runtimeHome: targetPaths.configDir,
        detailState: "full"
      }));
    }
    return { candidates, complete: true };
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
    const accumulator = createClaudeAccumulator(
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
          "--resume",
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
          `Read the continuation context at ${contextFilePath}, then continue the user's work.`
        ],
        cwd: conversation.workspacePath
      }
    : undefined
});
