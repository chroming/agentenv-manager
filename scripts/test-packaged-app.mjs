import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { _electron as electron } from "playwright-core";

const execFileAsync = promisify(execFile);

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
const repositoryRemote = join(root, "repository.git");
const repositoryWork = join(root, "repository-work");
let application;

try {
  await mkdir(binDir, { recursive: true });
  await mkdir(opencodeDir, { recursive: true });
  await mkdir(repositoryRemote, { recursive: true });
  await mkdir(repositoryWork, { recursive: true });
  const opencodeExecutable = join(binDir, "opencode");
  await writeFile(opencodeExecutable, "#!/bin/sh\necho packaged-e2e-opencode\n", "utf8");
  await chmod(opencodeExecutable, 0o755);
  await writeFile(join(opencodeDir, "AGENTS.md"), "# Before packaged takeover\n", "utf8");
  await writeFile(join(opencodeDir, "opencode.jsonc"), "{}\n", "utf8");

  const runGit = (cwd, args) => execFileAsync("/usr/bin/git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  await runGit(repositoryRemote, ["init", "--bare", "--initial-branch=main"]);
  await runGit(repositoryWork, ["init", "--initial-branch=main"]);
  await runGit(repositoryWork, ["config", "user.name", "AgentEnv Packaged Test"]);
  await runGit(repositoryWork, ["config", "user.email", "agentenv@example.test"]);
  await runGit(repositoryWork, ["remote", "add", "origin", repositoryRemote]);
  const repositorySkill = join(repositoryWork, "skills", "packaged-review", "SKILL.md");
  await mkdir(dirname(repositorySkill), { recursive: true });
  await writeFile(
    repositorySkill,
    "---\nname: Packaged Repository Review\ndescription: Finder PATH repository smoke test.\n---\n# Review\n",
    "utf8"
  );
  await runGit(repositoryWork, ["add", "--all"]);
  await runGit(repositoryWork, ["commit", "-m", "add packaged repository skill"]);
  await runGit(repositoryWork, ["push", "origin", "HEAD:refs/heads/main"]);

  application = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      AGENTENV_AUTOMATION: "1",
      AGENTENV_TEST_CLOSE_GUARD: "1",
      AGENTENV_DATA_ROOT: appDataRoot,
      AGENTENV_CACHE_ROOT: join(root, "cache"),
      AGENTENV_FAKE_HOME: fakeHomeRoot,
      AGENTENV_HOME: homeDir,
      PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`
    }
  });
  const page = await application.firstWindow();
  await page.setViewportSize({ width: 1180, height: 728 });
  await page.getByRole("heading", { name: "Skills" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Import skills" }).click();
  const importDialog = page.getByRole("dialog", { name: "Import skills" });
  await importDialog.getByRole("tab", { name: "Repository" }).click();
  await importDialog.getByLabel("Repository address").fill(repositoryRemote);
  await importDialog.getByText("Advanced", { exact: true }).click();
  await importDialog.getByLabel("Repository directory").fill("skills/packaged-review");
  await importDialog.getByRole("button", { name: "Scan", exact: true }).click();
  await importDialog.getByRole("checkbox", { name: "Select Packaged Repository Review" })
    .waitFor({ state: "visible" });
  await importDialog.getByRole("button", { name: "Import 1" }).click();
  await importDialog.getByText("All 1 skills imported", { exact: true })
    .waitFor({ state: "visible" });
  await importDialog.getByRole("button", { name: "Close", exact: true }).click();
  assert.match(
    await readFile(
      join(appDataRoot, "skills-library", "packaged-repository-review", "SKILL.md"),
      "utf8"
    ),
    /Finder PATH repository smoke test/
  );
  await page
    .getByRole("complementary", { name: "Global navigation" })
    .getByRole("button", { name: "Profiles", exact: true })
    .click();
  await page.getByRole("button", { name: /OpenCode Daily Coding/ }).click();
  const applyButton = page.getByRole("button", { name: "Apply", exact: true });
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
  const windowHandle = await application.browserWindow(page);
  const closed = page.waitForEvent("close");
  await windowHandle.evaluate((browserWindow) => browserWindow.close());
  await closed;
  process.stdout.write("Packaged macOS profile and Repository workflows passed\n");
} finally {
  await application?.close();
  await rm(root, { recursive: true, force: true });
}
