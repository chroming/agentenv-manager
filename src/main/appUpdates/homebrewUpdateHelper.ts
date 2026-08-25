import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RECEIPT_SCHEMA_VERSION = 1;
const UPDATE_ROOT_NAME = "automatic-homebrew-update";
const HELPER_TIMEOUT_SECONDS = 10 * 60;
const TERMINAL_STATE_SETTLE_MS = 250;

type HomebrewUpdateState = "scheduled" | "installing" | "completed" | "failed";

interface HomebrewUpdateReceipt {
  schemaVersion: 1;
  expectedVersion: string;
  helperPid: number;
  scheduledAt: string;
}

export type HomebrewUpdateStartupState =
  | { state: "none" }
  | { state: "running"; expectedVersion: string }
  | { state: "completed"; expectedVersion: string }
  | { state: "failed"; expectedVersion?: string; message: string };

export interface ScheduledHomebrewUpdate {
  expectedVersion: string;
  helperPid: number;
}

const helperScript = `#!/bin/sh
set -u

parent_pid="$1"
brew="$2"
expected_version="$3"
application_directory="$4"
state_path="$5"
log_path="$6"

write_state() {
  temporary_state="\${state_path}.tmp-$$"
  printf '%s\\n' "$1" > "$temporary_state"
  mv "$temporary_state" "$state_path"
}

while kill -0 "$parent_pid" 2>/dev/null; do
  sleep 0.2
done

write_state "installing"
if [ -n "$application_directory" ]; then
  "$brew" upgrade --cask "--appdir=$application_directory" chroming/tap/agentenv-manager >> "$log_path" 2>&1 &
else
  "$brew" upgrade --cask chroming/tap/agentenv-manager >> "$log_path" 2>&1 &
fi
brew_pid=$!
(
  sleep ${HELPER_TIMEOUT_SECONDS}
  kill -TERM "$brew_pid" 2>/dev/null || true
) &
watchdog_pid=$!
wait "$brew_pid"
upgrade_exit=$?
kill "$watchdog_pid" 2>/dev/null || true
wait "$watchdog_pid" 2>/dev/null || true

if [ "$upgrade_exit" -ne 0 ]; then
  printf 'Homebrew upgrade exited with status %s\\n' "$upgrade_exit" >> "$log_path"
  write_state "failed"
  exit 0
fi

installed="$($brew list --cask --versions agentenv-manager 2>> "$log_path" || true)"
case " $installed " in
  *" $expected_version "*)
    write_state "completed"
    ;;
  *)
    printf 'Homebrew did not report expected version %s: %s\\n' "$expected_version" "$installed" >> "$log_path"
    write_state "failed"
    ;;
esac
`;

const updateRoot = (cacheDirectory: string) => join(cacheDirectory, UPDATE_ROOT_NAME);
const receiptPath = (cacheDirectory: string) => join(updateRoot(cacheDirectory), "receipt.json");
const statePath = (cacheDirectory: string) => join(updateRoot(cacheDirectory), "state");
const logPath = (cacheDirectory: string) => join(updateRoot(cacheDirectory), "install.log");

const versionIsSafe = (value: unknown): value is string =>
  typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);

const processIsRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readReceipt = async (cacheDirectory: string): Promise<HomebrewUpdateReceipt | undefined> => {
  try {
    const value = JSON.parse(await readFile(receiptPath(cacheDirectory), "utf8")) as Record<string, unknown>;
    if (
      value.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
      !versionIsSafe(value.expectedVersion) ||
      typeof value.helperPid !== "number" ||
      !Number.isInteger(value.helperPid) ||
      value.helperPid <= 0 ||
      typeof value.scheduledAt !== "string"
    ) {
      throw new Error("Automatic Homebrew update receipt is invalid");
    }
    return value as unknown as HomebrewUpdateReceipt;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

const readState = async (cacheDirectory: string): Promise<HomebrewUpdateState | undefined> => {
  try {
    const value = (await readFile(statePath(cacheDirectory), "utf8")).trim();
    return ["scheduled", "installing", "completed", "failed"].includes(value)
      ? value as HomebrewUpdateState
      : undefined;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

const failureMessage = async (cacheDirectory: string) => {
  const output = await readFile(logPath(cacheDirectory), "utf8").catch(() => "");
  const lastLine = output.split("\n").map((line) => line.trim()).filter(Boolean).at(-1);
  return lastLine
    ? `Automatic Homebrew update failed: ${lastLine}`
    : "Automatic Homebrew update did not complete";
};

export const inspectHomebrewUpdateStartup = async (
  cacheDirectory: string
): Promise<HomebrewUpdateStartupState> => {
  let receipt: HomebrewUpdateReceipt | undefined;
  try {
    receipt = await readReceipt(cacheDirectory);
  } catch (error) {
    return {
      state: "failed",
      message: error instanceof Error ? error.message : String(error)
    };
  }
  if (!receipt) return { state: "none" };
  const state = await readState(cacheDirectory);
  if (state === "completed") {
    return { state: "completed", expectedVersion: receipt.expectedVersion };
  }
  if (state === "failed") {
    return {
      state: "failed",
      expectedVersion: receipt.expectedVersion,
      message: await failureMessage(cacheDirectory)
    };
  }
  if (processIsRunning(receipt.helperPid)) {
    return { state: "running", expectedVersion: receipt.expectedVersion };
  }
  // The detached shell may exit between the PID probe and the final state rename
  // becoming observable. Give that terminal receipt one bounded chance to settle.
  await new Promise((resolve) => setTimeout(resolve, TERMINAL_STATE_SETTLE_MS));
  const settledState = await readState(cacheDirectory);
  if (settledState === "completed") {
    return { state: "completed", expectedVersion: receipt.expectedVersion };
  }
  if (settledState === "failed") {
    return {
      state: "failed",
      expectedVersion: receipt.expectedVersion,
      message: await failureMessage(cacheDirectory)
    };
  }
  return {
    state: "failed",
    expectedVersion: receipt.expectedVersion,
    message: "Automatic Homebrew update helper stopped before completing"
  };
};

export const waitForHomebrewUpdateStartup = async (
  cacheDirectory: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<Exclude<HomebrewUpdateStartupState, { state: "running" }>> => {
  const timeoutMs = options.timeoutMs ?? (HELPER_TIMEOUT_SECONDS + 30) * 1_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await inspectHomebrewUpdateStartup(cacheDirectory);
    if (state.state !== "running") return state;
    if (Date.now() >= deadline) {
      return {
        state: "failed",
        expectedVersion: state.expectedVersion,
        message: "Automatic Homebrew update timed out"
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
};

export const consumeHomebrewUpdateStartup = async (cacheDirectory: string) => {
  await rm(updateRoot(cacheDirectory), { recursive: true, force: true });
};

export const scheduleHomebrewUpdateAfterQuit = async (input: {
  cacheDirectory: string;
  brewPath: string;
  expectedVersion: string;
  applicationDirectory?: string;
  parentPid?: number;
  now?: () => Date;
}): Promise<ScheduledHomebrewUpdate> => {
  if (!versionIsSafe(input.expectedVersion)) {
    throw new Error("Automatic Homebrew update version is invalid");
  }
  const existing = await inspectHomebrewUpdateStartup(input.cacheDirectory);
  if (existing.state === "running") {
    if (existing.expectedVersion === input.expectedVersion) {
      const receipt = await readReceipt(input.cacheDirectory);
      return { expectedVersion: existing.expectedVersion, helperPid: receipt!.helperPid };
    }
    throw new Error(`Homebrew update ${existing.expectedVersion} is already scheduled`);
  }
  await consumeHomebrewUpdateStartup(input.cacheDirectory);
  const root = updateRoot(input.cacheDirectory);
  const scriptPath = join(root, `install-${randomUUID()}.sh`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(scriptPath, helperScript, { encoding: "utf8", mode: 0o700, flag: "wx" });
  await chmod(scriptPath, 0o700);
  await writeFile(statePath(input.cacheDirectory), "scheduled\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  const child = spawn("/bin/sh", [
    scriptPath,
    String(input.parentPid ?? process.pid),
    input.brewPath,
    input.expectedVersion,
    input.applicationDirectory ?? "",
    statePath(input.cacheDirectory),
    logPath(input.cacheDirectory)
  ], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  if (!child.pid) {
    await consumeHomebrewUpdateStartup(input.cacheDirectory);
    throw new Error("Could not start automatic Homebrew update helper");
  }
  child.unref();
  const receipt: HomebrewUpdateReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    expectedVersion: input.expectedVersion,
    helperPid: child.pid,
    scheduledAt: (input.now ?? (() => new Date()))().toISOString()
  };
  const temporaryReceipt = `${receiptPath(input.cacheDirectory)}.tmp-${process.pid}`;
  await writeFile(temporaryReceipt, `${JSON.stringify(receipt)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  await rename(temporaryReceipt, receiptPath(input.cacheDirectory));
  return { expectedVersion: receipt.expectedVersion, helperPid: receipt.helperPid };
};
