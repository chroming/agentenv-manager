import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { _electron as electron } from "playwright-core";

const execFileAsync = promisify(execFile);

const executablePath =
  process.platform === "darwin"
    ? join(
        process.cwd(),
        "release",
        process.arch === "arm64" ? "mac-arm64" : "mac",
        "AgentEnv Manager.app",
        "Contents",
        "MacOS",
        "AgentEnv Manager"
      )
    : process.platform === "win32"
      ? join(process.cwd(), "release", "win-unpacked", "AgentEnv Manager.exe")
      : join(process.cwd(), "release", "linux-unpacked", "agentenv-manager");
const root = await mkdtemp(join(tmpdir(), "agentenv-packaged-e2e-"));
const appDataRoot = join(root, "app-data");
const homeDir = join(root, "home");
const fakeHomeRoot = join(root, "fake-home");
const opencodeDir = join(homeDir, ".config", "opencode");
const repositoryRemote = join(root, "repository.git");
const repositoryWork = join(root, "repository-work");
const legacyOwnerSidecar = join(homeDir, ".claude", "skills", "as-ops.agentenv-owner.json");
const legacyTargetState = join(appDataRoot, "target-states", "claude-code.json");
const unsafeCleanupBackupId = "cleanup-1784603431398-4571ea80";
const unsafeCleanupBackupDir = join(
  appDataRoot,
  "backups",
  "skill-cleanup",
  unsafeCleanupBackupId
);
const unsafeCleanupBackupManifest = join(unsafeCleanupBackupDir, "manifest.json");
let application;
const commandExtension = process.platform === "win32" ? ".cmd" : "";
const commandPath = (name) =>
  join(homeDir, ".local", "bin", `${name}${commandExtension}`);
const forceKill = (child) => {
  if (process.platform === "win32") child.kill();
  else child.kill("SIGKILL");
};

const packagedTargets = [
  {
    id: "opencode",
    name: "OpenCode",
    executablePath: commandPath("opencode"),
    instructionsPath: join(homeDir, ".config", "opencode", "AGENTS.md"),
    skillsDir: join(homeDir, ".config", "opencode", "skills")
  },
  {
    id: "claude-code",
    name: "Claude Code",
    executablePath: commandPath("claude"),
    instructionsPath: join(homeDir, ".claude", "CLAUDE.md"),
    skillsDir: join(homeDir, ".claude", "skills")
  },
  {
    id: "codex",
    name: "Codex",
    executablePath: commandPath("codex"),
    instructionsPath: join(homeDir, ".codex", "AGENTS.md"),
    skillsDir: join(homeDir, ".codex", "skills")
  },
  {
    id: "antigravity",
    name: "Antigravity CLI",
    executablePath: commandPath("agy"),
    instructionsPath: join(homeDir, ".gemini", "GEMINI.md"),
    skillsDir: join(homeDir, ".gemini", "antigravity-cli", "skills")
  },
  {
    id: "trae-cli",
    name: "Trae CLI",
    executablePath: commandPath("traecli"),
    instructionsPath: join(homeDir, ".trae", "rules", "agentenv-manager.md"),
    skillsDir: join(homeDir, ".trae", "skills")
  },
  {
    id: "pi",
    name: "Pi",
    executablePath: commandPath("pi"),
    instructionsPath: join(homeDir, ".pi", "agent", "AGENTS.md"),
    skillsDir: join(homeDir, ".pi", "agent", "skills")
  }
];

const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writePackagedTargetProfile = async (target) => {
  const profileId = `packaged-${target.id}`;
  const profileDir = join(appDataRoot, "profiles", profileId);
  await mkdir(profileDir, { recursive: true });
  await writeJson(join(profileDir, "profile.json"), {
    id: profileId,
    name: `Packaged ${target.name}`,
    description: "Packaged Target contract Profile",
    preferredTargetId: target.id,
    createdFromTargetId: target.id,
    version: 2
  });
  await writeFile(
    join(profileDir, "INSTRUCTIONS.md"),
    `# Packaged ${target.name}\n\n- Keep changes scoped and reversible.\n`,
    "utf8"
  );
  await writeJson(join(profileDir, "resources.json"), {
    skills: [{
      libraryId: "packaged-contract-skill",
      targetName: "packaged-contract-skill",
      enabled: true
    }],
    managementByTarget: {
      [target.id]: {
        instructions: "manage",
        skills: "manage"
      }
    },
    mcpByTarget: {
      [target.id]: {
        mode: "ignore",
        selections: []
      }
    }
  });
  return profileId;
};

const launchPackagedApplication = () =>
  electron.launch({
    executablePath,
    args: [`--user-data-dir=${join(root, "electron-user-data")}`],
    env: {
      ...process.env,
      AGENTENV_AUTOMATION: "1",
      AGENTENV_TEST_CLOSE_GUARD: "1",
      AGENTENV_DATA_ROOT: appDataRoot,
      AGENTENV_CACHE_ROOT: join(root, "cache"),
      AGENTENV_FAKE_HOME: fakeHomeRoot,
      AGENTENV_HOME: homeDir,
      PATH: process.platform === "win32"
        ? [
            process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "",
            process.env.SystemRoot ?? ""
          ].filter(Boolean).join(";")
        : "/usr/bin:/bin:/usr/sbin:/sbin"
    }
  });

const closePackagedApplication = async (app, page) => {
  await page.evaluate(() => window.agentEnv.setWindowCloseGuard(false));
  const windowHandle = await app.browserWindow(page);
  const closed = page.waitForEvent("close", { timeout: 5_000 });
  await windowHandle.evaluate((browserWindow) => browserWindow.close());
  await closed;
  const childProcess = app.process();
  let timeout;
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          forceKill(childProcess);
          reject(new Error("Packaged application did not terminate within 5 seconds"));
        }, 5_000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

try {
  await mkdir(opencodeDir, { recursive: true });
  await mkdir(repositoryRemote, { recursive: true });
  await mkdir(repositoryWork, { recursive: true });
  for (const target of packagedTargets) {
    await mkdir(dirname(target.executablePath), { recursive: true });
    await writeFile(
      target.executablePath,
      process.platform === "win32"
        ? `@echo off\r\necho packaged-e2e-${target.id}\r\n`
        : `#!/bin/sh\necho packaged-e2e-${target.id}\n`,
      "utf8"
    );
    if (process.platform !== "win32") {
      await chmod(target.executablePath, 0o755);
    }
  }
  await writeFile(join(opencodeDir, "AGENTS.md"), "# Before packaged takeover\n", "utf8");
  await writeFile(join(opencodeDir, "opencode.jsonc"), "{}\n", "utf8");
  await mkdir(dirname(legacyOwnerSidecar), { recursive: true });
  await mkdir(dirname(legacyTargetState), { recursive: true });
  const legacyOwnerContent = "{\"owner\":\"agentenv-manager\"}\n";
  await writeFile(legacyOwnerSidecar, legacyOwnerContent, "utf8");
  await writeFile(legacyTargetState, `${JSON.stringify({
    formatVersion: 2,
    managedMcpNames: [],
    managedResources: [{
      kind: "skill",
      id: "as-ops.agentenv-owner.json",
      path: legacyOwnerSidecar,
      contentHash: "legacy"
    }],
    sharedSkillPreparations: []
  }, null, 2)}\n`, "utf8");
  const unsafeCleanupBackupPath = join(
    unsafeCleanupBackupDir,
    "locations",
    "0-outside-reviewer"
  );
  await mkdir(unsafeCleanupBackupPath, { recursive: true });
  await writeFile(join(unsafeCleanupBackupPath, "SKILL.md"), "# Unsafe backup fixture\n", "utf8");
  await writeFile(unsafeCleanupBackupManifest, `${JSON.stringify({
    id: unsafeCleanupBackupId,
    libraryId: "outside-reviewer",
    libraryCreated: false,
    createdAt: "2026-07-21T03:10:31.398Z",
    operation: "cleanup",
    entries: [{
      sourcePath: join(root, "outside", "outside-reviewer"),
      backupPath: unsafeCleanupBackupPath
    }]
  }, null, 2)}\n`, "utf8");
  const contractSkillDir = join(
    appDataRoot,
    "skills-library",
    "packaged-contract-skill"
  );
  await mkdir(contractSkillDir, { recursive: true });
  await writeFile(
    join(contractSkillDir, "SKILL.md"),
    "---\nname: packaged-contract-skill\ndescription: Packaged Target contract Skill.\n---\n# Packaged contract\n",
    "utf8"
  );
  await writeJson(join(contractSkillDir, ".agentenv-skill.json"), {
    sourceType: "local",
    updateCheckEnabled: false,
    updatedAt: "2026-07-28T00:00:00.000Z"
  });
  const packagedProfileIds = new Map();
  for (const target of packagedTargets) {
    packagedProfileIds.set(target.id, await writePackagedTargetProfile(target));
  }

  const gitLookup = await execFileAsync(
    process.platform === "win32" ? "where.exe" : "which",
    ["git"]
  );
  const gitExecutable = gitLookup.stdout.trim().split(/\r?\n/).find(Boolean);
  if (!gitExecutable) throw new Error("Packaged E2E requires system Git");
  const runGit = (cwd, args) => execFileAsync(gitExecutable, args, {
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

  application = await launchPackagedApplication();
  const page = await application.firstWindow();
  await page.setViewportSize({ width: 1180, height: 728 });
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("heading", { name: "Skills" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Agents", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByText("Action failed").count(), 0);
  assert.match(await readFile(unsafeCleanupBackupManifest, "utf8"), /outside-reviewer/);
  const migratedTargetState = JSON.parse(await readFile(legacyTargetState, "utf8"));
  assert.deepEqual(migratedTargetState.managedResources, []);
  assert.equal(await readFile(legacyOwnerSidecar, "utf8"), legacyOwnerContent);
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  for (const target of packagedTargets) {
    const agent = page.getByRole("article", { name: `Agent ${target.name}` });
    await agent.waitFor({ state: "visible" });
    assert.match((await agent.textContent()) ?? "", /Ready/);
  }
  await page.getByRole("button", { name: "Skills", exact: true }).click();
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
  for (const target of packagedTargets) {
    const profileId = packagedProfileIds.get(target.id);
    const outcome = await page.evaluate(
      async ({ profileId, targetId }) => {
        const preview = await window.agentEnv.previewApply(profileId, targetId);
        const blocking = preview.issues.filter((issue) => issue.severity === "blocking");
        if (blocking.length > 0) {
          return {
            ok: false,
            errors: blocking.map((issue) => issue.message)
          };
        }
        return window.agentEnv.applyProfile(profileId, preview.id);
      },
      { profileId, targetId: target.id }
    );
    assert.equal(
      outcome.ok,
      true,
      `${target.name} packaged Apply failed: ${outcome.errors?.join("; ")}`
    );
    assert.match(
      await readFile(target.instructionsPath, "utf8"),
      new RegExp(`Packaged ${target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
    assert.match(
      await readFile(join(target.skillsDir, "packaged-contract-skill", "SKILL.md"), "utf8"),
      /Packaged contract/
    );
  }
  const appliedStates = await page.evaluate(() => window.agentEnv.listTargetStates());
  assert.deepEqual(
    appliedStates.map((state) => state.targetId).sort(),
    packagedTargets.map((target) => target.id).sort()
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  );
  await closePackagedApplication(application, page);
  application = undefined;
  application = await launchPackagedApplication();
  const restartedPage = await application.firstWindow();
  await restartedPage.getByRole("heading", { name: "Skills" }).waitFor({ state: "visible" });
  const restartedStates = await restartedPage.evaluate(() =>
    window.agentEnv.listTargetStates()
  );
  assert.deepEqual(
    restartedStates.map((state) => [state.targetId, state.lifecycleStatus]).sort(),
    packagedTargets.map((target) => [target.id, "applied"]).sort()
  );
  await closePackagedApplication(application, restartedPage);
  application = undefined;
  process.stdout.write(
    `Packaged ${process.platform} six-Agent Apply, restart, and Repository workflows passed\n`
  );
} finally {
  if (application) {
    const process = application.process();
    await Promise.race([
      application.close(),
      new Promise((resolve) => {
        setTimeout(() => {
          forceKill(process);
          resolve();
        }, 5_000);
      })
    ]);
  }
  await rm(root, { recursive: true, force: true });
}
