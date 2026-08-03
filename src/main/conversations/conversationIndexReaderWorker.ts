import { Worker } from "node:worker_threads";
import type {
  ConversationDetail,
  ConversationListInput,
  ConversationListResult,
  ConversationReadInput,
  ConversationSearchInput,
  ConversationSummary
} from "../../shared/types";

interface ConversationIndexListInput extends ConversationListInput {
  facetAgentIds?: string[];
}

interface ConversationIndexSearchInput extends ConversationSearchInput {
  agentIds?: string[];
}

type WorkerRequest =
  | {
      type: "list";
      input: ConversationIndexListInput;
    }
  | {
      type: "search";
      input: ConversationIndexSearchInput;
    }
  | {
      type: "read";
      conversationId: string;
      input: ConversationReadInput;
    };

const workerSource = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");

const visibleColumnNames = [
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
];
const visibleColumns = visibleColumnNames
  .map((column) => "c." + column + " AS " + column)
  .join(", ");

const sourceByteSize = (encodedVersion) => {
  const parserPrefix = "agentenv-parser:5\n";
  const version = String(encodedVersion || "").startsWith(parserPrefix)
    ? String(encodedVersion).slice(parserPrefix.length)
    : String(encodedVersion || "");
  const [size, mtime, dev, ino, headHash, tailHash] = version.split(":");
  const value = Number(size);
  return Number.isSafeInteger(value) &&
    value >= 0 &&
    /^\d+$/.test(mtime || "") &&
    Boolean(dev) &&
    Boolean(ino) &&
    /^[a-f0-9]{64}$/i.test(headHash || "") &&
    /^[a-f0-9]{64}$/i.test(tailHash || "")
      ? value
      : undefined;
};

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
  sizeBytes: sourceByteSize(row.source_version),
  matchSnippet: row.match_snippet || undefined,
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
const hasSearchIndex = Boolean(database.prepare(
  "SELECT name FROM sqlite_master " +
  "WHERE type = 'table' AND name = 'conversation_search'"
).get());

const cleanSnippet = (value) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 180 ? text.slice(0, 177).trimEnd() + "…" : text;
};

const fallbackSnippet = (value, query) => {
  const text = String(value || "");
  const matchAt = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (matchAt < 0) return undefined;
  const start = Math.max(0, matchAt - 64);
  const end = Math.min(text.length, matchAt + query.length + 96);
  const excerpt = cleanSnippet(text.slice(start, end));
  return (start > 0 ? "… " : "") + excerpt + (end < text.length ? " …" : "");
};

const ftsPhrase = (value) => '"' + value.replace(/"/g, '""') + '"';

const createSearchContext = (input) => {
  const conditions = [];
  const parameters = [];
  const query = String(input.query || "").trim().slice(0, 500);
  const usesFts = Boolean(
    query &&
    hasSearchIndex &&
    Array.from(query).length >= 3
  );
  const from = usesFts
    ? "FROM conversations AS c " +
      "JOIN conversation_search ON conversation_search.conversation_id = c.id"
    : "FROM conversations AS c";
  if (query) {
    if (usesFts) {
      conditions.push("conversation_search MATCH ?");
      parameters.push(ftsPhrase(query));
    } else {
      conditions.push("c.search_text LIKE ? ESCAPE '\\'");
      parameters.push("%" + escapeLike(query) + "%");
    }
  }
  const agentIds = [...new Set(input.agentIds || [])].filter(Boolean);
  if (agentIds.length > 0) {
    conditions.push("c.agent_id IN (" + placeholders(agentIds) + ")");
    parameters.push(...agentIds);
  }
  const workspacePaths = [...new Set(input.workspacePaths || [])].filter(Boolean);
  if (workspacePaths.length > 0) {
    conditions.push("c.workspace_path IN (" + placeholders(workspacePaths) + ")");
    parameters.push(...workspacePaths);
  }
  return {
    query,
    usesFts,
    from,
    where: conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "",
    parameters,
    agentIds
  };
};

const selectRows = (input, maximumLimit) => {
  const context = createSearchContext(input);
  const limit = Math.max(
    1,
    Math.min(maximumLimit, Math.trunc(input.limit || Math.min(200, maximumLimit)))
  );
  const offset = Math.max(0, Math.trunc(input.offset || 0));
  const titleRank = context.query
    ? "CASE " +
      "WHEN c.title = ? COLLATE NOCASE THEN 0 " +
      "WHEN c.title LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 1 " +
      "WHEN c.title LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 2 " +
      "ELSE 3 END"
    : "0";
  const titleRankParameters = context.query
    ? [
        context.query,
        escapeLike(context.query) + "%",
        "%" + escapeLike(context.query) + "%"
      ]
    : [];
  const matchSnippet = !context.query
    ? "NULL"
    : context.usesFts
      ? "snippet(conversation_search, -1, '', '', ' … ', 24)"
      : "NULL";
  const matchSource = context.query && !context.usesFts
    ? ", c.search_text AS match_source"
    : "";
  const relevance = context.usesFts
    ? "bm25(conversation_search, 0.0, 8.0, 4.0, 2.0, 1.0)"
    : "0";
  const rows = database.prepare(
    "SELECT " + visibleColumns + ", " + matchSnippet + " AS match_snippet" +
    matchSource + ", " + titleRank + " AS title_rank, " +
    relevance + " AS relevance " +
    context.from + " " + context.where +
    " ORDER BY title_rank ASC, relevance ASC, c.updated_at DESC, c.id ASC " +
    "LIMIT ? OFFSET ?"
  ).all(
    ...titleRankParameters,
    ...context.parameters,
    limit,
    offset
  );
  return {
    context,
    rows: rows.map((row) => ({
      ...row,
      match_snippet: cleanSnippet(
        row.match_snippet ||
        (context.query ? fallbackSnippet(row.match_source, context.query) : "")
      ) || null
    }))
  };
};

const list = (input) => {
  const { context, rows } = selectRows(input, 500);
  const total = Number(
    database.prepare(
      "SELECT count(*) AS count " + context.from + " " + context.where
    ).get(...context.parameters).count
  );

  const workspaceConditions = ["workspace_path IS NOT NULL", "workspace_path <> ''"];
  const workspaceParameters = [];
  if (context.agentIds.length > 0) {
    workspaceConditions.push("agent_id IN (" + placeholders(context.agentIds) + ")");
    workspaceParameters.push(...context.agentIds);
  }
  const availableWorkspacePaths = database.prepare(
    "SELECT DISTINCT workspace_path FROM conversations WHERE " +
    workspaceConditions.join(" AND ") +
    " ORDER BY workspace_path COLLATE NOCASE ASC"
  ).all(...workspaceParameters).map((row) => row.workspace_path);

  const facetAgentIds = [...new Set(input.facetAgentIds || context.agentIds)].filter(Boolean);
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

const search = (input) => {
  const query = String(input.query || "").trim();
  if (!query) return [];
  return selectRows({ ...input, offset: 0 }, 20).rows.map(summaryFromRow);
};

const read = (id, input) => {
    const row = database.prepare(
      "SELECT " + visibleColumns + " FROM conversations AS c WHERE c.id = ?"
    ).get(id);
    if (!row) throw new Error("Conversation is no longer available in the local index");
    const messageCount = Number(row.message_count);
    const requestedLimit = input.limit === undefined
      ? -1
      : Math.max(1, Math.min(500, Math.trunc(input.limit)));
    const query = String(input.query || "").trim().slice(0, 500);
    const matchedMessage = query
      ? database.prepare(
          "SELECT ordinal, id FROM conversation_messages " +
          "WHERE conversation_id = ? AND instr(lower(text), lower(?)) > 0 " +
          "ORDER BY ordinal ASC LIMIT 1"
        ).get(id, query)
      : undefined;
    const requestedOffset = matchedMessage && requestedLimit > 0
      ? Math.max(
          0,
          Math.min(
            Math.max(0, messageCount - requestedLimit),
            Number(matchedMessage.ordinal) - Math.floor(requestedLimit / 2)
          )
        )
      : input.tail && requestedLimit > 0
        ? Math.max(0, messageCount - requestedLimit)
        : Math.max(0, Math.trunc(input.offset || 0));
    const messages = database.prepare(
      "SELECT id, role, text, created_at FROM conversation_messages " +
      "WHERE conversation_id = ? ORDER BY ordinal ASC LIMIT ? OFFSET ?"
    ).all(id, requestedLimit, requestedOffset);
  return {
      ...summaryFromRow(row),
      loadedMessageOffset: requestedOffset,
      matchedMessageId: matchedMessage?.id,
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
      : request.type === "search"
        ? search(request.input)
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
  search(input: ConversationIndexSearchInput): Promise<ConversationSummary[]>;
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
    search: (input) => request<ConversationSummary[]>({ type: "search", input }),
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
