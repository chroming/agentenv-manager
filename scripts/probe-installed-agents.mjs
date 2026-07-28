import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
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

const results = [];
for (const agent of agents) {
  const executablePath = await findExecutable(agent.commands);
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
      executablePath,
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
