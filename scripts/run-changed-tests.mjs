import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { selectQuickVerification } from "./changed-test-selection.mjs";
import { electronE2eExcludeGlob } from "./vitest-groups.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const vitestEntry = resolve(projectRoot, "node_modules", "vitest", "vitest.mjs");
const base = process.env.AGENTENV_TEST_BASE ?? "HEAD";

const run = async (command, args) => {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  await new Promise((resolveRun, rejectRun) => {
    const child = execFile(command, args, {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 40 * 1024 * 1024
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(signal
        ? `${command} terminated with ${signal}`
        : `${command} exited with ${code ?? "unknown"}`));
    });
  });
};

const gitLines = async (args) => {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    maxBuffer: 40 * 1024 * 1024
  });
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
};

const changedFiles = [...new Set([
  ...await gitLines(["diff", "--name-only", "--diff-filter=ACMR", base]),
  ...await gitLines(["ls-files", "--others", "--exclude-standard"])
])].sort();
const selection = selectQuickVerification(changedFiles);
const existingRelatedFiles = [];
for (const file of [...selection.relatedFiles, ...selection.extraTests]) {
  try {
    await access(resolve(projectRoot, file));
    existingRelatedFiles.push(file);
  } catch {
    // Deleted files still affect type checking, but cannot be passed to Vitest related.
  }
}
const uniqueRelatedFiles = [...new Set(existingRelatedFiles)];

await run("npx", ["tsc", "--noEmit"]);
if (uniqueRelatedFiles.length > 0) {
  await run(process.execPath, [
    vitestEntry,
    "related",
    ...uniqueRelatedFiles,
    "--run",
    "--exclude",
    electronE2eExcludeGlob,
    "--maxWorkers=2",
    "--passWithNoTests"
  ]);
} else {
  process.stdout.write("\nNo related source or test files changed; skipping Vitest.\n");
}
for (const audit of selection.audits) {
  await run("npm", ["run", audit]);
}
process.stdout.write(
  `\nQuick verification passed for ${changedFiles.length} changed files; ` +
  "real Electron tests were intentionally deferred.\n"
);
