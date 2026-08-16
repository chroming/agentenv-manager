import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CODEX_BUNDLE_IDENTIFIER = "com.openai.codex";
const agents = [
  { id: "opencode", commands: ["opencode"] },
  { id: "claude-code", commands: ["claude"] },
  { id: "codex", commands: ["codex"] },
  { id: "antigravity", commands: ["agy"] },
  { id: "trae-cli", commands: ["traecli", "traex"] },
  { id: "pi", commands: ["pi"] }
];
const required = new Set(
  (process.env.AGENTENV_REQUIRE_REAL_AGENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const skippedCommandTargets = new Set(
  (process.env.AGENTENV_COMPAT_SKIP_COMMAND_TARGETS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const searchDirectories = [
  ...(process.env.PATH ?? "").split(delimiter),
  join(homedir(), ".local", "bin"),
  join(homedir(), ".bun", "bin"),
  join(homedir(), ".cargo", "bin"),
  join(homedir(), "Library", "pnpm"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin"
].filter(Boolean);

const findExecutable = async (commands) => {
  for (const command of commands) {
    for (const directory of searchDirectories) {
      const path = join(directory, command);
      try {
        await access(path);
        return path;
      } catch {
        // Continue through the deterministic Finder-style search path.
      }
    }
  }
  return undefined;
};

const readBundleIdentifier = async (applicationPath) => {
  try {
    const { stdout } = await execFileAsync("/usr/bin/plutil", [
      "-extract",
      "CFBundleIdentifier",
      "raw",
      "-o",
      "-",
      join(applicationPath, "Contents", "Info.plist")
    ], { timeout: 2_000, maxBuffer: 64 * 1024 });
    return stdout.trim();
  } catch {
    return undefined;
  }
};

const findCodexApplication = async () => {
  if (process.platform !== "darwin") return undefined;
  const direct = [
    join(homedir(), "Applications", "ChatGPT.app"),
    "/Applications/ChatGPT.app",
    join(homedir(), "Applications", "Codex.app"),
    "/Applications/Codex.app"
  ];
  let spotlight = [];
  try {
    const { stdout } = await execFileAsync("/usr/bin/mdfind", [
      `kMDItemCFBundleIdentifier == \"${CODEX_BUNDLE_IDENTIFIER}\"`
    ], { timeout: 2_000, maxBuffer: 256 * 1024 });
    spotlight = stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  } catch {
    // Conventional application locations remain authoritative when Spotlight is unavailable.
  }
  for (const applicationPath of [...new Set([...direct, ...spotlight])]) {
    try {
      await access(applicationPath, constants.F_OK);
    } catch {
      continue;
    }
    if (await readBundleIdentifier(applicationPath) === CODEX_BUNDLE_IDENTIFIER) {
      return applicationPath;
    }
  }
  return undefined;
};

const probeVersion = async (executablePath) => {
  try {
    await access(executablePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    const { stdout, stderr } = await execFileAsync(executablePath, ["--version"], {
      timeout: 5_000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, NO_COLOR: "1" }
    });
    return {
      status: "ready",
      version: `${stdout}${stderr}`.trim().split("\n")[0] || "unknown"
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

const results = [];
for (const agent of agents) {
  const executablePath = skippedCommandTargets.has(agent.id)
    ? undefined
    : await findExecutable(agent.commands);
  const runtimeSource = executablePath ? "path" : undefined;
  const desktopApplication = agent.id === "codex"
    ? await findCodexApplication()
    : undefined;
  if (!executablePath && desktopApplication) {
    const bundledRuntime = join(desktopApplication, "Contents", "Resources", "codex");
    const bundledProbe = await probeVersion(bundledRuntime);
    if (bundledProbe.status === "ready") {
      results.push({
        id: agent.id,
        status: "ready",
        installation: "desktop-app",
        desktopApplication,
        executablePath: bundledRuntime,
        runtimeSource: "bundled-runtime",
        version: bundledProbe.version
      });
      continue;
    }
    results.push({
      id: agent.id,
      status: "installed-no-runtime",
      installation: "desktop-app",
      desktopApplication,
      bundledRuntime,
      error: bundledProbe.error
    });
    continue;
  }
  if (!executablePath) {
    results.push({ id: agent.id, status: "missing" });
    continue;
  }
  try {
    const { stdout, stderr } = await execFileAsync(executablePath, ["--version"], {
      timeout: 5_000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, NO_COLOR: "1" }
    });
    results.push({
      id: agent.id,
      status: "ready",
      ...(desktopApplication ? { desktopApplication } : {}),
      executablePath,
      runtimeSource,
      version: `${stdout}${stderr}`.trim().split("\n")[0] || "unknown"
    });
  } catch (error) {
    results.push({
      id: agent.id,
      status: "error",
      executablePath,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

process.stdout.write(
  `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`
);
const failures = results.filter(
  (result) => required.has(result.id) && result.status !== "ready"
);
if (failures.length > 0) {
  process.stderr.write(
    `Required installed Agent probes failed: ${failures.map((result) => result.id).join(", ")}\n`
  );
  process.exitCode = 1;
}
