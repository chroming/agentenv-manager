import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { assertCurrentBuild } from "./build-fingerprint.mjs";
import { computeVerificationSourceFingerprint } from "./verification-fingerprint.mjs";
import {
  electronE2eExcludeGlob,
  electronE2eTestFiles
} from "./vitest-groups.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const reportRoot = process.env.TMPDIR ?? "/tmp";
const parallelReportPath = join(reportRoot, "agentenv-product-vitest-parallel.json");
const electronReportPath = join(reportRoot, "agentenv-product-vitest-electron.json");
const captureRoot = join(process.env.TMPDIR ?? "/tmp", "agentenv-ui-captures", "verification");
const snapshotPath = join(projectRoot, "docs", "verification-snapshot.json");
const visualBaselineRoot = join(projectRoot, "tests", "visual", "golden");
const visualContractPath = join(
  projectRoot,
  "tests",
  "visual",
  "critical-captures.json"
);
const visualReportRoot = join(
  process.env.TMPDIR ?? "/tmp",
  "agentenv-ui-captures",
  "visual-report"
);
const includePackaged = process.argv.includes("--packaged");

const run = async (command, args, options = {}) => {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  try {
    const result = await execFileAsync(command, args, {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 40 * 1024 * 1024,
      ...options
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

await rm(parallelReportPath, { force: true });
await rm(electronReportPath, { force: true });
await rm(captureRoot, { recursive: true, force: true });
await run("npm", ["run", "build"]);
const testedBuild = await assertCurrentBuild(projectRoot);
await run("npx", [
  "vitest",
  "run",
  "--exclude",
  electronE2eExcludeGlob,
  "--reporter=json",
  `--outputFile=${parallelReportPath}`
]);
await run("npx", [
  "vitest",
  "run",
  ...electronE2eTestFiles,
  "--maxWorkers=1",
  "--no-file-parallelism",
  "--reporter=json",
  `--outputFile=${electronReportPath}`
]);
for (const script of ["audit:styles", "audit:modules", "audit:targets", "audit:translations"]) {
  await run("npm", ["run", script]);
}
if (includePackaged) {
  await run("npm", ["run", "test:e2e:packaged"]);
}
const finalBuild = await assertCurrentBuild(projectRoot);
if (
  finalBuild.source.sha256 !== testedBuild.source.sha256 ||
  finalBuild.artifact.sha256 !== testedBuild.artifact.sha256
) {
  throw new Error(
    "Electron build changed between automated tests and capture. Rebuild and rerun product verification."
  );
}
await run("node", ["scripts/capture-profiles.mjs", "--output", captureRoot]);
await rm(visualReportRoot, { recursive: true, force: true });
await run("swift", [
  "scripts/compare-ui-captures.swift",
  "--config",
  visualContractPath,
  "--baseline",
  visualBaselineRoot,
  "--current",
  captureRoot,
  "--output",
  visualReportRoot
]);

const testReports = await Promise.all(
  [parallelReportPath, electronReportPath].map(async (path) =>
    JSON.parse(await readFile(path, "utf8"))
  )
);
const captureManifest = JSON.parse(
  await readFile(join(captureRoot, "capture-manifest.json"), "utf8")
);
const visualReport = JSON.parse(
  await readFile(join(visualReportRoot, "visual-report.json"), "utf8")
);
if (
  captureManifest.build?.sourceFingerprint !== finalBuild.source.sha256 ||
  captureManifest.build?.artifactFingerprint !== finalBuild.artifact.sha256
) {
  throw new Error(
    "UI captures were produced from a different Electron build."
  );
}
const testFiles = testReports.flatMap((report) => report.testResults ?? []);
const e2eFiles = testFiles.filter((result) => result.name?.includes("/tests/e2e/"));
const electronUiFiles = e2eFiles.filter((result) => result.name?.includes("electronUi"));
const desktopElectronFiles = e2eFiles.filter((result) =>
  electronE2eTestFiles.some((file) => result.name?.endsWith(`/${file}`))
);
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
const sourceFingerprint = await computeVerificationSourceFingerprint(projectRoot);

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: {
    commit: head.trim(),
    dirty: worktree.trim().length > 0,
    fingerprint: sourceFingerprint.sha256,
    files: sourceFingerprint.files
  },
  build: {
    generatedAt: finalBuild.generatedAt,
    sourceFingerprint: finalBuild.source.sha256,
    sourceFiles: finalBuild.source.files,
    artifactFingerprint: finalBuild.artifact.sha256,
    artifactFiles: finalBuild.artifact.files
  },
  tests: {
    passed: testReports.every((report) => report.success === true),
    files: testFiles.length,
    assertions: testReports.reduce(
      (total, report) => total + (report.numTotalTests ?? 0),
      0
    ),
    e2eFiles: e2eFiles.length,
    e2eAssertions: countTests(e2eFiles),
    desktopElectronFiles: desktopElectronFiles.length,
    desktopElectronAssertions: countTests(desktopElectronFiles),
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
    artifactFingerprint: captureManifest.build.artifactFingerprint,
    files: captureManifest.files.length,
    viewports: captureManifest.viewports,
    includesProfileLoadingState: captureManifest.files.some(
      (file) => file.file === "profile-loading-920x620.png"
    ),
    visualContract: {
      passed: visualReport.passed === true,
      files: visualReport.captures.length,
      maxChangedPixelRatio: Math.max(
        ...visualReport.captures.map((capture) => capture.changedPixelRatio)
      )
    }
  },
  packagedSmoke: includePackaged ? "passed" : "not-run"
};

await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
process.stdout.write(`\nProduct verification snapshot written to ${snapshotPath}\n`);
