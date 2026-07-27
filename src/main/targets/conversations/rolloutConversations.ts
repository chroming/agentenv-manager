import type {
  ConversationDetail,
  ConversationMessage
} from "../../../shared/types";
import type {
  AgentConversationCandidate,
  AgentConversationCapability
} from "../types";
import {
  canResumeJsonLines,
  createConversationDetail,
  forEachJsonLine,
  isoDate,
  sourceByteSize,
  trimConversationText,
  visibleMessage
} from "../../conversations/adapterUtils";

export interface RolloutConversationAgent {
  id: string;
  name: string;
}

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

const createRolloutAccumulator = (
  agent: RolloutConversationAgent,
  candidate: AgentConversationCandidate,
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
      createdAt = isoDate(
        record.timestamp ?? record.payload.timestamp,
        new Date(candidate.updatedAt)
      );
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

export const parseRolloutConversation = (
  agent: RolloutConversationAgent,
  candidate: AgentConversationCandidate,
  content: string
) => {
  const accumulator = createRolloutAccumulator(agent, candidate);
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

export const readRolloutConversation = async (
  agent: RolloutConversationAgent,
  candidate: AgentConversationCandidate,
  previous?: {
    detail: ConversationDetail;
    sourceVersion: string;
  }
) => {
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
      previous.sourceVersion,
      candidate.source.version
    )
  );
  const accumulator = createRolloutAccumulator(
    agent,
    candidate,
    canResume ? previous?.detail : undefined
  );
  await forEachJsonLine(candidate.source.locator, accumulator.consume, {
    start: canResume ? previousSize : 0
  });
  return accumulator.finish();
};

export type RolloutConversationRead = AgentConversationCapability["read"];
