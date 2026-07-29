import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  electronE2eExcludeGlob,
  electronE2eTestFiles
} from "./vitest-groups.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const e2eOnly = process.argv.includes("--e2e");

const run = (args) => new Promise((resolveRun, rejectRun) => {
  const child = spawn("npx", ["vitest", "run", ...args], {
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
  electronE2eExcludeGlob
]);
await run([
  ...electronE2eTestFiles,
  "--maxWorkers=1",
  "--no-file-parallelism"
]);

