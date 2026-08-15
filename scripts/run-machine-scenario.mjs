import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioId = process.argv[2]?.trim();
if (!scenarioId) {
  console.error("Usage: npm run test:scenario -- <scenario-id>");
  process.exit(1);
}

const catalog = JSON.parse(
  await readFile(join(root, "tests/fixtures/target-homes/compatibility.json"), "utf8")
);
if (!catalog.scenarios?.some((scenario) => scenario.id === scenarioId)) {
  console.error(`Unknown machine scenario: ${scenarioId}`);
  process.exit(1);
}

const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
const child = spawn(
  process.execPath,
  [vitest, "run", "tests/e2e/targetCompatibilityFixtures.e2e.test.ts"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, AGENTENV_MACHINE_SCENARIO: scenarioId }
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Machine scenario runner stopped by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
