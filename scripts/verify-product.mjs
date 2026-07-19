import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const reportPath = join(process.env.TMPDIR ?? "/tmp", "agentenv-product-vitest.json");
const captureRoot = join(process.env.TMPDIR ?? "/tmp", "agentenv-ui-captures", "verification");
const snapshotPath = join(projectRoot, "docs", "verification-snapshot.json");
const includePackaged = process.argv.includes("--packaged");

const run = async (command, args, options = {}) => {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  const result = await execFileAsync(command, args, {
    cwd: projectRoot,
    env: process.env,
    maxBuffer: 40 * 1024 * 1024,
    ...options
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
};

await rm(reportPath, { force: true });
await rm(captureRoot, { recursive: true, force: true });
await run("npx", [
  "vitest",
  "run",
  "--reporter=json",
  `--outputFile=${reportPath}`
]);
for (const script of ["audit:styles", "audit:modules", "audit:targets", "audit:translations"]) {
  await run("npm", ["run", script]);
}
await run("npm", ["run", "build"]);
await run("node", ["scripts/capture-profiles.mjs", "--output", captureRoot]);
if (includePackaged) {
  await run("npm", ["run", "test:e2e:packaged"]);
}

const testReport = JSON.parse(await readFile(reportPath, "utf8"));
const captureManifest = JSON.parse(
  await readFile(join(captureRoot, "capture-manifest.json"), "utf8")
);
const testFiles = testReport.testResults ?? [];
const e2eFiles = testFiles.filter((result) => result.name?.includes("/tests/e2e/"));
const electronUiFiles = e2eFiles.filter((result) => result.name?.includes("electronUi"));
const countTests = (files) => files.reduce(
  (total, file) => total + (file.assertionResults?.length ?? 0),
  0
);
const { stdout: head } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: projectRoot
});
const { stdout: worktree } = await execFileAsync("git", ["status", "--porcelain"], {
  cwd: projectRoot
});

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: {
    commit: head.trim(),
    dirty: worktree.trim().length > 0
  },
  tests: {
    passed: testReport.success === true,
    files: testFiles.length,
    assertions: testReport.numTotalTests,
    e2eFiles: e2eFiles.length,
    e2eAssertions: countTests(e2eFiles),
    electronUiFiles: electronUiFiles.length,
    electronUiAssertions: countTests(electronUiFiles)
  },
  audits: {
    styles: "passed",
    modules: "passed",
    targets: "passed",
    translations: "passed"
  },
  captures: {
    directory: captureRoot,
    files: captureManifest.files.length,
    viewports: captureManifest.viewports,
    includesProfileLoadingState: captureManifest.files.some(
      (file) => file.file === "profile-loading-920x620.png"
    )
  },
  packagedSmoke: includePackaged ? "passed" : "not-run"
};

await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
process.stdout.write(`\nProduct verification snapshot written to ${snapshotPath}\n`);
