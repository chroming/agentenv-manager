import { Worker } from "node:worker_threads";
import type {
  ConversationDetail,
  ConversationListInput,
  ConversationListResult,
  ConversationReadInput
} from "../../shared/types";

interface ConversationIndexListInput extends ConversationListInput {
  facetAgentIds?: string[];
}

type WorkerRequest =
  | {
      type: "list";
      input: ConversationIndexListInput;
    }
  | {
      type: "read";
      conversationId: string;
      input: ConversationReadInput;
    };

const workerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");

const visibleColumns = [
  "id",
  "agent_id",
  "agent_name",
  "record_id",
  "source_id",
  "source_version",
  "source_locator",
  "source_runtime_home",
  "provider_session_kind",
  "provider_resume_locator",
  "title",
  "snippet",
  "workspace_path",
  "created_at",
  "updated_at",
  "message_count",
  "detail_state",
  "archived"
].join(", ");

const summaryFromRow = (row) => ({
  id: row.id,
  agentId: row.agent_id,
  agentName: row.agent_name,
  sourceId: row.source_id,
  title: row.title,
  snippet: row.snippet,
  workspacePath: row.workspace_path || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  messageCount: Number(row.message_count),
  detailState: row.detail_state,
  archived: Number(row.archived) === 1 || undefined
});

const placeholders = (values) => values.map(() => "?").join(", ");
const escapeLike = (value) => value
  .replace(/\\/g, "\\\\")
  .replace(/%/g, "\\%")
  .replace(/_/g, "\\_");

const openDatabase = (path) => {
  const database = new DatabaseSync(path, { readOnly: true });
  database.exec("PRAGMA query_only = ON");
  return database;
};

const database = openDatabase(workerData.dbPath);

const list = (input) => {
    const conditions = [];
    const parameters = [];
    const query = String(input.query || "").trim().slice(0, 500);
    if (query) {
      conditions.push("search_text LIKE ? ESCAPE '\\'");
      parameters.push("%" + escapeLike(query) + "%");
    }
    const agentIds = [...new Set(input.agentIds || [])].filter(Boolean);
    if (agentIds.length > 0) {
      conditions.push("agent_id IN (" + placeholders(agentIds) + ")");
      parameters.push(...agentIds);
    }
    const workspacePaths = [...new Set(input.workspacePaths || [])].filter(Boolean);
    if (workspacePaths.length > 0) {
      conditions.push("workspace_path IN (" + placeholders(workspacePaths) + ")");
      parameters.push(...workspacePaths);
    }
    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
    const total = Number(
      database.prepare("SELECT count(*) AS count FROM conversations " + where)
        .get(...parameters).count
    );
    const limit = Math.max(1, Math.min(500, Math.trunc(input.limit || 200)));
    const offset = Math.max(0, Math.trunc(input.offset || 0));
    const rows = database.prepare(
      "SELECT " + visibleColumns + ", NULL AS match_snippet " +
      "FROM conversations " + where +
      " ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?"
    ).all(...parameters, limit, offset);

    const workspaceConditions = ["workspace_path IS NOT NULL", "workspace_path <> ''"];
    const workspaceParameters = [];
    if (agentIds.length > 0) {
      workspaceConditions.push("agent_id IN (" + placeholders(agentIds) + ")");
      workspaceParameters.push(...agentIds);
    }
    const availableWorkspacePaths = database.prepare(
      "SELECT DISTINCT workspace_path FROM conversations WHERE " +
      workspaceConditions.join(" AND ") +
      " ORDER BY workspace_path COLLATE NOCASE ASC"
    ).all(...workspaceParameters).map((row) => row.workspace_path);

    const facetAgentIds = [...new Set(input.facetAgentIds || agentIds)].filter(Boolean);
    const agentCountWhere = facetAgentIds.length > 0
      ? "WHERE agent_id IN (" + placeholders(facetAgentIds) + ")"
      : "";
    const agentCounts = Object.fromEntries(
      database.prepare(
        "SELECT agent_id, count(*) AS count FROM conversations " +
        agentCountWhere + " GROUP BY agent_id"
      ).all(...facetAgentIds).map((row) => [row.agent_id, Number(row.count)])
    );

  return {
      items: rows.map(summaryFromRow),
      total,
      workspacePaths: availableWorkspacePaths,
      agentCounts
    };
};

const read = (id, input) => {
    const row = database.prepare(
      "SELECT " + visibleColumns + " FROM conversations WHERE id = ?"
    ).get(id);
    if (!row) throw new Error("Conversation is no longer available in the local index");
    const messageCount = Number(row.message_count);
    const requestedLimit = input.limit === undefined
      ? -1
      : Math.max(1, Math.min(500, Math.trunc(input.limit)));
    const requestedOffset = input.tail && requestedLimit > 0
      ? Math.max(0, messageCount - requestedLimit)
      : Math.max(0, Math.trunc(input.offset || 0));
    const messages = database.prepare(
      "SELECT id, role, text, created_at FROM conversation_messages " +
      "WHERE conversation_id = ? ORDER BY ordinal ASC LIMIT ? OFFSET ?"
    ).all(id, requestedLimit, requestedOffset);
  return {
      ...summaryFromRow(row),
      loadedMessageOffset: requestedOffset,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.created_at || undefined
      }))
    };
};

parentPort.on("message", (request) => {
  try {
    const value = request.type === "list"
      ? list(request.input)
      : read(request.conversationId, request.input);
    parentPort.postMessage({ requestId: request.requestId, ok: true, value });
  } catch (error) {
    parentPort.postMessage({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
`;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface ConversationIndexReader {
  list(input: ConversationIndexListInput): Promise<ConversationListResult>;
  read(id: string, input: ConversationReadInput): Promise<ConversationDetail>;
  close(): void;
}

export const createConversationIndexReader = (
  dbPath: string
): ConversationIndexReader => {
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: { dbPath }
  });
  worker.unref();
  const pending = new Map<number, PendingRequest>();
  let nextRequestId = 1;
  let closed = false;
  let terminalError: Error | undefined;

  const failPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };

  worker.on("message", (result: {
    requestId: number;
    ok: boolean;
    value?: unknown;
    error?: string;
  }) => {
    const request = pending.get(result.requestId);
    if (!request) return;
    pending.delete(result.requestId);
    clearTimeout(request.timeout);
    if (result.ok) request.resolve(result.value);
    else request.reject(new Error(result.error || "Conversation index read failed"));
  });
  worker.on("error", (error) => {
    terminalError = error instanceof Error ? error : new Error(String(error));
    failPending(terminalError);
  });
  worker.on("exit", (code) => {
    if (!closed) {
      terminalError = new Error(`Conversation index worker exited with code ${code}`);
      failPending(terminalError);
    }
  });

  const request = <T>(input: WorkerRequest): Promise<T> => {
    if (closed) return Promise.reject(new Error("Conversation index is closed"));
    if (terminalError) return Promise.reject(terminalError);
    const requestId = nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        terminalError = new Error("Conversation index read timed out");
        void worker.terminate();
        failPending(terminalError);
      }, 15_000);
      pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout
      });
      worker.postMessage({ ...input, requestId });
    });
  };

  return {
    list: (input) => request<ConversationListResult>({ type: "list", input }),
    read: (id, input) => request<ConversationDetail>({
      type: "read",
      conversationId: id,
      input
    }),
    close: () => {
      if (closed) return;
      closed = true;
      failPending(new Error("Conversation index is closed"));
      void worker.terminate();
    }
  };
};
