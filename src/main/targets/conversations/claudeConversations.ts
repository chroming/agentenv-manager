import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  ConversationDetail,
  ConversationMessage
} from "../../../shared/types";
import type { AgentConversationCapability } from "../types";
import {
  candidateForFile,
  canResumeJsonLines,
  conversationTitleFrom,
  createConversationDetail,
  forEachJsonLine,
  isoDate,
  listFilesRecursively,
  sourceIdFromFilename,
  sourceByteSize,
  trimConversationText,
  visibleMessage
} from "../../conversations/adapterUtils";
import {
  moveAndRewriteConversationJsonLines,
  setNestedString
} from "../../conversations/conversationMoveStorage";
import { pathEntryExists } from "../../fileUtils";

const agent = { id: "claude-code", name: "Claude Code" };

const claudeProjectDirectoryName = (workspacePath: string) =>
  workspacePath.replace(/[^A-Za-z0-9]/g, "-");

type ClaudeTitleCandidate = {
  rank: 1 | 2 | 3;
  value: string;
};

const claudeTitleCandidate = (record: any): ClaudeTitleCandidate | undefined => {
  if (record.type === "custom-title") {
    const value = trimConversationText(record.customTitle);
    return value ? { rank: 3, value } : undefined;
  }
  if (record.type === "agent-name") {
    const value = trimConversationText(record.agentName);
    return value ? { rank: 3, value } : undefined;
  }
  if (record.type === "ai-title") {
    const value = trimConversationText(record.aiTitle);
    return value ? { rank: 2, value } : undefined;
  }
  if (record.type === "summary") {
    const value = trimConversationText(record.summary);
    return value ? { rank: 1, value } : undefined;
  }
  return undefined;
};

const resolveClaudeTitle = async (path: string, fallback: string) => {
  let selected: { rank: number; value: string } = { rank: 0, value: fallback };
  await forEachJsonLine(path, (record) => {
    const candidate = claudeTitleCandidate(record);
    if (candidate && candidate.rank >= selected.rank) selected = candidate;
  });
  return selected.value;
};

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
  let title = seed?.title ?? candidate.title ?? "";
  let titleRank = 0;

  const consume = (record: any, index: number) => {
    sessionId = trimConversationText(record.sessionId) || sessionId;
    workspacePath = trimConversationText(record.cwd) || workspacePath;
    if (record.timestamp && !createdAt) {
      createdAt = isoDate(record.timestamp, new Date(candidate.updatedAt));
    }
    const nextTitle = claudeTitleCandidate(record);
    if (nextTitle) {
      if (nextTitle.rank >= titleRank) {
        title = nextTitle.value;
        titleRank = nextTitle.rank;
      }
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
    titleRank: () => titleRank,
    finish: (resolvedTitle = title) => createConversationDetail(
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
      { title: resolvedTitle, workspacePath, createdAt }
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
    const resolvedTitle = canResume && accumulator.titleRank() > 0 && accumulator.titleRank() < 3
      ? await resolveClaudeTitle(candidate.source.locator, previous?.detail.title ?? candidate.title ?? "")
      : undefined;
    return accumulator.finish(resolvedTitle);
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
  openContinuation: ({ executablePath, conversation, contextFilePath }) => executablePath
    ? {
        executablePath,
        args: [
          "--add-dir",
          dirname(contextFilePath),
          "--name",
          conversationTitleFrom(conversation.title)
        ],
        cwd: conversation.workspacePath
      }
    : undefined,
  checkMove: async ({ candidate, destinationPath, targetPaths }) => {
    const destination = join(
      targetPaths.configDir,
      "projects",
      claudeProjectDirectoryName(destinationPath),
      basename(candidate.source.locator)
    );
    if (destination !== candidate.source.locator && await pathEntryExists(destination)) {
      throw new Error("Claude Code already has a conversation with this ID in that working directory");
    }
    return {};
  },
  move: ({ candidate, destinationPath, targetPaths }) => {
    const destination = join(
      targetPaths.configDir,
      "projects",
      claudeProjectDirectoryName(destinationPath),
      basename(candidate.source.locator)
    );
    return moveAndRewriteConversationJsonLines(
      candidate.source.locator,
      destination,
      (record) => setNestedString(record, ["cwd"], destinationPath)
    );
  }
});
