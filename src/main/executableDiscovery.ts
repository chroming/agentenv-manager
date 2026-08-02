import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { promisify } from "node:util";
import { pathsEqual } from "./platformPaths";

export interface ExecutableDiscoveryOptions {
  homeDir: string;
  pathEnv?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  pathExtensions?: string;
  systemPathLookup?: boolean;
  shellPathLookup?: boolean;
  shellCandidates?: string[];
  shellTimeoutMs?: number;
  canExecute?: (path: string) => Promise<boolean>;
}

const execFileAsync = promisify(execFile);
const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const canExecute = async (path: string, platform: NodeJS.Platform) => {
  try {
    await access(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const createExecutableSearchPaths = (
  pathEnv: string,
  homeDir: string,
  systemPathLookup: boolean,
  options: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
  } = {}
) => {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const pathApi = platform === "win32" ? win32 : posix;
  const environmentHome =
    platform === "win32"
      ? environment.USERPROFILE ?? environment.HOME
      : environment.HOME ?? environment.USERPROFILE;
  const userEnvironment =
    !environmentHome || pathsEqual(environmentHome, homeDir, platform)
      ? environment
      : {};
  const absoluteEnvironmentPath = (value: string | undefined) =>
    value?.trim() && pathApi.isAbsolute(value.trim()) ? value.trim() : "";
  const npmPrefix =
    absoluteEnvironmentPath(
      userEnvironment.NPM_CONFIG_PREFIX ?? userEnvironment.npm_config_prefix
    );
  const userBins = [
    pathApi.join(homeDir, ".local", "bin"),
    pathApi.join(homeDir, ".npm-global", "bin"),
    pathApi.join(homeDir, ".bun", "bin"),
    pathApi.join(homeDir, ".cargo", "bin"),
    pathApi.join(homeDir, ".deno", "bin"),
    pathApi.join(homeDir, ".volta", "bin"),
    absoluteEnvironmentPath(userEnvironment.PNPM_HOME),
    absoluteEnvironmentPath(userEnvironment.BUN_INSTALL)
      ? pathApi.join(absoluteEnvironmentPath(userEnvironment.BUN_INSTALL), "bin")
      : "",
    absoluteEnvironmentPath(userEnvironment.VOLTA_HOME)
      ? pathApi.join(absoluteEnvironmentPath(userEnvironment.VOLTA_HOME), "bin")
      : "",
    npmPrefix
      ? platform === "win32"
        ? npmPrefix
        : pathApi.join(npmPrefix, "bin")
      : ""
  ];
  if (platform === "win32") {
    userBins.push(
      userEnvironment.APPDATA ? pathApi.join(userEnvironment.APPDATA, "npm") : "",
      userEnvironment.LOCALAPPDATA
        ? pathApi.join(userEnvironment.LOCALAPPDATA, "Microsoft", "WindowsApps")
        : "",
      userEnvironment.LOCALAPPDATA
        ? pathApi.join(userEnvironment.LOCALAPPDATA, "pnpm")
        : "",
      pathApi.join(homeDir, "scoop", "shims"),
      environment.ChocolateyInstall
        ? pathApi.join(environment.ChocolateyInstall, "bin")
        : ""
    );
  } else if (platform === "darwin") {
    userBins.push(pathApi.join(homeDir, "Library", "pnpm"));
  } else {
    userBins.push(
      userEnvironment.XDG_DATA_HOME
        ? pathApi.join(userEnvironment.XDG_DATA_HOME, "pnpm")
        : pathApi.join(homeDir, ".local", "share", "pnpm")
    );
  }
  const systemBins =
    platform === "win32"
      ? [
          environment.SystemRoot
            ? pathApi.join(environment.SystemRoot, "System32")
            : "",
          environment.ProgramFiles
            ? pathApi.join(environment.ProgramFiles, "Git", "cmd")
            : ""
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin"
        ];
  return unique([
    ...pathEnv.split(pathApi.delimiter),
    ...userBins,
    ...(systemPathLookup ? systemBins : [])
  ]);
};

const readPathFromLoginShell = async (
  options: ExecutableDiscoveryOptions
) => {
  if ((options.platform ?? process.platform) === "win32") return undefined;
  const environment = options.environment ?? process.env;
  const shells = unique(
    options.shellCandidates ?? [environment.SHELL ?? "", "/bin/zsh", "/bin/bash", "/bin/sh"]
  );
  for (const shell of shells) {
    try {
      const { stdout } = await execFileAsync(
        shell,
        ["-lc", "printf '%s' \"$PATH\""],
        {
          env: { ...environment, HOME: options.homeDir },
          timeout: options.shellTimeoutMs ?? 2_000
        }
      );
      if (stdout.trim()) return stdout.trim();
    } catch {
      // Shell startup files vary by machine; direct search paths remain authoritative.
    }
  }
  return undefined;
};

export interface ExecutableResolver {
  find(name: string): Promise<string | undefined>;
  invalidateShellPath(): void;
}

export const createExecutableResolver = (
  options: ExecutableDiscoveryOptions
): ExecutableResolver => {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const pathApi = platform === "win32" ? win32 : posix;
  let shellPathPromise: Promise<string | undefined> | undefined;
  const directPath = options.pathEnv ?? environment.PATH ?? "";
  const systemPathLookup = options.systemPathLookup ?? true;
  const shellPathLookup =
    platform !== "win32" && (options.shellPathLookup ?? true);
  const executableCheck =
    options.canExecute ?? ((path: string) => canExecute(path, platform));
  const windowsExtensions = unique(
    (options.pathExtensions ?? environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .map((extension) =>
        extension && extension.startsWith(".")
          ? extension.toLowerCase()
          : extension
            ? `.${extension.toLowerCase()}`
            : ""
      )
  );
  const namesFor = (name: string) => {
    if (platform !== "win32") return [name];
    const extension = pathApi.extname(name).toLowerCase();
    if (windowsExtensions.includes(extension)) return [name];
    return windowsExtensions.map((candidate) => `${name}${candidate}`);
  };
  const search = async (name: string, pathEnv: string) => {
    const names = namesFor(name);
    const candidates = pathApi.isAbsolute(name)
      ? names
      : createExecutableSearchPaths(
          pathEnv,
          options.homeDir,
          systemPathLookup,
          { platform, environment }
        ).flatMap((dir) => names.map((candidate) => pathApi.join(dir, candidate)));
    for (const candidate of candidates) {
      if (await executableCheck(candidate)) return candidate;
    }
    return undefined;
  };

  return {
    find: async (name) => {
      if (!pathApi.isAbsolute(name) && !/^[A-Za-z0-9._+-]+$/.test(name)) {
        throw new Error("Executable name is invalid");
      }
      const direct = await search(name, directPath);
      if (direct || !shellPathLookup || pathApi.isAbsolute(name)) return direct;
      shellPathPromise ??= readPathFromLoginShell(options);
      const shellPath = await shellPathPromise;
      return shellPath ? search(name, shellPath) : undefined;
    },
    invalidateShellPath: () => {
      shellPathPromise = undefined;
    }
  };
};

export const findExecutable = async (
  name: string,
  options: ExecutableDiscoveryOptions
): Promise<string | undefined> => createExecutableResolver(options).find(name);
