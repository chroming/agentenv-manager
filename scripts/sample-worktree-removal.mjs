#!/usr/bin/env node
// Opt-in macOS sampling only. Never launches, retries or changes a deletion.
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { arch, homedir, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const scrubSample = (value, home = homedir()) => String(value ?? "").replaceAll(home, "~")
  .replace(/^(?:Command line|Arguments|Environment):.*$/gim, "[omitted]").slice(0, 128 * 1024);
export const parseProcesses = (stdout, executableLines) => {
  const executables = new Map(executableLines.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    return match ? [[Number(match[1]), match[2]]] : [];
  }));
  return stdout.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3], executable: executables.get(Number(match[1])) }] : [];
  });
};
const processes = async () => {
  const executables = await exec("/bin/ps", ["-axo", "pid=,comm="], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 });
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,command="], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 });
  return parseProcesses(stdout, executables.stdout);
};
export const selectRemovalProcesses = (rows) => {
  const parents = new Set(rows.filter((row) => /\/AgentEnv Manager\.app\/Contents\/MacOS\/AgentEnv Manager$/.test(row.executable ?? "")).map((row) => row.pid));
  return rows.filter((row) => parents.has(row.parent) && row.command.includes("--type=utility") && row.command.includes("node.mojom.NodeService"));
};

const main = async () => {
  if (process.platform !== "darwin") throw new Error("This read-only sampler is for macOS installed applications.");
  console.log("In AgentEnv, retry one affected Trash item now. Waiting up to 30 seconds for an owned Node helper. No deletion is started by this script.");
  const samples = [], seen = new Set(), deadline = Date.now() + 30_000;
  while (Date.now() < deadline && samples.length < 3) {
    const workers = selectRemovalProcesses(await processes()).filter((row) => !seen.has(row.pid));
    for (const worker of workers.slice(0, 3 - samples.length)) {
      seen.add(worker.pid);
      if (!selectRemovalProcesses(await processes()).some((row) => row.pid === worker.pid && row.parent === worker.parent)) continue;
      try {
        const result = await exec("/usr/bin/sample", [String(worker.pid), "1", "10"], { timeout: 5000, maxBuffer: 512 * 1024 });
        samples.push({ pid: worker.pid, parentPid: worker.parent, stack: scrubSample(result.stdout), note: scrubSample(result.stderr) });
      } catch (error) {
        samples.push({ pid: worker.pid, parentPid: worker.parent, stack: scrubSample(error.stdout), error: scrubSample(error.stderr || error.message) });
      }
    }
    if (samples.length) break;
    await sleep(1000);
  }
  const directory = await mkdtemp(join(tmpdir(), "AgentEnv-Worktree-Sample-"));
  const destination = join(directory, "report.json");
  await writeFile(destination, JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), platform: "darwin", arch: arch(), osVersion: release(),
    note: "Candidate owned Node utility processes; they may include other AgentEnv helpers. No file contents, environment variables or unrelated process list were collected.", samples }, null, 2), { mode: 0o600 });
  console.log(samples.length ? `Report: ${destination}` : `No owned helper was captured. Report: ${destination}`);
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(scrubSample(error.message)); process.exitCode = 1; });
}
