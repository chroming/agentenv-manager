import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { posix } from "node:path";
import type {
  ProjectGitObservation,
  ProjectGitPathState,
  RemoteDevice
} from "../../shared/types";
import { findExecutable } from "../executableDiscovery";
import { shellQuote, type SshTransport } from "../remoteDevices/systemSshTransport";

const execFileAsync = promisify(execFile);
const MAX_WORKSPACE_TAR_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

export const runLocalTarCommand = async (
  args: string[],
  options: { input?: Buffer; maxOutputBytes?: number; homeDir?: string } = {}
): Promise<Buffer> => {
  const executable = await findExecutable("tar", {
    environment: process.env,
    platform: process.platform,
    homeDir: options.homeDir ?? homedir()
  });
  if (!executable) throw new Error("System tar executable was not found");

  return await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxOutputBytes ?? MAX_WORKSPACE_TAR_BYTES)) {
        child.kill("SIGTERM");
        reject(new Error("Local archive operation produced too much output"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout));
      else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `Tar command exited with ${code}`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
  });
};

export const validateTarArchiveEntries = async (archive: Buffer): Promise<void> => {
  if (archive.length === 0) return;
  const listing = (await runLocalTarCommand(["-tf", "-"], {
    input: archive,
    maxOutputBytes: 8 * 1024 * 1024
  })).toString("utf8");

  for (const rawEntry of listing.split("\n")) {
    const entry = rawEntry.replace(/^\.\//, "").replace(/\/$/, "");
    if (!entry) continue;
    if (
      entry.includes("\\") ||
      posix.isAbsolute(entry) ||
      entry.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error("Tar archive contains an unsafe entry path");
    }
  }
};

export const extractTarArchiveSafely = async (
  archive: Buffer,
  destinationDir: string
): Promise<void> => {
  if (archive.length === 0) return;
  await validateTarArchiveEntries(archive);
  await mkdir(destinationDir, { recursive: true, mode: 0o700 });
  await runLocalTarCommand(["-xf", "-", "-C", destinationDir], { input: archive });
};

export const createTarArchiveFromDirectory = async (sourceDir: string): Promise<Buffer> => {
  return await runLocalTarCommand(["-cf", "-", "-C", sourceDir, "."], {
    maxOutputBytes: MAX_WORKSPACE_TAR_BYTES
  });
};

const normalizePosixPath = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (!trimmed) throw new Error("Remote path cannot be empty");
  const converted = trimmed.replaceAll("\\", "/");
  return posix.normalize(converted);
};

const stateFromPorcelain = (output: string): ProjectGitPathState | undefined => {
  const entries = output.split("\0").filter(Boolean);
  if (entries.some((entry) => !entry.startsWith("?? ") && !entry.startsWith("!! "))) {
    return "tracked-modified";
  }
  if (entries.some((entry) => entry.startsWith("?? "))) return "untracked";
  if (entries.some((entry) => entry.startsWith("!! "))) return "ignored";
  return undefined;
};

export interface RemotePathProbeResult {
  exists: boolean;
  canonicalPath?: string;
  isDirectory?: boolean;
  error?: string;
}

export const testRemoteProjectPath = async (
  device: RemoteDevice,
  transport: SshTransport,
  rawPath: string
): Promise<RemotePathProbeResult> => {
  const normalized = normalizePosixPath(rawPath);
  const script = [
    `target=${shellQuote(normalized)}`,
    'if [ -d "$target" ]; then',
    '  canonical=$(cd "$target" && pwd -P 2>/dev/null || pwd 2>/dev/null)',
    '  printf "DIR\\t%s\\n" "$canonical"',
    'elif [ -e "$target" ]; then',
    '  printf "NOT_DIR\\t%s\\n" "$target"',
    'else',
    '  printf "MISSING\\t%s\\n" "$target"',
    '  exit 1',
    'fi'
  ].join("\n");

  try {
    const result = await transport.execute(device, `sh -c ${shellQuote(script)}`, {
      timeoutMs: 8_000
    });
    const stdout = result.stdout.toString("utf8").trim();
    const [status, path] = stdout.split("\t");
    if (result.exitCode === 0 && status === "DIR" && path) {
      return { exists: true, isDirectory: true, canonicalPath: path };
    }
    if (status === "NOT_DIR") {
      return { exists: true, isDirectory: false, canonicalPath: path, error: "Path exists but is not a directory" };
    }
    return { exists: false, error: result.stderr || "Remote directory does not exist" };
  } catch (error) {
    return {
      exists: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

export const inspectRemoteGit = async (
  device: RemoteDevice,
  transport: SshTransport,
  rootPath: string,
  relativePaths: readonly string[]
): Promise<ProjectGitObservation> => {
  const normalizedRoot = normalizePosixPath(rootPath);
  if (relativePaths.length === 0) {
    return { repository: "not-git", pathStates: {} };
  }

  const script = [
    `cd ${shellQuote(normalizedRoot)} || { printf "CD_FAIL\\n"; exit 1; }`,
    'if ! git rev-parse --show-toplevel >/dev/null 2>&1; then',
    '  printf "NOT_GIT\\n"',
    '  exit 0',
    'fi',
    'printf "IS_GIT\\t%s\\n" "$(git rev-parse --show-toplevel 2>/dev/null)"',
    'git status --porcelain=v1 -z --ignored --untracked-files=all -- "$@"'
  ].join("\n");

  const quotedArgs = relativePaths.map((p) => shellQuote(p)).join(" ");
  try {
    const result = await transport.execute(
      device,
      `sh -c ${shellQuote(script)} sh ${quotedArgs}`,
      { timeoutMs: 12_000 }
    );
    if (result.exitCode !== 0) {
      return {
        repository: "unavailable",
        pathStates: {},
        issue: result.stderr || "Remote Git status check failed"
      };
    }

    const output = result.stdout.toString("utf8");
    const firstLineEnd = output.indexOf("\n");
    const header = firstLineEnd >= 0 ? output.slice(0, firstLineEnd) : output;
    if (header.startsWith("NOT_GIT")) {
      return { repository: "not-git", pathStates: {} };
    }
    if (!header.startsWith("IS_GIT\t")) {
      return { repository: "unavailable", pathStates: {}, issue: "Unexpected Git output" };
    }

    const repositoryRoot = header.slice("IS_GIT\t".length).trim();
    const porcelainOutput = firstLineEnd >= 0 ? output.slice(firstLineEnd + 1) : "";

    const pathStates: Record<string, ProjectGitPathState> = {};
    for (const relPath of relativePaths) {
      const state = stateFromPorcelain(
        porcelainOutput
          .split("\0")
          .filter((entry) => entry.endsWith(relPath) || entry.endsWith(` ${relPath}`))
          .join("\0")
      );
      if (state) {
        pathStates[relPath] = state;
      } else {
        pathStates[relPath] = "tracked-clean";
      }
    }

    const relation = posix.relative(repositoryRoot, normalizedRoot);
    const rootRelation =
      !relation || relation === "."
        ? ("workspace-root" as const)
        : relation.startsWith("../") || posix.isAbsolute(relation)
          ? ("repository-inside-workspace" as const)
          : ("workspace-inside-repository" as const);

    return {
      repository: "git",
      rootRelation,
      pathStates
    };
  } catch (error) {
    return {
      repository: "unavailable",
      pathStates: {},
      issue: error instanceof Error ? error.message : "Remote Git is unavailable"
    };
  }
};

export const fetchRemoteWorkspaceResourcesTar = async (
  device: RemoteDevice,
  transport: SshTransport,
  rootPath: string,
  candidateRelativePaths: readonly string[]
): Promise<Buffer> => {
  const normalizedRoot = normalizePosixPath(rootPath);
  if (candidateRelativePaths.length === 0) {
    return Buffer.alloc(1024);
  }

  const script = [
    `cd ${shellQuote(normalizedRoot)} || exit 1`,
    'existing=""',
    'for p in "$@"; do',
    '  if [ -e "$p" ]; then',
    '    existing="$existing $p"',
    '  fi',
    'done',
    'if [ -z "$existing" ]; then',
    '  tar -cf - --files-from /dev/null 2>/dev/null || tar -cf - -T /dev/null 2>/dev/null',
    'else',
    '  tar -chf - $existing',
    'fi'
  ].join("\n");

  const quotedArgs = candidateRelativePaths.map((p) => shellQuote(p)).join(" ");
  const result = await transport.execute(
    device,
    `sh -c ${shellQuote(script)} sh ${quotedArgs}`,
    {
      timeoutMs: 25_000,
      maxOutputBytes: MAX_WORKSPACE_TAR_BYTES
    }
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to fetch remote workspace resources");
  }
  return result.stdout;
};

export const readRemoteTextFile = async (
  device: RemoteDevice,
  transport: SshTransport,
  remoteFilePath: string
): Promise<string> => {
  const normalizedPath = normalizePosixPath(remoteFilePath);
  const script = [
    `target=${shellQuote(normalizedPath)}`,
    'if [ ! -f "$target" ]; then',
    '  printf "FILE_NOT_FOUND\\n" >&2',
    '  exit 44',
    'fi',
    'cat -- "$target"'
  ].join("\n");

  const result = await transport.execute(device, `sh -c ${shellQuote(script)}`, {
    timeoutMs: 15_000,
    maxOutputBytes: MAX_TEXT_BYTES
  });

  if (result.exitCode === 44) {
    const error = new Error("File not found") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Failed to read remote file: ${remoteFilePath}`);
  }
  return result.stdout.toString("utf8");
};

export const writeRemoteTextFile = async (
  device: RemoteDevice,
  transport: SshTransport,
  remoteFilePath: string,
  content: string
): Promise<void> => {
  const normalizedPath = normalizePosixPath(remoteFilePath);
  const targetDir = posix.dirname(normalizedPath);
  const tempPath = `${normalizedPath}.agentenv-tmp-${Date.now()}`;
  const input = Buffer.from(content, "utf8");

  const script = [
    `dir=${shellQuote(targetDir)}`,
    `target=${shellQuote(normalizedPath)}`,
    `tmp=${shellQuote(tempPath)}`,
    'mkdir -p -- "$dir" || exit 1',
    'cat > "$tmp" || exit 2',
    'mv -f -- "$tmp" "$target" || exit 3'
  ].join("\n");

  const result = await transport.execute(device, `sh -c ${shellQuote(script)}`, {
    input,
    timeoutMs: 20_000
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Failed to write remote file: ${remoteFilePath}`);
  }
};

export const deploySkillToRemote = async (
  device: RemoteDevice,
  transport: SshTransport,
  tarArchive: Buffer,
  remoteSkillDestination: string
): Promise<void> => {
  const normalizedDest = normalizePosixPath(remoteSkillDestination);
  const script = [
    `dest=${shellQuote(normalizedDest)}`,
    'mkdir -p -- "$dest" || exit 1',
    'tar -xf - -C "$dest" || exit 2'
  ].join("\n");

  const result = await transport.execute(device, `sh -c ${shellQuote(script)}`, {
    input: tarArchive,
    timeoutMs: 30_000,
    maxOutputBytes: 16 * 1024 * 1024
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Failed to deploy skill to remote: ${remoteSkillDestination}`);
  }
};

export const archiveRemoteDirectory = async (
  device: RemoteDevice,
  transport: SshTransport,
  remoteDirectory: string
): Promise<Buffer> => {
  const normalizedDir = normalizePosixPath(remoteDirectory);
  const script = [
    `dir=${shellQuote(normalizedDir)}`,
    'if [ ! -d "$dir" ]; then',
    '  printf "DIR_NOT_FOUND\\n" >&2',
    '  exit 44',
    'fi',
    'tar -chf - -C "$dir" .'
  ].join("\n");

  const result = await transport.execute(device, `sh -c ${shellQuote(script)}`, {
    timeoutMs: 30_000,
    maxOutputBytes: MAX_WORKSPACE_TAR_BYTES
  });

  if (result.exitCode === 44) {
    const error = new Error("Directory not found") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Failed to archive remote directory: ${remoteDirectory}`);
  }
  return result.stdout;
};

export const removeRemotePath = async (
  device: RemoteDevice,
  transport: SshTransport,
  remotePath: string
): Promise<void> => {
  const normalizedPath = normalizePosixPath(remotePath);
  const script = [
    `target=${shellQuote(normalizedPath)}`,
    'rm -rf -- "$target"'
  ].join("\n");

  const result = await transport.execute(device, `sh -c ${shellQuote(script)}`, {
    timeoutMs: 15_000
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Failed to remove remote path: ${remotePath}`);
  }
};
