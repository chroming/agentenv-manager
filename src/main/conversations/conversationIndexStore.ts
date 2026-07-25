import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ConversationDetail,
  ConversationListInput,
  ConversationListResult,
  ConversationMessage,
  ConversationSummary
} from "../../shared/types";
import type { AgentConversationCandidate } from "../targets/types";

interface ConversationRow {
  id: string;
  agent_id: string;
  agent_name: string;
  record_id: string;
  source_id: string;
  source_version: string;
  source_locator: string;
  source_runtime_home: string | null;
  provider_session_kind: "native" | "file" | "database" | null;
  provider_resume_locator: string | null;
  title: string;
  snippet: string;
  workspace_path: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  detail_state: "full" | "summary-only";
  archived: number;
  match_snippet?: string | null;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: string | null;
}

export interface IndexedConversationRecord {
  summary: ConversationSummary;
  candidate: AgentConversationCandidate;
}

export interface ConversationIndexStore {
  sourceVersion(id: string): string | undefined;
  upsert(detail: ConversationDetail, candidate: AgentConversationCandidate): void;
  removeMissing(agentId: string, observedIds: Set<string>): number;
  list(input?: ConversationListInput): ConversationListResult;
  read(id: string): ConversationDetail;
  record(id: string): IndexedConversationRecord;
  close(): void;
}

const summaryFromRow = (row: ConversationRow): ConversationSummary => ({
  id: row.id,
  agentId: row.agent_id,
  agentName: row.agent_name,
  sourceId: row.source_id,
  title: row.title,
  snippet: row.snippet,
  matchSnippet: row.match_snippet ?? undefined,
  workspacePath: row.workspace_path ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  messageCount: row.message_count,
  detailState: row.detail_state,
  archived: row.archived === 1 || undefined
});

const createDatabase = (path: string) => {
  const database = new DatabaseSync(path);
  try {
    const version = Number(
      (database.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version
    );
    if (version > 2) throw new Error("Conversation cache uses a newer schema");
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version TEXT NOT NULL,
        source_locator TEXT NOT NULL,
        source_runtime_home TEXT,
        provider_session_kind TEXT,
        provider_resume_locator TEXT,
        title TEXT NOT NULL,
        snippet TEXT NOT NULL,
        workspace_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        detail_state TEXT NOT NULL CHECK (detail_state IN ('full', 'summary-only')),
        archived INTEGER NOT NULL DEFAULT 0,
        search_text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversations_updated_idx
        ON conversations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS conversations_agent_idx
        ON conversations(agent_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS conversation_messages (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL,
        created_at TEXT,
        PRIMARY KEY (conversation_id, ordinal)
      );
    `);
    if (version < 2) {
      const columns = new Set(
        (database.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>)
          .map((column) => column.name)
      );
      const addColumn = (name: string, definition: string) => {
        if (!columns.has(name)) database.exec(`ALTER TABLE conversations ADD COLUMN ${definition}`);
      };
      addColumn("record_id", "record_id TEXT");
      addColumn("source_runtime_home", "source_runtime_home TEXT");
      addColumn("provider_session_kind", "provider_session_kind TEXT");
      addColumn("provider_resume_locator", "provider_resume_locator TEXT");
      database.exec(`
        UPDATE conversations
        SET record_id = CASE
          WHEN instr(id, ':') > 0 THEN substr(id, instr(id, ':') + 1)
          ELSE source_id
        END
        WHERE record_id IS NULL OR record_id = '';
        UPDATE conversations
        SET provider_session_kind = 'native'
        WHERE provider_session_kind IS NULL;
        UPDATE conversations
        SET provider_resume_locator = source_id
        WHERE provider_resume_locator IS NULL;
      `);
    }
    database.exec("PRAGMA user_version = 2;");
    database.prepare(`
      SELECT id, agent_id, record_id, source_version, source_locator, search_text
      FROM conversations
      LIMIT 0
    `);
    database.prepare(`
      SELECT conversation_id, ordinal, role, text
      FROM conversation_messages
      LIMIT 0
    `);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
};

const openRecoverableDatabase = async (path: string) => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    return createDatabase(path);
  } catch (error) {
    const suffix = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(path, `${path}.corrupt-${suffix}`).catch(() => undefined);
    await Promise.all([
      rm(`${path}-wal`, { force: true }),
      rm(`${path}-shm`, { force: true })
    ]);
    try {
      return createDatabase(path);
    } catch {
      throw error;
    }
  }
};

export const createConversationIndexStore = async (
  path: string
): Promise<ConversationIndexStore> => {
  const database = await openRecoverableDatabase(path);
  await chmod(path, 0o600).catch(() => undefined);

  const versionStatement = database.prepare(
    "SELECT source_version FROM conversations WHERE id = ?"
  );
  const recordStatement = database.prepare(
    "SELECT * FROM conversations WHERE id = ?"
  );
  const messageStatement = database.prepare(`
    SELECT id, role, text, created_at
    FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY ordinal ASC
  `);
  const upsertStatement = database.prepare(`
    INSERT INTO conversations (
      id, agent_id, agent_name, record_id, source_id, source_version, source_locator,
      source_runtime_home, provider_session_kind, provider_resume_locator,
      title, snippet, workspace_path, created_at, updated_at, message_count,
      detail_state, archived, search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      agent_id = excluded.agent_id,
      agent_name = excluded.agent_name,
      record_id = excluded.record_id,
      source_id = excluded.source_id,
      source_version = excluded.source_version,
      source_locator = excluded.source_locator,
      source_runtime_home = excluded.source_runtime_home,
      provider_session_kind = excluded.provider_session_kind,
      provider_resume_locator = excluded.provider_resume_locator,
      title = excluded.title,
      snippet = excluded.snippet,
      workspace_path = excluded.workspace_path,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      message_count = excluded.message_count,
      detail_state = excluded.detail_state,
      archived = excluded.archived,
      search_text = excluded.search_text
  `);
  const deleteMessagesStatement = database.prepare(
    "DELETE FROM conversation_messages WHERE conversation_id = ?"
  );
  const insertMessageStatement = database.prepare(`
    INSERT INTO conversation_messages (
      conversation_id, ordinal, id, role, text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const rowFor = (id: string) => {
    const row = recordStatement.get(id) as ConversationRow | undefined;
    if (!row) throw new Error("Conversation is no longer available in the local index");
    return row;
  };

  return {
    sourceVersion: (id) => {
      const row = versionStatement.get(id) as { source_version?: string } | undefined;
      return row?.source_version;
    },
    upsert: (detail, candidate) => {
      const searchText = [
        detail.title,
        detail.snippet,
        detail.workspacePath ?? "",
        ...detail.messages.map((message) => message.text)
      ].join("\n");
      database.exec("BEGIN IMMEDIATE");
      try {
        upsertStatement.run(
          detail.id,
          detail.agentId,
          detail.agentName,
          candidate.recordId,
          detail.sourceId,
          candidate.source.version,
          candidate.source.locator,
          candidate.source.runtimeHome ?? null,
          candidate.providerSession?.kind ?? null,
          detail.sourceId,
          detail.title,
          detail.snippet,
          detail.workspacePath ?? null,
          detail.createdAt,
          detail.updatedAt,
          detail.messageCount,
          detail.detailState,
          detail.archived ? 1 : 0,
          searchText
        );
        deleteMessagesStatement.run(detail.id);
        detail.messages.forEach((message, ordinal) => {
          insertMessageStatement.run(
            detail.id,
            ordinal,
            message.id,
            message.role,
            message.text,
            message.createdAt ?? null
          );
        });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    removeMissing: (agentId, observedIds) => {
      const rows = database.prepare(
        "SELECT id FROM conversations WHERE agent_id = ?"
      ).all(agentId) as Array<{ id: string }>;
      const stale = rows.filter((row) => !observedIds.has(row.id));
      const remove = database.prepare("DELETE FROM conversations WHERE id = ?");
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const row of stale) remove.run(row.id);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return stale.length;
    },
    list: (input = {}) => {
      const conditions: string[] = [];
      const parameters: Array<string | number> = [];
      const query = input.query?.trim().slice(0, 500);
      if (query) {
        conditions.push("instr(lower(search_text), lower(?)) > 0");
        parameters.push(query);
      }
      const agentIds = [...new Set(input.agentIds ?? [])].filter(Boolean);
      if (agentIds.length > 0) {
        conditions.push(`agent_id IN (${agentIds.map(() => "?").join(", ")})`);
        parameters.push(...agentIds);
      }
      const workspacePaths = [...new Set(input.workspacePaths ?? [])].filter(Boolean);
      if (workspacePaths.length > 0) {
        conditions.push(`workspace_path IN (${workspacePaths.map(() => "?").join(", ")})`);
        parameters.push(...workspacePaths);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const total = Number(
        (database.prepare(`SELECT count(*) AS count FROM conversations ${where}`)
          .get(...parameters) as { count: number }).count
      );
      const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 200)));
      const offset = Math.max(0, Math.trunc(input.offset ?? 0));
      const matchProjection = query
        ? `(
            SELECT text
            FROM conversation_messages
            WHERE conversation_id = conversations.id
              AND instr(lower(text), lower(?)) > 0
            ORDER BY ordinal DESC
            LIMIT 1
          ) AS match_snippet`
        : "NULL AS match_snippet";
      const rowParameters = query ? [query, ...parameters] : parameters;
      const rows = database.prepare(`
        SELECT conversations.*, ${matchProjection}
        FROM conversations
        ${where}
        ORDER BY updated_at DESC, id ASC
        LIMIT ? OFFSET ?
      `).all(...rowParameters, limit, offset) as unknown as ConversationRow[];
      const workspaceConditions: string[] = ["workspace_path IS NOT NULL", "workspace_path <> ''"];
      const workspaceParameters: string[] = [];
      if (agentIds.length > 0) {
        workspaceConditions.push(`agent_id IN (${agentIds.map(() => "?").join(", ")})`);
        workspaceParameters.push(...agentIds);
      }
      const availableWorkspacePaths = (
        database.prepare(`
          SELECT DISTINCT workspace_path
          FROM conversations
          WHERE ${workspaceConditions.join(" AND ")}
          ORDER BY workspace_path COLLATE NOCASE ASC
        `).all(...workspaceParameters) as Array<{ workspace_path: string }>
      ).map((row) => row.workspace_path);
      return {
        items: rows.map(summaryFromRow),
        total,
        workspacePaths: availableWorkspacePaths
      };
    },
    read: (id) => {
      const row = rowFor(id);
      const messages = messageStatement.all(id) as unknown as MessageRow[];
      return {
        ...summaryFromRow(row),
        messages: messages.map((message): ConversationMessage => ({
          id: message.id,
          role: message.role,
          text: message.text,
          createdAt: message.created_at ?? undefined
        }))
      };
    },
    record: (id) => {
      const row = rowFor(id);
      return {
        summary: summaryFromRow(row),
        candidate: {
          recordId: row.record_id,
          source: {
            version: row.source_version,
            locator: row.source_locator,
            ...(row.source_runtime_home
              ? { runtimeHome: row.source_runtime_home }
              : {})
          },
          providerSession: {
            kind: row.provider_session_kind ?? "native",
            id: row.source_id,
            resumeLocator: row.provider_resume_locator ?? row.source_id
          },
          title: row.title,
          snippet: row.snippet,
          workspacePath: row.workspace_path ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          messageCount: row.message_count,
          detailState: row.detail_state,
          archived: row.archived === 1 || undefined
        }
      };
    },
    close: () => database.close()
  };
};
