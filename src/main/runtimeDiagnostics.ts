import { randomBytes } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DiagnosticEvent,
  DiagnosticIssueDetail,
  DiagnosticOutcome
} from "../shared/types";
import {
  redactDiagnosticText,
  sanitizeDiagnosticError,
  sanitizeDiagnosticValue
} from "./diagnosticRedaction";
import { isMissingFileError } from "./fileUtils";

const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024;
const DEFAULT_LOG_GENERATIONS = 4;
const SLOW_READ_THRESHOLD_MS = 250;
const DIAGNOSTIC_REFERENCE_PATTERN = /\n?Diagnostic reference:\s*(AEM-[A-Z0-9-]+)/i;

const mutationChannelPattern =
  /^(skills:(?:set|merge|import|remove|manage|consolidate|retire|rollback|update)|profiles:(?:save|update|fork|create|duplicate|delete)|activation:apply|rollback:apply|targets:(?:stop-managing|adopt-changes)|data:(?:create-backup|restore)|settings:update|workspace-sync:(?:connect|update|publish|recover|disconnect)|github:(?:poll-device-login|sign-out)|backups:(?:delete|cleanup))/;

const contextKeys = new Set([
  "id",
  "profileId",
  "targetId",
  "previewId",
  "sourceId",
  "libraryId",
  "backupId",
  "kind",
  "mode",
  "scope",
  "enabled",
  "sourceType",
  "path",
  "rootPath",
  "sourcePath",
  "url",
  "source",
  "manifest",
  "ids"
]);

const summarizeValue = (value: unknown, depth = 0): unknown => {
  if (depth > 3) return undefined;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      return { count: value.length, values: value.slice(0, 20) };
    }
    return { count: value.length };
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (!value || typeof value !== "object") return undefined;
  const summary = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => contextKeys.has(key))
    .map(([key, item]) => [key, summarizeValue(item, depth + 1)] as const)
    .filter((entry) => entry[1] !== undefined);
  return summary.length > 0 ? Object.fromEntries(summary) : undefined;
};

const summarizeArguments = (args: unknown[]): Record<string, unknown> | undefined => {
  const values = args
    .map((value, index) => [String(index), summarizeValue(value)] as const)
    .filter((entry) => entry[1] !== undefined);
  return values.length > 0 ? Object.fromEntries(values) : undefined;
};

const operationReference = (now: Date) => {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `AEM-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
};

const categoryFor = (action: string) => action.split(":", 1)[0] || "app";

const isDiagnosticEvent = (value: unknown): value is DiagnosticEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<DiagnosticEvent>;
  if (
    event.schemaVersion !== 1 ||
    typeof event.at !== "string" ||
    typeof event.reference !== "string" ||
    typeof event.action !== "string" ||
    typeof event.category !== "string" ||
    typeof event.phase !== "string"
  ) {
    return false;
  }
  if (event.error === undefined) return true;
  return Boolean(
    event.error &&
    typeof event.error === "object" &&
    typeof event.error.name === "string" &&
    typeof event.error.message === "string" &&
    Array.isArray(event.error.causes)
  );
};

const publicOperationError = (error: unknown, reference: string, homeDir: string) => {
  const detail = sanitizeDiagnosticError(error, homeDir);
  const message = detail.message.replace(DIAGNOSTIC_REFERENCE_PATTERN, "").trim();
  return new Error(`${message}\nDiagnostic reference: ${reference}`);
};

export interface RuntimeDiagnosticReportContext {
  settings?: Record<string, unknown>;
  targets?: Array<Record<string, unknown>>;
  workspace?: Record<string, unknown>;
  startup?: Record<string, unknown>;
}

export interface RuntimeDiagnostics {
  readonly directory: string;
  readonly logPath: string;
  runIpcOperation<T>(
    action: string,
    args: unknown[],
    operation: () => Promise<T> | T
  ): Promise<T>;
  record(
    action: string,
    phase: string,
    detail?: {
      reference?: string;
      outcome?: DiagnosticOutcome;
      durationMs?: number;
      context?: Record<string, unknown>;
      error?: unknown;
    }
  ): Promise<void>;
  readIssue(reference: string): Promise<DiagnosticIssueDetail | undefined>;
  readLatestIssue(): Promise<DiagnosticIssueDetail | undefined>;
  exportReport(
    destination: string,
    options?: {
      reference?: string;
      context?: RuntimeDiagnosticReportContext;
    }
  ): Promise<void>;
}

export const diagnosticReferenceFromMessage = (message: string): string | undefined =>
  message.match(DIAGNOSTIC_REFERENCE_PATTERN)?.[1];

export const createRuntimeDiagnostics = (options: {
  directory: string;
  homeDir: string;
  appVersion: string;
  buildCommit?: string;
  packaged: boolean;
  platform: string;
  arch: string;
  osVersion: string;
  locale: string;
  now?: () => Date;
  maxLogBytes?: number;
  logGenerations?: number;
}): RuntimeDiagnostics => {
  const logPath = join(options.directory, "runtime.jsonl");
  const maxLogBytes = options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  const logGenerations = options.logGenerations ?? DEFAULT_LOG_GENERATIONS;
  let writeQueue = Promise.resolve();

  const rotate = async () => {
    try {
      if ((await stat(logPath)).size < maxLogBytes) return;
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
    for (let index = logGenerations - 1; index >= 1; index -= 1) {
      const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
      const destination = `${logPath}.${index}`;
      try {
        await rm(destination, { force: true });
        await rename(source, destination);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }
  };

  const appendEvents = (events: DiagnosticEvent[]) => {
    const task = async () => {
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      await rotate();
      await appendFile(
        logPath,
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
    };
    writeQueue = writeQueue.catch(() => undefined).then(task);
    return writeQueue;
  };

  const eventFor = (
    action: string,
    phase: string,
    detail: {
      reference: string;
      at?: Date;
      outcome?: DiagnosticOutcome;
      durationMs?: number;
      context?: Record<string, unknown>;
      error?: unknown;
    }
  ): DiagnosticEvent => ({
    schemaVersion: 1,
    at: (detail.at ?? options.now?.() ?? new Date()).toISOString(),
    reference: detail.reference,
    action,
    category: categoryFor(action),
    phase,
    outcome: detail.outcome,
    durationMs: detail.durationMs,
    context: detail.context
      ? sanitizeDiagnosticValue(detail.context, options.homeDir) as Record<string, unknown>
      : undefined,
    error: detail.error === undefined
      ? undefined
      : sanitizeDiagnosticError(detail.error, options.homeDir)
  });

  const readEvents = async (): Promise<DiagnosticEvent[]> => {
    await writeQueue.catch(() => undefined);
    const events: DiagnosticEvent[] = [];
    for (let index = logGenerations - 1; index >= 0; index -= 1) {
      const path = index === 0 ? logPath : `${logPath}.${index}`;
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch (error) {
        if (isMissingFileError(error)) continue;
        throw error;
      }
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (isDiagnosticEvent(event)) events.push(event);
        } catch {
          // Keep neighboring valid diagnostic records readable.
        }
      }
    }
    return events;
  };

  const issueFromEvents = (
    events: DiagnosticEvent[],
    reference: string
  ): DiagnosticIssueDetail | undefined => {
    const related = events.filter((event) => event.reference === reference);
    const failure = [...related].reverse().find((event) => event.error);
    if (!failure?.error) return undefined;
    return {
      reference,
      action: failure.action,
      category: failure.category,
      occurredAt: failure.at,
      durationMs: failure.durationMs,
      context: failure.context,
      error: failure.error,
      events: related
    };
  };

  const readIssue = async (reference: string) =>
    issueFromEvents(await readEvents(), reference);

  const readLatestIssue = async () => {
    const events = await readEvents();
    const failure = [...events].reverse().find((event) => event.error);
    return failure ? issueFromEvents(events, failure.reference) : undefined;
  };

  return {
    directory: options.directory,
    logPath,
    runIpcOperation: async (action, args, operation) => {
      const startedAt = options.now?.() ?? new Date();
      const startedAtMs = startedAt.getTime();
      const reference = operationReference(startedAt);
      const context = action === "clipboard:write-text"
        ? undefined
        : summarizeArguments(args);
      const mutation = mutationChannelPattern.test(action);
      try {
        const result = await operation();
        const durationMs = Math.max(0, (options.now?.() ?? new Date()).getTime() - startedAtMs);
        if (mutation || durationMs >= SLOW_READ_THRESHOLD_MS) {
          await appendEvents([
            eventFor(action, "started", { reference, at: startedAt, context }),
            eventFor(action, "completed", {
              reference,
              outcome: "completed",
              durationMs,
              context
            })
          ]).catch(() => undefined);
        }
        return result;
      } catch (error) {
        const durationMs = Math.max(0, (options.now?.() ?? new Date()).getTime() - startedAtMs);
        await appendEvents([
          eventFor(action, "started", { reference, at: startedAt, context }),
          eventFor(action, "failed", {
            reference,
            outcome: "failed",
            durationMs,
            context,
            error
          })
        ]).catch(() => undefined);
        throw publicOperationError(error, reference, options.homeDir);
      }
    },
    record: async (action, phase, detail = {}) => {
      const now = options.now?.() ?? new Date();
      const reference = detail.reference ?? operationReference(now);
      await appendEvents([
        eventFor(action, phase, {
          ...detail,
          reference,
          at: now
        })
      ]).catch(() => undefined);
    },
    readIssue,
    readLatestIssue,
    exportReport: async (destination, reportOptions = {}) => {
      const events = await readEvents();
      const issue = reportOptions.reference
        ? issueFromEvents(events, reportOptions.reference)
        : (() => {
            const failure = [...events].reverse().find((event) => event.error);
            return failure ? issueFromEvents(events, failure.reference) : undefined;
          })();
      const report = sanitizeDiagnosticValue({
        schemaVersion: 1,
        generatedAt: (options.now?.() ?? new Date()).toISOString(),
        app: {
          version: options.appVersion,
          buildCommit: options.buildCommit ?? "unknown",
          packaged: options.packaged
        },
        system: {
          platform: options.platform,
          arch: options.arch,
          osVersion: options.osVersion,
          locale: options.locale
        },
        selectedIssue: issue,
        context: reportOptions.context,
        recentEvents: events.slice(-500)
      }, options.homeDir);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
    }
  };
};
