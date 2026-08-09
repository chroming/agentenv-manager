import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmDirectUpdateStartup,
  createDirectUpdateAdapter
} from "../../../src/main/appUpdates/directUpdateAdapter";

let root = "";
const run = promisify(execFile);

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const fixtureRelease = (content: Uint8Array) => ({
  version: "0.2.0",
  tag: "v0.2.0",
  releaseUrl: "https://github.com/chroming/agentenv-manager/releases/tag/v0.2.0",
  publishedAt: "2026-08-09T00:00:00Z",
  asset: {
    name: "AgentEnv-Manager-0.2.0-mac-arm64.zip",
    url: "https://github.com/chroming/agentenv-manager/releases/download/v0.2.0/AgentEnv-Manager-0.2.0-mac-arm64.zip",
    sha256: createHash("sha256").update(content).digest("hex"),
    size: content.byteLength
  }
});

describe("direct update adapter", () => {
  it("downloads the exact Release asset, verifies the app, and schedules in-place replacement", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-direct-update-"));
    const applicationPath = join(root, "Applications", "AgentEnv Manager.app");
    const cacheDirectory = join(root, "cache");
    await mkdir(applicationPath, { recursive: true });
    const content = new TextEncoder().encode("verified update archive");
    const verifyApplication = vi.fn().mockResolvedValue(undefined);
    const scheduleReplacement = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === "-x") {
        await mkdir(join(args[3]!, "AgentEnv Manager.app"), { recursive: true });
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const adapter = createDirectUpdateAdapter({
      platform: "darwin",
      applicationPath,
      cacheDirectory,
      fetch: vi.fn().mockResolvedValue(new Response(content)),
      canWrite: vi.fn().mockResolvedValue(true),
      run,
      verifyApplication,
      scheduleReplacement
    });

    await expect(adapter.inspect()).resolves.toEqual({ available: true });
    await expect(adapter.download(fixtureRelease(content))).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledWith(
      "/usr/bin/ditto",
      expect.arrayContaining(["-x", "-k"]),
      expect.any(Number)
    );
    expect(verifyApplication).toHaveBeenCalledWith(
      expect.stringMatching(/extracted\/AgentEnv Manager\.app$/),
      "0.2.0"
    );

    await expect(adapter.install("0.2.0")).resolves.toBeUndefined();
    expect(scheduleReplacement).toHaveBeenCalledWith(expect.objectContaining({
      applicationPath,
      expectedVersion: "0.2.0"
    }));
    await expect(adapter.install("0.2.0")).rejects.toThrow(
      "No verified direct update is ready"
    );
  });

  it("rejects a changed download and removes its preparation directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-direct-update-invalid-"));
    const applicationPath = join(root, "Applications", "AgentEnv Manager.app");
    const cacheDirectory = join(root, "cache");
    await mkdir(applicationPath, { recursive: true });
    const expected = new TextEncoder().encode("expected");
    const changed = new TextEncoder().encode("modified");
    const adapter = createDirectUpdateAdapter({
      platform: "darwin",
      applicationPath,
      cacheDirectory,
      fetch: vi.fn().mockResolvedValue(new Response(changed)),
      canWrite: vi.fn().mockResolvedValue(true),
      verifyApplication: vi.fn()
    });

    await expect(adapter.download(fixtureRelease(expected))).rejects.toThrow(
      /size|SHA-256/
    );
    await expect(readdir(cacheDirectory)).resolves.toEqual([]);
  });

  it("does not advertise installation for an invalid or unwritable app location", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-direct-update-location-"));
    const missingPath = join(root, "AgentEnv Manager.app");
    const invalid = createDirectUpdateAdapter({
      platform: "darwin",
      applicationPath: missingPath,
      cacheDirectory: join(root, "cache")
    });
    await expect(invalid.inspect()).resolves.toEqual({
      available: false,
      reason: "application-bundle-invalid"
    });

    await mkdir(missingPath);
    const unwritable = createDirectUpdateAdapter({
      platform: "darwin",
      applicationPath: missingPath,
      cacheDirectory: join(root, "cache"),
      canWrite: vi.fn().mockResolvedValue(false)
    });
    await expect(unwritable.inspect()).resolves.toEqual({
      available: false,
      reason: "application-directory-not-writable"
    });
  });

  it("accepts startup confirmation only inside the private update cache", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-direct-update-confirm-"));
    const cacheDirectory = join(root, "cache");
    const confirmationPath = join(cacheDirectory, "0.2.0-run", "startup-confirmed");

    await expect(confirmDirectUpdateStartup([
      `--agentenv-update-confirm=${confirmationPath}`
    ], cacheDirectory)).resolves.toBe(true);
    await expect(confirmDirectUpdateStartup([
      `--agentenv-update-confirm=${join(root, "outside", "startup-confirmed")}`
    ], cacheDirectory)).rejects.toThrow("outside the update cache");
    await expect(confirmDirectUpdateStartup([], cacheDirectory)).resolves.toBe(false);
  });

  it.skipIf(process.platform !== "darwin")(
    "replaces the app in place and retains the old bundle until startup is confirmed",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-direct-update-commit-"));
      const applicationPath = join(root, "Applications", "AgentEnv Manager.app");
      const candidatePath = join(root, "candidate", "AgentEnv Manager.app");
      const archivePath = join(root, "AgentEnv-Manager-0.2.0-mac-arm64.zip");
      const cacheDirectory = join(root, "cache");
      const currentExecutable = join(applicationPath, "Contents", "MacOS", "AgentEnv Manager");
      const candidateExecutable = join(candidatePath, "Contents", "MacOS", "AgentEnv Manager");
      const infoPlist = (version: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.github.chroming.agentenvmanager</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>AgentEnv Manager</string>
</dict></plist>\n`;
      await Promise.all([
        mkdir(join(applicationPath, "Contents", "MacOS"), { recursive: true }),
        mkdir(join(applicationPath, "Contents", "Resources"), { recursive: true }),
        mkdir(join(candidatePath, "Contents", "MacOS"), { recursive: true }),
        mkdir(join(candidatePath, "Contents", "Resources"), { recursive: true })
      ]);
      await Promise.all([
        writeFile(join(applicationPath, "Contents", "Info.plist"), infoPlist("0.1.0")),
        writeFile(join(applicationPath, "Contents", "Resources", "version.txt"), "old\n"),
        writeFile(currentExecutable, "#!/bin/sh\nexit 0\n"),
        writeFile(join(candidatePath, "Contents", "Info.plist"), infoPlist("0.2.0")),
        writeFile(join(candidatePath, "Contents", "Resources", "version.txt"), "new\n"),
        writeFile(candidateExecutable, `#!/bin/sh
case "$1" in
  --agentenv-update-confirm=*)
    confirmation="\${1#*=}"
    mkdir -p "$(dirname "$confirmation")"
    printf 'ready\\n' > "$confirmation"
    ;;
esac
sleep 1
`)
      ]);
      await Promise.all([
        chmod(currentExecutable, 0o755),
        chmod(candidateExecutable, 0o755)
      ]);
      await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", candidatePath]);
      await run("/usr/bin/ditto", [
        "-c", "-k", "--sequesterRsrc", "--keepParent", candidatePath, archivePath
      ]);
      const archive = await readFile(archivePath);
      const waiter = spawn("/bin/sleep", ["0.2"], { stdio: "ignore" });
      const adapter = createDirectUpdateAdapter({
        platform: "darwin",
        parentPid: waiter.pid,
        applicationPath,
        cacheDirectory,
        fetch: vi.fn().mockResolvedValue(new Response(archive))
      });

      await adapter.download(fixtureRelease(archive));
      await adapter.install("0.2.0");

      await vi.waitFor(async () => {
        await expect(readFile(
          join(applicationPath, "Contents", "Resources", "version.txt"),
          "utf8"
        ))
          .resolves.toBe("new\n");
        const siblings = await readdir(join(root, "Applications"));
        expect(siblings).toEqual(["AgentEnv Manager.app"]);
      }, { timeout: 10_000 });
    },
    20_000
  );

  it.skipIf(process.platform !== "darwin")(
    "restores the previous app when the replacement exits before startup confirmation",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-direct-update-rollback-"));
      const applicationPath = join(root, "Applications", "AgentEnv Manager.app");
      const candidatePath = join(root, "candidate", "AgentEnv Manager.app");
      const archivePath = join(root, "AgentEnv-Manager-0.2.0-mac-arm64.zip");
      const cacheDirectory = join(root, "cache");
      const currentExecutable = join(applicationPath, "Contents", "MacOS", "AgentEnv Manager");
      const candidateExecutable = join(candidatePath, "Contents", "MacOS", "AgentEnv Manager");
      const infoPlist = (version: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.github.chroming.agentenvmanager</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>AgentEnv Manager</string>
</dict></plist>\n`;
      await Promise.all([
        mkdir(join(applicationPath, "Contents", "MacOS"), { recursive: true }),
        mkdir(join(applicationPath, "Contents", "Resources"), { recursive: true }),
        mkdir(join(candidatePath, "Contents", "MacOS"), { recursive: true }),
        mkdir(join(candidatePath, "Contents", "Resources"), { recursive: true })
      ]);
      await Promise.all([
        writeFile(join(applicationPath, "Contents", "Info.plist"), infoPlist("0.1.0")),
        writeFile(join(applicationPath, "Contents", "Resources", "version.txt"), "old\n"),
        writeFile(currentExecutable, "#!/bin/sh\nexit 0\n"),
        writeFile(join(candidatePath, "Contents", "Info.plist"), infoPlist("0.2.0")),
        writeFile(join(candidatePath, "Contents", "Resources", "version.txt"), "new\n"),
        writeFile(candidateExecutable, "#!/bin/sh\nexit 1\n")
      ]);
      await Promise.all([
        chmod(currentExecutable, 0o755),
        chmod(candidateExecutable, 0o755)
      ]);
      await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", candidatePath]);
      await run("/usr/bin/ditto", [
        "-c", "-k", "--sequesterRsrc", "--keepParent", candidatePath, archivePath
      ]);
      const archive = await readFile(archivePath);
      const waiter = spawn("/bin/sleep", ["0.2"], { stdio: "ignore" });
      const adapter = createDirectUpdateAdapter({
        platform: "darwin",
        parentPid: waiter.pid,
        applicationPath,
        cacheDirectory,
        fetch: vi.fn().mockResolvedValue(new Response(archive))
      });

      await adapter.download(fixtureRelease(archive));
      await adapter.install("0.2.0");

      await vi.waitFor(async () => {
        await expect(readFile(join(cacheDirectory, "last-direct-update.log"), "utf8"))
          .resolves.toContain("rolling back direct update");
        await expect(readFile(
          join(applicationPath, "Contents", "Resources", "version.txt"),
          "utf8"
        )).resolves.toBe("old\n");
        expect(await readdir(join(root, "Applications"))).toEqual(["AgentEnv Manager.app"]);
      }, { timeout: 10_000 });
    },
    20_000
  );
});
