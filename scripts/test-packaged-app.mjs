import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { _electron as electron } from "playwright-core";

if (process.platform !== "darwin") {
  throw new Error("The packaged application E2E currently supports macOS only");
}

const packagedDirectory = process.arch === "arm64" ? "mac-arm64" : "mac";
const executablePath = join(
  process.cwd(),
  "release",
  packagedDirectory,
  "AgentEnv Manager.app",
  "Contents",
  "MacOS",
  "AgentEnv Manager"
);
const root = await mkdtemp(join(tmpdir(), "agentenv-packaged-e2e-"));
const appDataRoot = join(root, "app-data");
const homeDir = join(root, "home");
const fakeHomeRoot = join(root, "fake-home");
const binDir = join(root, "bin");
const opencodeDir = join(homeDir, ".config", "opencode");
let application;

try {
  await mkdir(binDir, { recursive: true });
  await mkdir(opencodeDir, { recursive: true });
  const opencodeExecutable = join(binDir, "opencode");
  await writeFile(opencodeExecutable, "#!/bin/sh\necho packaged-e2e-opencode\n", "utf8");
  await chmod(opencodeExecutable, 0o755);
  await writeFile(join(opencodeDir, "AGENTS.md"), "# Before packaged takeover\n", "utf8");
  await writeFile(join(opencodeDir, "opencode.jsonc"), "{}\n", "utf8");

  application = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      AGENTENV_AUTOMATION: "1",
      AGENTENV_DATA_ROOT: appDataRoot,
      AGENTENV_FAKE_HOME: fakeHomeRoot,
      AGENTENV_HOME: homeDir,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`
    }
  });
  const page = await application.firstWindow();
  await page.setViewportSize({ width: 1180, height: 728 });
  await page.getByRole("heading", { name: "Library/Skills" }).waitFor({ state: "visible" });
  await page
    .getByRole("complementary", { name: "Global navigation" })
    .getByRole("button", { name: "Profiles", exact: true })
    .click();
  await page.getByRole("button", { name: /OpenCode Daily Coding/ }).click();
  const applyButton = page
    .getByRole("button", { name: "Take over OpenCode" })
    .or(page.getByRole("button", { name: "Preview & apply to OpenCode" }))
    .first();
  await applyButton.click();
  const preview = page.getByRole("dialog", { name: "Preview" });
  await preview.getByRole("button", { name: "Apply profile" }).click();
  await preview.waitFor({ state: "hidden" });

  assert.match(
    await readFile(join(opencodeDir, "AGENTS.md"), "utf8"),
    /Keep changes scoped and reversible/
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  );
  process.stdout.write("Packaged macOS primary workflow passed\n");
} finally {
  await application?.close();
  await rm(root, { recursive: true, force: true });
}
