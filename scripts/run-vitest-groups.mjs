import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  electronE2eExcludeGlob,
  electronE2eTestFiles,
  exclusiveElectronE2eTestNames,
  heavyElectronE2eTestFile
} from "./vitest-groups.mjs";
import { runElectronTestSuite } from "./electron-test-scheduler.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const vitestEntry = resolve(projectRoot, "node_modules", "vitest", "vitest.mjs");
const e2eOnly = process.argv.includes("--e2e");
const argumentValue = (prefix) =>
  process.argv.find((argument) => argument.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
const parallelReport = argumentValue("--parallel-report");
const electronReport = argumentValue("--electron-report");

const run = (args) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [vitestEntry, "run", ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit"
  });
  child.once("error", rejectRun);
  child.once("exit", (code, signal) => {
    if (code === 0) {
      resolveRun();
      return;
    }
    rejectRun(new Error(
      signal
        ? `Vitest terminated with signal ${signal}`
        : `Vitest exited with code ${code ?? "unknown"}`
    ));
  });
});

await run([
  ...(e2eOnly ? ["tests/e2e"] : []),
  "--exclude",
  electronE2eExcludeGlob,
  "--maxWorkers=4",
  ...(parallelReport
    ? ["--reporter=json", `--outputFile=${parallelReport}`]
    : [])
]);
await runElectronTestSuite({
  exclusiveTestNames: exclusiveElectronE2eTestNames,
  heavyFile: heavyElectronE2eTestFile,
  outputFile: electronReport,
  projectRoot,
  testFiles: electronE2eTestFiles,
  vitestEntry
});
