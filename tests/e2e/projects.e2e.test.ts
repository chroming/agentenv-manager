import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoHorizontalOverflow } from "./layoutAssertions";
import { requireCurrentElectronBuild } from "./currentBuild";

let root = "";
let app: ElectronApplication | undefined;

requireCurrentElectronBuild();

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  root = "";
});

describe("Projects desktop workflow", () => {
  it("persists a Project and restores edited bytes without deleting the folder", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-projects-e2e-"));
    const home = join(root, "home");
    const dataRoot = join(root, "data");
    const bin = join(root, "bin");
    const projectRoot = join(root, "workspace", "release-tools");
    const instructionsPath = join(projectRoot, "AGENTS.md");
    const librarySkill = join(dataRoot, "skills-library", "testing");
    const addedProjectSkill = join(projectRoot, ".opencode", "skills", "testing");
    const existingProjectSkill = join(projectRoot, ".opencode", "skills", "review");
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(dataRoot, { recursive: true }),
      mkdir(bin, { recursive: true }),
      mkdir(existingProjectSkill, { recursive: true }),
      mkdir(librarySkill, { recursive: true })
    ]);
    await writeFile(join(dataRoot, "agentenv-data.json"), '{"formatVersion":2}\n');
    await writeFile(join(dataRoot, "settings.json"), `${JSON.stringify({
      locale: "en",
      conversationTerminal: "default",
      skillSyncMethod: "copy",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null,
      enabledTargetIds: ["opencode"],
      agentDiscoveryVersion: 1,
      agentDiscoveryReviewedIds: [
        "opencode",
        "codex",
        "claude-code",
        "antigravity",
        "trae-cli",
        "pi"
      ]
    })}\n`);
    await writeFile(join(dataRoot, "projects.json"), `${JSON.stringify({
      formatVersion: 1,
      projects: [{
        id: "project-release-tools",
        name: "Release Tools",
        rootPath: projectRoot,
        createdAt: "2026-08-06T00:00:00.000Z"
      }]
    })}\n`);
    await writeFile(instructionsPath, "# Original project rules\n");
    await writeFile(
      join(existingProjectSkill, "SKILL.md"),
      "---\nname: review\ndescription: Review changes.\n---\n\n# Review\n"
    );
    await writeFile(
      join(librarySkill, "SKILL.md"),
      "---\nname: testing\ndescription: Test changes.\n---\n\n# Testing\n"
    );
    await writeFile(join(librarySkill, ".agentenv-skill.json"), `${JSON.stringify({
      sourceType: "local",
      updateCheckEnabled: false,
      globallyEnabled: true,
      contentHash: "seed-testing",
      updatedAt: "2026-08-06T00:00:00.000Z"
    })}\n`);
    const executable = join(bin, "opencode");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);

    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [
        "--disable-gpu",
        "--force-device-scale-factor=1",
        `--user-data-dir=${join(root, "electron-user-data")}`,
        join(process.cwd(), "out", "main", "main.js")
      ],
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_DATA_ROOT: dataRoot,
        AGENTENV_FAKE_HOME: join(root, "fake-home"),
        AGENTENV_HOME: home,
        AGENTENV_AUTOMATION_TARGET_PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`
      }
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 920, height: 620 });
    const notNow = page.getByRole("button", { name: "Not now", exact: true });
    if (await notNow.isVisible().catch(() => false)) await notNow.click();
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "AGENTS.md", exact: true }).waitFor();
    await expectNoHorizontalOverflow(page);
    const captureDir = process.env.AGENTENV_CAPTURE_PROJECTS_DIR;
    if (captureDir) {
      await mkdir(captureDir, { recursive: true });
      await page.screenshot({ path: join(captureDir, "projects-selected-920x620.png") });
      await page.setViewportSize({ width: 1180, height: 728 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: join(captureDir, "projects-selected-1180x728.png") });
      await page.setViewportSize({ width: 920, height: 620 });
      await page.getByRole("button", { name: "Preview environment" }).click();
      await page.getByRole("dialog", { name: "Effective environment preview" }).waitFor();
      const closePreview = page.getByRole("button", { name: "Close", exact: true });
      await expect.poll(() => closePreview.isEnabled()).toBe(true);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: join(captureDir, "project-environment-preview-920x620.png") });
      await closePreview.click();
    }

    await page.getByRole("button", { name: "AGENTS.md", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Project instruction content" });
    await editor.fill("# Updated project rules\n");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => readFile(instructionsPath, "utf8"))
      .toBe("# Updated project rules\n");
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "More Project actions" }).click();
    await page.getByRole("menuitem", { name: "Recovery" }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect.poll(() => readFile(instructionsPath, "utf8"))
      .toBe("# Original project rules\n");
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Add from Library" }).click();
    await page.getByRole("dialog", { name: "Add Skill to Project" }).waitFor();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8"))
      .toContain("# Testing");
    await expect(readFile(join(addedProjectSkill, ".agentenv-skill.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });

    await page.getByRole("button", { name: "More Project actions" }).click();
    await page.getByRole("menuitem", { name: "Recovery" }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).first().click();
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8").then(
      () => true,
      () => false
    )).toBe(false);
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Remove review from Project" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => readFile(join(existingProjectSkill, "SKILL.md"), "utf8").then(
      () => true,
      () => false
    )).toBe(false);
    await page.getByRole("button", { name: "More Project actions" }).click();
    await page.getByRole("menuitem", { name: "Recovery" }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).first().click();
    await expect.poll(() => readFile(join(existingProjectSkill, "SKILL.md"), "utf8"))
      .toContain("# Review");
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "More Project actions" }).click();
    await page.getByRole("menuitem", { name: "Remove reference" }).click();
    await page.getByRole("button", { name: "Remove reference", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(dataRoot, "projects.json"), "utf8")).projects)
      .toEqual([]);
    await expect(readFile(instructionsPath, "utf8")).resolves.toBe("# Original project rules\n");
    if (captureDir) {
      await page.screenshot({ path: join(captureDir, "projects-empty-920x620.png") });
    }
  }, 30_000);
});
