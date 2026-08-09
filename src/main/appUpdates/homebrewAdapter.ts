import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname } from "node:path";

const CASK = "chroming/tap/agentenv-manager";
const BREW_CANDIDATES = [
  "/opt/homebrew/bin/brew",
  "/usr/local/bin/brew",
  "/home/linuxbrew/.linuxbrew/bin/brew"
];

export interface HomebrewInspection {
  available: boolean;
  managed: boolean;
  executablePath?: string;
  installedVersion?: string;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HomebrewAdapter {
  inspect(options?: { refresh?: boolean }): Promise<HomebrewInspection>;
  download(): Promise<void>;
  install(expectedVersion: string): Promise<void>;
}

export const applicationDirectoryForExecutable = (executablePath: string) => {
  let current = dirname(executablePath);
  while (current !== dirname(current)) {
    if (current.toLowerCase().endsWith(".app")) return dirname(current);
    current = dirname(current);
  }
  return undefined;
};

const defaultCanExecute = async (path: string) => {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const defaultRun = (
  file: string,
  args: string[],
  options: { timeoutMs: number }
): Promise<CommandResult> => new Promise((resolve) => {
  execFile(file, args, {
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    env: process.env
  }, (error, stdout, stderr) => {
    resolve({
      exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
      stdout: String(stdout),
      stderr: String(stderr)
    });
  });
});

export const createHomebrewAdapter = (options: {
  platform?: NodeJS.Platform;
  applicationDirectory?: string;
  executableCandidates?: string[];
  canExecute?: (path: string) => Promise<boolean>;
  run?: (file: string, args: string[], options: { timeoutMs: number }) => Promise<CommandResult>;
} = {}): HomebrewAdapter => {
  const platform = options.platform ?? process.platform;
  const canExecute = options.canExecute ?? defaultCanExecute;
  const run = options.run ?? defaultRun;
  let inspection: HomebrewInspection | undefined;

  const inspect = async (inspectOptions: { refresh?: boolean } = {}): Promise<HomebrewInspection> => {
    if (inspectOptions.refresh) inspection = undefined;
    if (inspection) return inspection;
    if (platform !== "darwin") return { available: false, managed: false };
    const executablePath = (await Promise.all(
      (options.executableCandidates ?? BREW_CANDIDATES)
        .map(async (path) => await canExecute(path) ? path : undefined)
    )).find(Boolean);
    if (!executablePath) return { available: false, managed: false };
    const result = await run(
      executablePath,
      ["list", "--cask", "--versions", "agentenv-manager"],
      { timeoutMs: 15_000 }
    );
    inspection = {
      available: true,
      managed: result.exitCode === 0 && result.stdout.trim().length > 0,
      executablePath,
      ...(result.exitCode === 0 && result.stdout.trim().split(/\s+/)[1]
        ? { installedVersion: result.stdout.trim().split(/\s+/)[1] }
        : {})
    };
    return inspection;
  };

  const runManaged = async (args: string[], timeoutMs: number) => {
    const current = await inspect();
    if (!current.available || !current.managed || !current.executablePath) {
      throw new Error("AgentEnv Manager is not managed by Homebrew");
    }
    const result = await run(current.executablePath, args, { timeoutMs });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Homebrew update failed");
    }
  };

  return {
    inspect,
    download: () => runManaged(["fetch", "--cask", CASK], 5 * 60_000),
    install: async (expectedVersion) => {
      await runManaged([
        "upgrade",
        "--cask",
        ...(options.applicationDirectory
          ? [`--appdir=${options.applicationDirectory}`]
          : []),
        CASK
      ], 10 * 60_000);
      inspection = undefined;
      const current = await inspect();
      if (!current.managed || !current.executablePath) {
        throw new Error("Homebrew did not retain the AgentEnv Manager Cask");
      }
      if (current.installedVersion !== expectedVersion) {
        throw new Error(`Homebrew installed version does not match ${expectedVersion}`);
      }
    }
  };
};
