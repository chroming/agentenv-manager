import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { assertCurrentBuild } from "./build-fingerprint.mjs";

const execFile = promisify(execFileCallback);
const projectRoot = resolve(import.meta.dirname, "..");
const argumentsList = process.argv.slice(2);
if (argumentsList.length !== 2 || argumentsList[0] !== "--output") {
  throw new Error("Usage: node scripts/capture-critical-comparison.mjs --output <directory>");
}
const outputDir = resolve(argumentsList[1]);
const capturedBuild = await assertCurrentBuild(projectRoot);

await execFile(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "vitest",
    "run",
    "tests/e2e/profileEvaluation.e2e.test.ts",
    "--testNamePattern=isolated Profile comparison desktop workflow",
    "--maxWorkers=1",
    "--no-file-parallelism"
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      AGENTENV_EVALUATION_CAPTURE_DIR: outputDir
    },
    maxBuffer: 30 * 1024 * 1024
  }
);

const files = [];
for (const entry of (await readdir(outputDir, { withFileTypes: true }))
  .sort((left, right) => left.name.localeCompare(right.name))) {
  if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
  const content = await readFile(join(outputDir, entry.name));
  files.push({
    file: entry.name,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex")
  });
}

await writeFile(join(outputDir, "capture-manifest.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  build: {
    sourceFingerprint: capturedBuild.source.sha256,
    artifactFingerprint: capturedBuild.artifact.sha256,
    generatedAt: capturedBuild.generatedAt
  },
  viewports: ["1180x728", "920x620"],
  files
}, null, 2)}\n`, "utf8");

process.stdout.write(`Captured critical Profile comparison states in ${outputDir}.\n`);
