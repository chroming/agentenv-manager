import { spawn } from "node:child_process";
import { glob, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { SshConfigHost, SshConfigHostResolution } from "../../shared/types";
import { createExecutableResolver } from "../executableDiscovery";
import { isMissingFileError } from "../fileUtils";

const MAX_CONFIG_FILES = 128;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const CONCRETE_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SshConfigDiscovery {
  listHosts(): Promise<SshConfigHost[]>;
  resolveHost(alias: string): Promise<SshConfigHostResolution>;
}

const stripComment = (line: string) => {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") return line.slice(0, index);
  }
  return line;
};

const splitWords = (value: string) => {
  const words: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;
  const push = () => {
    if (!current) return;
    words.push(current);
    current = "";
  };
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      else current += character;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) push();
    else current += character;
  }
  if (escaped) current += "\\";
  push();
  return words;
};

const parseDirective = (line: string) => {
  const content = stripComment(line).trim();
  if (!content) return undefined;
  const match = /^([A-Za-z][A-Za-z0-9-]*)(?:\s*=\s*|\s+)(.*)$/.exec(content);
  if (!match) return undefined;
  return { keyword: match[1].toLocaleLowerCase(), values: splitWords(match[2]) };
};

const hasGlobPattern = (value: string) =>
  value.includes("*") || value.includes("?") || value.includes("[");

const includePath = (value: string, homeDir: string, sshDir: string) => {
  const expanded = value
    .replace(/^~(?=\/|$)/, homeDir)
    .replaceAll("%d", homeDir);
  return isAbsolute(expanded) ? expanded : resolve(sshDir, expanded);
};

const expandInclude = async (value: string, homeDir: string, sshDir: string) => {
  const pattern = includePath(value, homeDir, sshDir);
  if (!hasGlobPattern(pattern)) return [pattern];
  const matches: string[] = [];
  for await (const path of glob(pattern)) matches.push(path);
  return matches.sort((left, right) => left.localeCompare(right));
};

export const readSshConfigAliases = async (homeDir: string): Promise<SshConfigHost[]> => {
  const sshDir = join(homeDir, ".ssh");
  const rootConfig = join(sshDir, "config");
  const aliases = new Map<string, SshConfigHost>();
  const visited = new Set<string>();

  const visit = async (path: string): Promise<void> => {
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(path);
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
    if (visited.has(canonicalPath)) return;
    if (visited.size >= MAX_CONFIG_FILES) {
      throw new Error("SSH config includes too many files");
    }
    visited.add(canonicalPath);
    const content = await readFile(canonicalPath, "utf8");
    if (Buffer.byteLength(content) > MAX_CONFIG_BYTES) {
      throw new Error(`SSH config file is too large: ${canonicalPath}`);
    }
    for (const line of content.split(/\r?\n/)) {
      const directive = parseDirective(line);
      if (!directive) continue;
      if (directive.keyword === "host") {
        for (const alias of directive.values) {
          if (
            alias.startsWith("!") ||
            hasGlobPattern(alias) ||
            !CONCRETE_HOST_PATTERN.test(alias)
          ) continue;
          const key = alias.toLocaleLowerCase();
          if (!aliases.has(key)) aliases.set(key, { alias });
        }
      } else if (directive.keyword === "include") {
        for (const pattern of directive.values) {
          for (const includedPath of await expandInclude(pattern, homeDir, sshDir)) {
            await visit(includedPath);
          }
        }
      }
    }
  };

  await visit(rootConfig);
  return [...aliases.values()].sort((left, right) =>
    left.alias.localeCompare(right.alias, undefined, { sensitivity: "base" })
  );
};

const runCommand = async (
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv
): Promise<CommandResult> => await new Promise((resolveCommand, reject) => {
  const child = spawn(executable, args, {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill("SIGTERM");
    reject(new Error("Reading SSH config timed out"));
  }, 5_000);
  const collect = (chunks: Buffer[], chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > MAX_OUTPUT_BYTES) {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("SSH config output is too large"));
      }
      return;
    }
    chunks.push(chunk);
  };
  child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
  child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
  child.on("error", (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    reject(error);
  });
  child.on("close", (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolveCommand({
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8").trim(),
      exitCode: code ?? 1
    });
  });
});

const parseResolvedConfig = (alias: string, output: string): SshConfigHostResolution => {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(" ");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).toLocaleLowerCase();
    if (!values.has(key)) values.set(key, line.slice(separator + 1).trim());
  }
  const portValue = values.get("port");
  const parsedPort = portValue ? Number(portValue) : undefined;
  const port = Number.isInteger(parsedPort) && parsedPort! >= 1 && parsedPort! <= 65_535
    ? parsedPort
    : undefined;
  return {
    alias,
    hostName: values.get("hostname") || alias,
    user: values.get("user") || undefined,
    port
  };
};

export const createSshConfigDiscovery = (options: {
  homeDir: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  pathEnv?: string;
  run?: (executable: string, args: string[], environment: NodeJS.ProcessEnv) => Promise<CommandResult>;
}): SshConfigDiscovery => {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const resolver = createExecutableResolver({
    homeDir: options.homeDir,
    platform,
    environment,
    pathEnv: options.pathEnv ?? environment.PATH ?? "",
    systemPathLookup: true,
    shellPathLookup: true
  });
  const execute = options.run ?? runCommand;
  const configPath = join(options.homeDir, ".ssh", "config");

  return {
    listHosts: () => readSshConfigAliases(options.homeDir),
    resolveHost: async (alias) => {
      if (!CONCRETE_HOST_PATTERN.test(alias)) throw new Error("Invalid SSH config host");
      const executable = await resolver.find("ssh");
      if (!executable) throw new Error("System OpenSSH was not found");
      const result = await execute(
        executable,
        ["-G", "-F", configPath, "--", alias],
        environment
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `Could not read SSH config for ${alias}`);
      }
      return parseResolvedConfig(alias, result.stdout);
    }
  };
};
