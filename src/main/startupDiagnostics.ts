import { appendFile, copyFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StartupFailureKind, StartupStatus } from "../shared/types";
import { AppDataFormatError } from "./appDataFormat";
import { isMissingFileError } from "./fileUtils";

const MAX_LOG_BYTES = 512 * 1024;
const LOG_GENERATIONS = 3;

const errorCodeFor = (error: unknown) =>
  error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

export const classifyStartupFailure = (
  error: unknown,
  dataRoot?: string
): Extract<StartupStatus, { state: "failed" }> => {
  const message = error instanceof Error ? error.message : String(error);
  let kind: StartupFailureKind = "unknown";
  if (error instanceof AppDataFormatError) {
    kind = error.kind === "newer" ? "newer-data-format" : "invalid-data";
  } else if (["EACCES", "EPERM", "EROFS"].includes(errorCodeFor(error) ?? "")) {
    kind = "permission";
  } else if (/recover|journal|interrupted|rollback/i.test(message)) {
    kind = "recovery";
  }
  const titleByKind: Record<StartupFailureKind, string> = {
    "newer-data-format": "This data needs a newer AgentEnv Manager",
    "invalid-data": "AgentEnv data needs attention",
    permission: "AgentEnv cannot access its data",
    recovery: "AgentEnv could not finish recovery",
    unknown: "AgentEnv Manager could not start"
  };
  return {
    state: "failed",
    kind,
    title: titleByKind[kind],
    message,
    dataRoot,
    canRetry: true
  };
};

const redact = (value: string, homeDir: string) => value
  .replaceAll(homeDir, "~")
  .replace(/(token|authorization|password|secret|api[_-]?key)([\s"':=]+)[^\s,"'}]+/gi, "$1$2[redacted]")
  .replace(/(gh[pousr]_[A-Za-z0-9_]{20,})/g, "[redacted-github-token]")
  .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[redacted]");

export const createStartupDiagnostics = (options: {
  directory: string;
  homeDir: string;
  now?: () => Date;
}) => {
  const logPath = join(options.directory, "startup.log");
  const rotate = async () => {
    try {
      if ((await stat(logPath)).size < MAX_LOG_BYTES) return;
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
    for (let index = LOG_GENERATIONS - 1; index >= 1; index -= 1) {
      const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
      try {
        await rename(source, `${logPath}.${index}`);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }
  };
  const record = async (event: string, detail?: unknown) => {
    await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
    await rotate();
    const rawDetail = detail instanceof Error
      ? { name: detail.name, message: detail.message, stack: detail.stack }
      : detail;
    const line = redact(JSON.stringify({
      at: (options.now?.() ?? new Date()).toISOString(),
      event,
      detail: rawDetail
    }), options.homeDir);
    await appendFile(logPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
  };
  return {
    logPath,
    record,
    exportTo: async (destination: string) => {
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(logPath, destination);
    }
  };
};
