import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { TrustedRelease } from "./releaseClient";

const APP_NAME = "AgentEnv Manager.app";
const APP_ID = "io.github.chroming.agentenvmanager";
const EXECUTABLE_RELATIVE_PATH = "Contents/MacOS/AgentEnv Manager";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DirectUpdateInspection {
  available: boolean;
  reason?:
    | "unsupported-platform"
    | "application-bundle-invalid"
    | "application-directory-not-writable";
}

export interface DirectUpdateAdapter {
  inspect(): Promise<DirectUpdateInspection>;
  download(release: TrustedRelease): Promise<void>;
  install(expectedVersion: string): Promise<void>;
}

interface PreparedDirectUpdate {
  release: TrustedRelease;
  root: string;
  applicationPath: string;
}

const defaultRun = (
  file: string,
  args: string[],
  timeoutMs: number
): Promise<CommandResult> => new Promise((resolve) => {
  execFile(file, args, {
    encoding: "utf8",
    timeout: timeoutMs,
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

const requireSuccessfulCommand = async (
  run: typeof defaultRun,
  file: string,
  args: string[],
  timeoutMs: number,
  label: string
) => {
  const result = await run(file, args, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(
      `${label}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`
    );
  }
  return result.stdout.trim();
};

const defaultVerifyApplication = async (
  applicationPath: string,
  expectedVersion: string,
  run: typeof defaultRun
) => {
  const metadata = await lstat(applicationPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Verified update is not an application bundle: ${applicationPath}`);
  }
  const infoPath = join(applicationPath, "Contents", "Info.plist");
  const [identifier, version] = await Promise.all([
    requireSuccessfulCommand(
      run,
      "/usr/bin/plutil",
      ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPath],
      15_000,
      "Could not read the update bundle identifier"
    ),
    requireSuccessfulCommand(
      run,
      "/usr/bin/plutil",
      ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPath],
      15_000,
      "Could not read the update version"
    )
  ]);
  if (identifier !== APP_ID) {
    throw new Error(`Verified update has an unexpected bundle identifier: ${identifier}`);
  }
  if (version !== expectedVersion) {
    throw new Error(`Verified update version ${version} does not match ${expectedVersion}`);
  }
  await requireSuccessfulCommand(
    run,
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", applicationPath],
    60_000,
    "Update signature verification failed"
  );
};

const downloadVerifiedAsset = async (
  release: TrustedRelease,
  destination: string,
  request: typeof globalThis.fetch
) => {
  const response = await request(release.asset.url, {
    headers: { "User-Agent": "AgentEnv-Manager" },
    signal: AbortSignal.timeout(10 * 60_000)
  });
  if (!response.ok || !response.body) {
    throw new Error(`Update download failed (HTTP ${response.status})`);
  }
  const temporaryPath = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    const hash = createHash("sha256");
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > release.asset.size) {
          throw new Error("Update download exceeded its verified size");
        }
        hash.update(result.value);
        await file.write(result.value);
      }
      await file.sync();
    } finally {
      await reader.cancel().catch(() => undefined);
      await file.close();
    }
    if (size !== release.asset.size) {
      throw new Error(`Update download size ${size} does not match ${release.asset.size}`);
    }
    const digest = hash.digest("hex");
    if (digest !== release.asset.sha256) {
      throw new Error("Update download failed its SHA-256 verification");
    }
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

const UPDATE_HELPER = `#!/bin/sh
set -u
parent_pid="$1"
target="$2"
staging="$3"
backup="$4"
confirmation="$5"
work_root="$6"
log_path="$7"
executable_relative="$8"
launched_pid=""

log() {
  printf '%s %s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$log_path"
}

launch() {
  if [ -n "$1" ]; then
    "$target/$executable_relative" "$1" >> "$log_path" 2>&1 &
  else
    "$target/$executable_relative" >> "$log_path" 2>&1 &
  fi
  launched_pid=$!
}

rollback() {
  log "rolling back direct update"
  if [ -n "$launched_pid" ] && kill -0 "$launched_pid" 2>/dev/null; then
    kill "$launched_pid" 2>/dev/null || true
    wait "$launched_pid" 2>/dev/null || true
  fi
  if [ -e "$target" ]; then
    mv "$target" "$staging.failed" || exit 1
  fi
  if [ -e "$backup" ]; then
    mv "$backup" "$target"
  fi
  rm -rf "$staging" "$staging.failed" "$work_root"
  if [ -x "$target/$executable_relative" ]; then
    launch ""
  fi
  exit 1
}

while kill -0 "$parent_pid" 2>/dev/null; do
  sleep 0.2
done

log "starting direct update replacement"
rm -f "$confirmation"
if ! mv "$target" "$backup"; then
  log "could not preserve current application"
  exit 1
fi
if ! mv "$staging" "$target"; then
  log "could not commit staged application"
  mv "$backup" "$target"
  exit 1
fi
if ! /usr/bin/codesign --verify --deep --strict "$target" >> "$log_path" 2>&1; then
  rollback
fi
/usr/bin/xattr -dr com.apple.quarantine "$target" >> "$log_path" 2>&1 || rollback
launch "--agentenv-update-confirm=$confirmation"

attempt=0
while [ "$attempt" -lt 150 ]; do
  if [ -f "$confirmation" ]; then
    log "direct update confirmed"
    rm -rf "$backup" "$work_root"
    exit 0
  fi
  if ! kill -0 "$launched_pid" 2>/dev/null; then
    rollback
  fi
  attempt=$((attempt + 1))
  sleep 0.2
done
rollback
`;

export const createDirectUpdateAdapter = (options: {
  platform?: NodeJS.Platform;
  parentPid?: number;
  applicationPath?: string;
  cacheDirectory: string;
  fetch?: typeof globalThis.fetch;
  run?: typeof defaultRun;
  canWrite?: (path: string) => Promise<boolean>;
  verifyApplication?: (path: string, expectedVersion: string) => Promise<void>;
  scheduleReplacement?: (input: {
    applicationPath: string;
    candidatePath: string;
    expectedVersion: string;
    workRoot: string;
  }) => Promise<void>;
}): DirectUpdateAdapter => {
  const platform = options.platform ?? process.platform;
  const request = options.fetch ?? globalThis.fetch;
  const run = options.run ?? defaultRun;
  const canWrite = options.canWrite ?? (async (path: string) => {
    try {
      await access(path, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  });
  const verifyApplication = options.verifyApplication ?? (
    (path, version) => defaultVerifyApplication(path, version, run)
  );
  let prepared: PreparedDirectUpdate | undefined;

  const scheduleReplacement = options.scheduleReplacement ?? (async ({
    applicationPath,
    candidatePath,
    expectedVersion,
    workRoot
  }) => {
    const token = randomUUID();
    const stagingPath = `${applicationPath}.agentenv-update-stage-${token}`;
    const backupPath = `${applicationPath}.agentenv-update-previous-${token}`;
    const confirmationPath = join(workRoot, "startup-confirmed");
    const helperPath = join(workRoot, "install-update.sh");
    const logPath = join(options.cacheDirectory, "last-direct-update.log");
    try {
      await requireSuccessfulCommand(
        run,
        "/usr/bin/ditto",
        [candidatePath, stagingPath],
        5 * 60_000,
        "Could not stage the verified update"
      );
      await verifyApplication(stagingPath, expectedVersion);
      await writeFile(helperPath, UPDATE_HELPER, { encoding: "utf8", mode: 0o700 });
      await chmod(helperPath, 0o700);
      const child = spawn("/bin/sh", [
        helperPath,
        String(options.parentPid ?? process.pid),
        applicationPath,
        stagingPath,
        backupPath,
        confirmationPath,
        workRoot,
        logPath,
        EXECUTABLE_RELATIVE_PATH
      ], {
        detached: true,
        stdio: "ignore",
        env: process.env
      });
      child.unref();
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true });
      throw error;
    }
  });

  return {
    inspect: async () => {
      if (platform !== "darwin" || !options.applicationPath) {
        return { available: false, reason: "unsupported-platform" };
      }
      try {
        const metadata = await lstat(options.applicationPath);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          return { available: false, reason: "application-bundle-invalid" };
        }
      } catch {
        return { available: false, reason: "application-bundle-invalid" };
      }
      return await canWrite(dirname(options.applicationPath))
        ? { available: true }
        : { available: false, reason: "application-directory-not-writable" };
    },
    download: async (release) => {
      if (platform !== "darwin" || !options.applicationPath) {
        throw new Error("Direct application updates are unavailable on this platform");
      }
      if (!release.asset.name.endsWith(".zip")) {
        throw new Error("Direct macOS updates require the verified ZIP asset");
      }
      if (prepared) {
        await rm(prepared.root, { recursive: true, force: true });
        prepared = undefined;
      }
      const root = join(options.cacheDirectory, `${release.version}-${randomUUID()}`);
      const archivePath = join(root, release.asset.name);
      const extractionRoot = join(root, "extracted");
      await mkdir(extractionRoot, { recursive: true, mode: 0o700 });
      try {
        await downloadVerifiedAsset(release, archivePath, request);
        await requireSuccessfulCommand(
          run,
          "/usr/bin/ditto",
          ["-x", "-k", archivePath, extractionRoot],
          5 * 60_000,
          "Could not extract the verified update"
        );
        const applicationPath = join(extractionRoot, APP_NAME);
        await verifyApplication(applicationPath, release.version);
        prepared = { release, root, applicationPath };
      } catch (error) {
        await rm(root, { recursive: true, force: true });
        throw error;
      }
    },
    install: async (expectedVersion) => {
      if (!options.applicationPath || !prepared || prepared.release.version !== expectedVersion) {
        throw new Error("No verified direct update is ready to install");
      }
      const availability = await canWrite(dirname(options.applicationPath));
      if (!availability) {
        throw new Error("The application folder is no longer writable");
      }
      await verifyApplication(prepared.applicationPath, expectedVersion);
      await scheduleReplacement({
        applicationPath: options.applicationPath,
        candidatePath: prepared.applicationPath,
        expectedVersion,
        workRoot: prepared.root
      });
      prepared = undefined;
    }
  };
};

export const confirmDirectUpdateStartup = async (
  argv: string[],
  cacheDirectory: string
) => {
  const prefix = "--agentenv-update-confirm=";
  const value = argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) return false;
  const root = resolve(cacheDirectory);
  const confirmation = resolve(value);
  const pathWithinRoot = relative(root, confirmation);
  if (!pathWithinRoot || pathWithinRoot.startsWith("..") || isAbsolute(pathWithinRoot)) {
    throw new Error("Direct update confirmation path is outside the update cache");
  }
  await mkdir(dirname(confirmation), { recursive: true, mode: 0o700 });
  await writeFile(confirmation, "ready\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  return true;
};
