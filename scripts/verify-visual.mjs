import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { assertCurrentBuild } from "./build-fingerprint.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const tempRoot = process.env.TMPDIR ?? "/tmp";
const captureRoot = join(tempRoot, "agentenv-ui-captures", "visual-verification");
const reportRoot = join(tempRoot, "agentenv-ui-captures", "visual-report");
const baselineRoot = join(projectRoot, "tests", "visual", "golden");
const contractPath = join(
  projectRoot,
  "tests",
  "visual",
  "critical-captures.json"
);

const run = async (command, args) => {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  try {
    const result = await execFileAsync(command, args, {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } catch (error) {
    if (error && typeof error === "object") {
      if ("stdout" in error && error.stdout) process.stdout.write(String(error.stdout));
      if ("stderr" in error && error.stderr) process.stderr.write(String(error.stderr));
    }
    throw error;
  }
};

await assertCurrentBuild(projectRoot);
await rm(captureRoot, { recursive: true, force: true });
await rm(reportRoot, { recursive: true, force: true });
await run("node", [
  "scripts/capture-profiles.mjs",
  "--output",
  captureRoot
]);
await run("node", [
  "scripts/capture-critical-comparison.mjs",
  "--output",
  captureRoot
]);
await run("swift", [
  "scripts/compare-ui-captures.swift",
  "--config",
  contractPath,
  "--baseline",
  baselineRoot,
  "--current",
  captureRoot,
  "--output",
  reportRoot
]);
