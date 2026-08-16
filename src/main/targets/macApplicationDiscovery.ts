import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { TargetExecutableStatus } from "../../shared/types";

const COMMAND_TIMEOUT_MS = 5_000;
const OUTPUT_LIMIT = 256 * 1024;
const BUNDLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9.-]+$/;

interface CommandResult {
  stdout: string;
  stderr: string;
}

const runCommand = (
  executablePath: string,
  args: string[],
  timeout = COMMAND_TIMEOUT_MS
): Promise<CommandResult> => new Promise((resolve, reject) => {
  execFile(executablePath, args, {
    timeout,
    maxBuffer: OUTPUT_LIMIT,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1" }
  }, (error, stdout, stderr) => {
    if (error) {
      reject(error);
      return;
    }
    resolve({ stdout, stderr });
  });
});

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isMissing = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");

export interface MacApplicationDiscovery {
  findApplicationsByBundleIdentifier(bundleIdentifier: string): Promise<string[]>;
  readBundleIdentifier(applicationPath: string): Promise<string | undefined>;
  probeExecutable(
    executablePath: string,
    args?: string[]
  ): Promise<{
    status: TargetExecutableStatus;
    version?: string;
    error?: string;
  }>;
}

export const createMacApplicationDiscovery = (): MacApplicationDiscovery => ({
  findApplicationsByBundleIdentifier: async (bundleIdentifier) => {
    if (!BUNDLE_IDENTIFIER_PATTERN.test(bundleIdentifier)) return [];
    try {
      const { stdout } = await runCommand(
        "/usr/bin/mdfind",
        [`kMDItemCFBundleIdentifier == \"${bundleIdentifier}\"`],
        2_000
      );
      return [...new Set(stdout
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter((path) => path.startsWith("/") && path.endsWith(".app")))];
    } catch {
      return [];
    }
  },

  readBundleIdentifier: async (applicationPath) => {
    try {
      const { stdout } = await runCommand("/usr/bin/plutil", [
        "-extract",
        "CFBundleIdentifier",
        "raw",
        "-o",
        "-",
        join(applicationPath, "Contents", "Info.plist")
      ], 2_000);
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  },

  probeExecutable: async (executablePath, args = ["--version"]) => {
    try {
      await access(executablePath, constants.X_OK);
    } catch (error) {
      return {
        status: "missing",
        ...(!isMissing(error)
          ? { error: `Bundled runtime is not executable: ${errorMessage(error)}` }
          : {})
      };
    }

    try {
      const { stdout, stderr } = await runCommand(executablePath, args);
      const version = `${stdout}${stderr}`.trim().split(/\r?\n/)[0]?.trim();
      return {
        status: "found",
        ...(version ? { version } : {})
      };
    } catch (error) {
      return {
        status: "unknown",
        error: `Bundled runtime check failed: ${errorMessage(error)}`
      };
    }
  }
});
