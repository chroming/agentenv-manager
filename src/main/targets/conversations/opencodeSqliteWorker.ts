import { Worker } from "node:worker_threads";

export interface OpenCodeSqliteSession {
  id: string;
  title: string;
  directory?: string;
  created: number;
  updated: number;
  archived: boolean;
  messageCount: number;
}

export interface OpenCodeSqliteMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  created?: number;
}

type WorkerRequest =
  | { type: "list"; dbPath: string }
  | { type: "read"; dbPath: string; sessionId: string }
  | {
      type: "move";
      dbPath: string;
      sessionId: string;
      expectedDirectory: string;
      destinationDirectory: string;
      projectId?: string | null;
      resolveProject: boolean;
    };

const workerSource = String.raw`
const { parentPort } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");

const hasTable = (db, name) => Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
);
const columns = (db, table) => new Set(
  db.prepare("PRAGMA table_info(" + table + ")").all().map((column) => column.name)
);
const requiredColumns = (actual, required) =>
  required.every((column) => actual.has(column));
const parseRecord = (value) => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const openDatabase = (path) => {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  db.exec("PRAGMA query_only = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (!hasTable(db, "session")) {
    db.close();
    throw new Error("OpenCode database has no session table");
  }
  const sessionColumns = columns(db, "session");
  if (!requiredColumns(sessionColumns, ["id", "title", "directory", "time_created", "time_updated"])) {
    db.close();
    throw new Error("OpenCode session schema is unsupported");
  }
  return { db, sessionColumns };
};

const list = (path) => {
  const { db, sessionColumns } = openDatabase(path);
  try {
    const hasMessages = hasTable(db, "message") &&
      requiredColumns(columns(db, "message"), ["id", "session_id"]);
    const parentFilter = sessionColumns.has("parent_id") ? "WHERE s.parent_id IS NULL" : "";
    const archived = sessionColumns.has("time_archived")
      ? "CASE WHEN s.time_archived IS NULL THEN 0 ELSE 1 END"
      : "0";
    const messageCount = hasMessages
      ? "(SELECT count(*) FROM message m WHERE m.session_id = s.id)"
      : "0";
    return db.prepare(
      "SELECT s.id, s.title, s.directory, s.time_created, s.time_updated, " +
      archived + " AS archived, " + messageCount + " AS message_count " +
      "FROM session s " + parentFilter + " ORDER BY s.time_updated DESC"
    ).all().map((row) => ({
      id: String(row.id),
      title: String(row.title || ""),
      directory: row.directory ? String(row.directory) : undefined,
      created: Number(row.time_created || 0),
      updated: Number(row.time_updated || 0),
      archived: Number(row.archived) === 1,
      messageCount: Number(row.message_count || 0)
    }));
  } finally {
    db.close();
  }
};

const read = (path, sessionId) => {
  const { db } = openDatabase(path);
  try {
    if (!hasTable(db, "message") || !hasTable(db, "part")) {
      throw new Error("OpenCode database has no readable message tables");
    }
    const messageColumns = columns(db, "message");
    const partColumns = columns(db, "part");
    if (!requiredColumns(messageColumns, ["id", "session_id", "data"]) ||
        !requiredColumns(partColumns, ["id", "message_id", "session_id", "time_created", "data"])) {
      throw new Error("OpenCode message schema is unsupported");
    }
    const messageTime = messageColumns.has("time_created") ? "time_created" : "0 AS time_created";
    const messages = db.prepare(
      "SELECT id, " + messageTime + ", data FROM message " +
      "WHERE session_id = ? ORDER BY time_created ASC, id ASC"
    ).all(sessionId);
    const parts = db.prepare(
      "SELECT message_id, data FROM part WHERE session_id = ? " +
      "ORDER BY time_created ASC, id ASC"
    ).all(sessionId);
    const textByMessage = new Map();
    for (const part of parts) {
      const data = parseRecord(part.data);
      if (data.type !== "text" || typeof data.text !== "string" || !data.text.trim()) continue;
      const id = String(part.message_id);
      const values = textByMessage.get(id) || [];
      values.push(data.text.trim());
      textByMessage.set(id, values);
    }
    return messages.flatMap((message) => {
      const data = parseRecord(message.data);
      if (data.role !== "user" && data.role !== "assistant") return [];
      const text = (textByMessage.get(String(message.id)) || []).join("\n\n").trim();
      if (!text) return [];
      const created = Number(data.time?.created || message.time_created || 0);
      return [{
        id: String(message.id),
        role: data.role,
        text,
        created: created || undefined
      }];
    });
  } finally {
    db.close();
  }
};

const move = (path, request) => {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    if (!hasTable(db, "session")) throw new Error("OpenCode database has no session table");
    const sessionColumns = columns(db, "session");
    if (!requiredColumns(sessionColumns, ["id", "directory"])) {
      throw new Error("OpenCode session schema is unsupported");
    }
    const hasProjectId = sessionColumns.has("project_id");
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare(
        "SELECT directory" + (hasProjectId ? ", project_id" : "") +
        " FROM session WHERE id = ?"
      ).get(request.sessionId);
      if (!row) throw new Error("OpenCode conversation no longer exists");
      if (String(row.directory || "") !== request.expectedDirectory) {
        throw new Error("OpenCode conversation changed after preview");
      }
      let projectId = hasProjectId ? (row.project_id == null ? null : String(row.project_id)) : null;
      if (hasProjectId && request.resolveProject) {
        if (!hasTable(db, "project")) {
          throw new Error("OpenCode project registry is unavailable");
        }
        const projectColumns = columns(db, "project");
        if (!requiredColumns(projectColumns, ["id", "worktree"])) {
          throw new Error("OpenCode project registry schema is unsupported");
        }
        const project = db.prepare(
          "SELECT id FROM project WHERE worktree = ? ORDER BY id LIMIT 1"
        ).get(request.destinationDirectory);
        if (!project) throw new Error("OpenCode has not registered the destination project");
        projectId = String(project.id);
      } else if (hasProjectId && Object.prototype.hasOwnProperty.call(request, "projectId")) {
        projectId = request.projectId == null ? null : String(request.projectId);
      }
      if (hasProjectId) {
        db.prepare(
          "UPDATE session SET directory = ?, project_id = ? WHERE id = ?"
        ).run(request.destinationDirectory, projectId, request.sessionId);
      } else {
        db.prepare("UPDATE session SET directory = ? WHERE id = ?")
          .run(request.destinationDirectory, request.sessionId);
      }
      db.exec("COMMIT");
      return {
        previousDirectory: String(row.directory || ""),
        previousProjectId: hasProjectId && row.project_id != null
          ? String(row.project_id)
          : null,
        projectId
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
};

parentPort.on("message", (request) => {
  try {
    const value = request.type === "list"
      ? list(request.dbPath)
      : request.type === "read"
        ? read(request.dbPath, request.sessionId)
        : move(request.dbPath, request);
    parentPort.postMessage({ ok: true, value });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
`;

const runWorker = <T>(request: WorkerRequest): Promise<T> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true });
    let settled = false;
    const settle = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      operation();
    };
    const timeout = setTimeout(() => {
      void worker.terminate();
      settle(() => reject(new Error("OpenCode history read timed out")));
    }, 20_000);
    worker.once("message", (result: { ok: boolean; value?: T; error?: string }) => {
      void worker.terminate();
      settle(() => {
        if (result.ok) resolve(result.value as T);
        else reject(new Error(result.error || "OpenCode history read failed"));
      });
    });
    worker.once("error", (error) => {
      settle(() => reject(error));
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        settle(() => reject(new Error(`OpenCode history worker exited with code ${code}`)));
      }
    });
    worker.postMessage(request);
  });

const databaseQueues = new Map<string, Promise<unknown>>();
const databaseBusyUntil = new Map<string, number>();

const runWorkerWithBusyCooldown = async <T>(request: WorkerRequest): Promise<T> => {
  if ((databaseBusyUntil.get(request.dbPath) ?? 0) > Date.now()) {
    throw new Error("OpenCode history database is locked");
  }
  try {
    const value = await runWorker<T>(request);
    databaseBusyUntil.delete(request.dbPath);
    return value;
  } catch (error) {
    if (/database is (?:locked|busy)|SQLITE_BUSY/i.test(
      error instanceof Error ? error.message : String(error)
    )) {
      databaseBusyUntil.set(request.dbPath, Date.now() + 5_000);
    }
    throw error;
  }
};

const runDatabaseWorker = <T>(request: WorkerRequest): Promise<T> => {
  const previous = databaseQueues.get(request.dbPath) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(() => runWorkerWithBusyCooldown<T>(request));
  databaseQueues.set(request.dbPath, operation);
  return operation.finally(() => {
    if (databaseQueues.get(request.dbPath) === operation) {
      databaseQueues.delete(request.dbPath);
    }
  });
};

export const listOpenCodeSqliteSessions = (dbPath: string) =>
  runDatabaseWorker<OpenCodeSqliteSession[]>({ type: "list", dbPath });

export const readOpenCodeSqliteMessages = (dbPath: string, sessionId: string) =>
  runDatabaseWorker<OpenCodeSqliteMessage[]>({ type: "read", dbPath, sessionId });

export interface OpenCodeSqliteMoveResult {
  previousDirectory: string;
  previousProjectId: string | null;
  projectId: string | null;
}

export const moveOpenCodeSqliteSession = (input: {
  dbPath: string;
  sessionId: string;
  expectedDirectory: string;
  destinationDirectory: string;
  projectId?: string | null;
  resolveProject?: boolean;
}) => runDatabaseWorker<OpenCodeSqliteMoveResult>({
  type: "move",
  dbPath: input.dbPath,
  sessionId: input.sessionId,
  expectedDirectory: input.expectedDirectory,
  destinationDirectory: input.destinationDirectory,
  ...(Object.prototype.hasOwnProperty.call(input, "projectId")
    ? { projectId: input.projectId }
    : {}),
  resolveProject: input.resolveProject ?? false
});
