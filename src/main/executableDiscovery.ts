import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

export interface ExecutableDiscoveryOptions {
  homeDir: string;
  pathEnv?: string;
  systemPathLookup?: boolean;
  shellPathLookup?: boolean;
  shellCandidates?: string[];
  shellTimeoutMs?: number;
}

const execFileAsync = promisify(execFile);
const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const canExecute = async (path: string) => {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const createExecutableSearchPaths = (
  pathEnv: string,
  homeDir: string,
  systemPathLookup: boolean
) =>
  unique([
    ...pathEnv.split(delimiter),
    join(homeDir, ".local", "bin"),
    join(homeDir, ".npm-global", "bin"),
    join(homeDir, ".bun", "bin"),
    join(homeDir, ".cargo", "bin"),
    join(homeDir, ".deno", "bin"),
    join(homeDir, ".volta", "bin"),
    join(homeDir, "Library", "pnpm"),
    ...(systemPathLookup
      ? [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin"
        ]
      : [])
  ]);

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const findExecutableFromLoginShell = async (
  name: string,
  options: ExecutableDiscoveryOptions
) => {
  const shells = unique(
    options.shellCandidates ?? [process.env.SHELL ?? "", "/bin/zsh", "/bin/bash"]
  );
  for (const shell of shells) {
    try {
      const { stdout } = await execFileAsync(
        shell,
        ["-lc", `command -v -- ${shellQuote(name)}`],
        {
          env: { ...process.env, HOME: options.homeDir },
          timeout: options.shellTimeoutMs ?? 2_000
        }
      );
      const candidate = stdout.trim().split("\n")[0];
      if (candidate && isAbsolute(candidate) && (await canExecute(candidate))) {
        return candidate;
      }
    } catch {
      // Shell startup files vary by machine; direct search paths remain authoritative.
    }
  }
  return undefined;
};

export const findExecutable = async (
  name: string,
  options: ExecutableDiscoveryOptions
): Promise<string | undefined> => {
  if (!isAbsolute(name) && !/^[A-Za-z0-9._+-]+$/.test(name)) {
    throw new Error("Executable name is invalid");
  }

  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  const systemPathLookup = options.systemPathLookup ?? true;
  const shellPathLookup = options.shellPathLookup ?? true;
  const candidates = isAbsolute(name)
    ? [name]
    : createExecutableSearchPaths(pathEnv, options.homeDir, systemPathLookup).map((dir) =>
        join(dir, name)
      );

  for (const candidate of candidates) {
    if (await canExecute(candidate)) {
      return candidate;
    }
  }

  if (!shellPathLookup || isAbsolute(name)) {
    return undefined;
  }
  return findExecutableFromLoginShell(name, options);
};
