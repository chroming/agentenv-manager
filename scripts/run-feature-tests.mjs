import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { featureTestGroups } from "./feature-test-groups.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const vitestEntry = resolve(projectRoot, "node_modules", "vitest", "vitest.mjs");
const featureName = process.argv[2];
if (!featureName || !(featureName in featureTestGroups)) {
  throw new Error(
    `Unknown feature ${featureName ?? "<missing>"}. Available: ` +
    Object.keys(featureTestGroups).join(", ")
  );
}
const feature = featureTestGroups[featureName];

const run = async (command, args) => {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  await new Promise((resolveRun, rejectRun) => {
    const child = execFile(command, args, { cwd: projectRoot, env: process.env });
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

await run("npx", ["tsc", "--noEmit"]);
await run(process.execPath, [vitestEntry, "run", ...feature.unit, "--maxWorkers=4"]);
if (feature.electron) {
  await run("npm", ["run", "build"]);
  await run(process.execPath, [
    vitestEntry,
    "run",
    feature.electron.file,
    "--testNamePattern",
    feature.electron.pattern,
    "--maxWorkers=1",
    "--no-file-parallelism"
  ]);
}
for (const audit of feature.audits ?? []) {
  await run("npm", ["run", audit]);
}
process.stdout.write(`\nFeature verification passed: ${featureName}\n`);
