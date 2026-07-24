import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ConversationMessage } from "../../../shared/types";
import type {
  AgentConversationCandidate,
  AgentConversationCapability
} from "../types";
import {
  candidateForFile,
  conversationSnippetFrom,
  createConversationDetail,
  isoDate,
  listFilesRecursively,
  runJsonCommand,
  sourceIdFromFilename,
  trimConversationText,
  visibleMessage
} from "../../conversations/adapterUtils";
import {
  listOpenCodeSqliteSessions,
  readOpenCodeSqliteMessages
} from "./opencodeSqliteWorker";

const agent = { id: "opencode", name: "OpenCode" };
const SQLITE_PREFIX = "opencode-sqlite:";
const CLI_PREFIX = "opencode-cli:";

interface OpenCodeSession {
  id: string;
  title?: string;
  directory?: string;
  created?: number;
  updated?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const timeValue = (value: unknown, key: string): number | undefined => {
  if (!isRecord(value)) return undefined;
  const result = value[key];
  return typeof result === "number" ? result : undefined;
};

const visibleOpenCodeText = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .filter(isRecord)
    .filter((part) => part.type === "text")
    .map((part) => trimConversationText(part.text))
    .filter(Boolean)
    .join("\n\n");
};

export const parseOpenCodeExportMessages = (value: any): ConversationMessage[] => {
  if (!Array.isArray(value?.messages)) return [];
  return value.messages.flatMap((entry: any, index: number) => {
    const role = entry?.info?.role;
    const text = Array.isArray(entry?.parts)
      ? entry.parts
          .filter((part: any) => part?.type === "text")
          .map((part: any) => trimConversationText(part.text))
          .filter(Boolean)
          .join("\n\n")
      : "";
    const created = entry?.info?.time?.created;
    const message = visibleMessage(
      String(entry?.info?.id ?? `${index}`),
      role,
      text,
      created ? isoDate(created, new Date()) : undefined
    );
    return message ? [message] : [];
  });
};

const opencodeDataDirs = (homeDir: string) => {
  const dirs = [
    join(homeDir, ".local", "share", "opencode"),
    ...(process.env.XDG_DATA_HOME && homeDir === process.env.HOME
      ? [join(process.env.XDG_DATA_HOME, "opencode")]
      : [])
  ];
  return [...new Set(dirs)];
};

const listDatabases = async (dataDir: string) => {
  try {
    return (await readdir(dataDir, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          /^opencode(?:-[A-Za-z0-9_.-]+)?\.db$/i.test(entry.name)
      )
      .map((entry) => join(dataDir, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

const discoverSqlite = async (
  homeDir: string
): Promise<AgentConversationCandidate[]> => {
  const candidates: AgentConversationCandidate[] = [];
  const failures: string[] = [];
  for (const dataDir of opencodeDataDirs(homeDir)) {
    for (const dbPath of await listDatabases(dataDir)) {
      try {
        for (const session of await listOpenCodeSqliteSessions(dbPath)) {
          const updatedAt = isoDate(session.updated, new Date());
          candidates.push({
            recordId: session.id,
            source: {
              version: `${session.updated}:${session.messageCount}`,
              locator: `${SQLITE_PREFIX}${dbPath}#${session.id}`,
              runtimeHome: dataDir
            },
            providerSession: {
              kind: "database",
              id: session.id,
              resumeLocator: session.id
            },
            title: trimConversationText(session.title),
            snippet: conversationSnippetFrom(trimConversationText(session.title)),
            workspacePath: trimConversationText(session.directory) || undefined,
            createdAt: isoDate(session.created, new Date(updatedAt)),
            updatedAt,
            messageCount: session.messageCount,
            detailState: "full",
            archived: session.archived || undefined
          });
        }
      } catch (error) {
        failures.push(`${dbPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (candidates.length === 0 && failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return candidates;
};

const legacyStorageRoots = (homeDir: string) =>
  opencodeDataDirs(homeDir).map((dataDir) => join(dataDir, "storage"));

const discoverLegacy = async (
  homeDir: string
): Promise<AgentConversationCandidate[]> => {
  const candidates: AgentConversationCandidate[] = [];
  for (const storageRoot of legacyStorageRoots(homeDir)) {
    const sessionRoot = join(storageRoot, "session");
    for (const path of await listFilesRecursively(
      sessionRoot,
      (candidate) => candidate.endsWith(".json")
    )) {
      let value: unknown;
      try {
        value = JSON.parse(await readFile(path, "utf8"));
      } catch {
        continue;
      }
      if (!isRecord(value)) continue;
      const sourceId = trimConversationText(value.id) || sourceIdFromFilename(path);
      const messageDir = join(storageRoot, "message", sourceId);
      const messageDirInfo = await stat(messageDir).catch(() => undefined);
      const updated = timeValue(value.time, "updated");
      candidates.push(await candidateForFile(path, {
        recordId: sourceId,
        providerSession: {
          kind: "file",
          id: sourceId,
          resumeLocator: sourceId
        },
        runtimeHome: dirname(storageRoot),
        title: trimConversationText(value.title),
        snippet: conversationSnippetFrom(trimConversationText(value.title)),
        workspacePath: trimConversationText(value.directory) || undefined,
        createdAt: isoDate(timeValue(value.time, "created"), new Date()),
        updatedAt: updated
          ? isoDate(updated, new Date())
          : messageDirInfo?.mtime.toISOString(),
        detailState: "full"
      }).then((candidate) => ({
        ...candidate,
        source: {
          ...candidate.source,
          version: `${candidate.source.version}:${Math.trunc(messageDirInfo?.mtimeMs ?? 0)}`
        }
      })));
    }
  }
  return candidates;
};

const discoverCli = async (
  executablePath: string
): Promise<AgentConversationCandidate[]> => {
  const raw = await runJsonCommand(executablePath, ["session", "list", "--format", "json"]);
  if (!Array.isArray(raw)) throw new Error("OpenCode returned an invalid session list");
  return raw.flatMap((item: OpenCodeSession) => {
    if (!item || typeof item.id !== "string") return [];
    const updatedAt = isoDate(item.updated, new Date());
    return [{
      recordId: item.id,
      source: {
        version: String(item.updated ?? item.created ?? ""),
        locator: `${CLI_PREFIX}${item.id}`
      },
      providerSession: {
        kind: "native" as const,
        id: item.id,
        resumeLocator: item.id
      },
      title: trimConversationText(item.title),
      snippet: conversationSnippetFrom(trimConversationText(item.title)),
      workspacePath: trimConversationText(item.directory) || undefined,
      createdAt: isoDate(item.created, new Date(updatedAt)),
      updatedAt,
      detailState: "full" as const
    }];
  });
};

const sqliteLocation = (locator: string) => {
  const encoded = locator.slice(SQLITE_PREFIX.length);
  const separator = encoded.lastIndexOf("#");
  if (separator <= 0 || separator === encoded.length - 1) {
    throw new Error("OpenCode database conversation locator is invalid");
  }
  return {
    dbPath: encoded.slice(0, separator),
    sessionId: encoded.slice(separator + 1)
  };
};

const readLegacyMessages = async (
  candidate: AgentConversationCandidate
): Promise<ConversationMessage[]> => {
  const sourceId = candidate.providerSession?.id ?? candidate.recordId;
  const storageRoot = dirname(dirname(dirname(candidate.source.locator)));
  const messageDir = join(storageRoot, "message", sourceId);
  let entries;
  try {
    entries = await readdir(messageDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const messages: ConversationMessage[] = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(join(messageDir, entry.name), "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(value)) continue;
    const role = value.role;
    const text =
      visibleOpenCodeText(value.content) ||
      trimConversationText(isRecord(value.summary) ? value.summary.body : undefined) ||
      trimConversationText(isRecord(value.summary) ? value.summary.title : undefined);
    const message = visibleMessage(
      trimConversationText(value.id) || basename(entry.name, ".json"),
      role,
      text,
      timeValue(value.time, "created")
        ? isoDate(timeValue(value.time, "created"), new Date(candidate.updatedAt))
        : undefined
    );
    if (message) messages.push(message);
  }
  return messages.sort((left, right) =>
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
    left.id.localeCompare(right.id)
  );
};

export const createOpenCodeConversationCapability = (): AgentConversationCapability => ({
  historyDetail: "full",
  discover: async ({ homeDir, executablePath }) => {
    const localCandidates: AgentConversationCandidate[] = [];
    const localErrors: string[] = [];
    for (const discover of [discoverSqlite, discoverLegacy]) {
      try {
        localCandidates.push(...await discover(homeDir));
      } catch (error) {
        localErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (localCandidates.length === 0 && executablePath) {
      return {
        candidates: await discoverCli(executablePath),
        complete: true
      };
    }
    if (localCandidates.length === 0 && localErrors.length > 0) {
      throw new Error(localErrors.join("; "));
    }
    const localRootObserved = (await Promise.all(
      opencodeDataDirs(homeDir).map(async (path) => {
        try {
          return (await stat(path)).isDirectory();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      })
    )).some(Boolean);
    const bySession = new Map<string, AgentConversationCandidate>();
    for (const candidate of localCandidates) {
      const sessionId = candidate.providerSession?.id ?? candidate.recordId;
      const existing = bySession.get(sessionId);
      const candidateIsSqlite = candidate.source.locator.startsWith(SQLITE_PREFIX);
      const existingIsSqlite = existing?.source.locator.startsWith(SQLITE_PREFIX);
      if (
        !existing ||
        (candidateIsSqlite && !existingIsSqlite) ||
        (candidateIsSqlite === existingIsSqlite &&
          candidate.updatedAt.localeCompare(existing.updatedAt) > 0)
      ) {
        bySession.set(sessionId, candidate);
      }
    }
    return {
      candidates: [...bySession.values()],
      complete: localCandidates.length > 0 || localRootObserved
    };
  },
  read: async ({ executablePath }, candidate) => {
    if (candidate.source.locator.startsWith(SQLITE_PREFIX)) {
      const location = sqliteLocation(candidate.source.locator);
      const messages = (await readOpenCodeSqliteMessages(
        location.dbPath,
        location.sessionId
      )).map((message): ConversationMessage => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.created
          ? isoDate(message.created, new Date(candidate.updatedAt))
          : undefined
      }));
      return createConversationDetail(agent, candidate, messages);
    }
    if (!candidate.source.locator.startsWith(CLI_PREFIX)) {
      return createConversationDetail(agent, candidate, await readLegacyMessages(candidate));
    }
    if (!executablePath) throw new Error("OpenCode command is unavailable");
    const exported = await runJsonCommand(executablePath, [
      "export",
      candidate.providerSession?.id ?? candidate.recordId,
      "--sanitize"
    ]);
    return createConversationDetail(agent, candidate, parseOpenCodeExportMessages(exported));
  },
  openOriginal: ({ executablePath }, candidate) => executablePath
    ? {
        executablePath,
        args: [
          ...(candidate.workspacePath ? [candidate.workspacePath] : []),
          "--session",
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
          "run",
          "--interactive",
          ...(conversation.workspacePath ? ["--dir", conversation.workspacePath] : []),
          "--file",
          contextFilePath,
          "--title",
          "Continued conversation",
          "Continue the work using the attached conversation context."
        ],
        cwd: conversation.workspacePath
      }
    : undefined
});
