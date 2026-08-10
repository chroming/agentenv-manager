import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectAlignedResourceRows,
  expectNoHorizontalOverflow,
  expectStableResourceDisclosureHeaders,
  readAlignedResourceRows,
  readResourceDisclosureHeaders
} from "./layoutAssertions";
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

describe("Workspaces desktop workflow", () => {
  it("persists a Workspace and restores edited bytes without deleting the folder", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-projects-e2e-"));
    const home = join(root, "home");
    const dataRoot = join(root, "data");
    const bin = join(root, "bin");
    const projectRoot = join(root, "workspace", "release-tools");
    const instructionsPath = join(projectRoot, "AGENTS.md");
    const librarySkill = join(dataRoot, "skills-library", "testing");
    const addedProjectSkill = join(projectRoot, ".agents", "skills", "testing");
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(dataRoot, { recursive: true }),
      mkdir(bin, { recursive: true }),
      mkdir(projectRoot, { recursive: true }),
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
    await page.getByRole("button", { name: "Workspaces", exact: true }).click();
    const agentSwitcher = page.getByRole("button", {
      name: "Current Agent OpenCode",
      exact: true
    });
    await expect.poll(() => agentSwitcher.locator(".project-agent-switcher__logo").count())
      .toBe(1);
    expect(await agentSwitcher.isDisabled()).toBe(true);
    expect(await page.getByRole("dialog", { name: "Current Agent OpenCode" }).count()).toBe(0);
    expect(await agentSwitcher.locator(".lucide-chevron-down").count()).toBe(0);
    for (const viewport of [
      { width: 920, height: 620 },
      { width: 1180, height: 728 }
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await page
        .locator(".project-agent-switcher .ui-object-switcher__trigger")
        .evaluate((trigger) => {
          const box = trigger.getBoundingClientRect();
          return {
            height: Math.round(box.height),
            textFits: trigger.scrollWidth <= trigger.clientWidth + 1,
            width: Math.round(box.width)
          };
        });
      expect(geometry).toEqual({ height: 32, textFits: true, width: 150 });
    }
    await page.setViewportSize({ width: 920, height: 620 });
    const workspaceResources = page.locator(".project-resource-groups");
    const collapsedResourceHeaders = await readResourceDisclosureHeaders(workspaceResources);
    await page.getByRole("button", { name: "Expand Instructions", exact: true }).click();
    expectStableResourceDisclosureHeaders(
      collapsedResourceHeaders,
      await readResourceDisclosureHeaders(workspaceResources),
      ["workspace-instructions"]
    );
    await page.getByRole("button", { name: "Add instruction", exact: true }).waitFor();
    await expectNoHorizontalOverflow(page);
    const inspectorTitle = page.locator(".project-detail__header").getByRole("heading", {
      name: "Release Tools",
      exact: true
    });
    await expect.poll(async () => {
      const box = await inspectorTitle.boundingBox();
      return Boolean(box && box.width >= 80 && box.height >= 18);
    }).toBe(true);
    const captureDir = process.env.AGENTENV_CAPTURE_PROJECTS_DIR;
    if (captureDir) {
      await mkdir(captureDir, { recursive: true });
      await page.screenshot({ path: join(captureDir, "project-empty-resources-920x620.png") });
    }

    await page.getByRole("button", { name: "Add instruction", exact: true }).click();
    const instructionDialog = page.getByRole("dialog", { name: "Workspace instruction" });
    await instructionDialog.waitFor({ state: "visible" });
    await instructionDialog.getByRole("button", { name: "Maximize preview" }).click();
    expect(await instructionDialog.getAttribute("class")).toContain("is-maximized");
    await instructionDialog.getByRole("button", { name: "Restore preview size" }).click();
    const editor = page.getByRole("textbox", { name: "Workspace instruction content" });
    if (captureDir) {
      await page.screenshot({ path: join(captureDir, "project-instruction-editor-920x620.png") });
    }
    const workspaceInstruction = `# Project rules\n${"unbroken-workspace-rule-".repeat(32)}\n`;
    await editor.fill(workspaceInstruction);
    expect(await editor.evaluate((element: HTMLTextAreaElement) => ({
      contained: element.scrollWidth <= element.clientWidth + 1,
      overflowX: getComputedStyle(element).overflowX,
      wrap: element.wrap
    }))).toEqual({ contained: true, overflowX: "hidden", wrap: "soft" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => readFile(instructionsPath, "utf8"))
      .toBe(workspaceInstruction);
    const instructionPreview = instructionDialog.getByLabel("Preview of AGENTS.md");
    await expect.poll(() => instructionPreview.textContent())
      .toContain("# Project rules");
    expect(await instructionPreview.evaluate((element: HTMLElement) => ({
      contained: element.scrollWidth <= element.clientWidth + 1,
      overflowX: getComputedStyle(element).overflowX
    }))).toEqual({ contained: true, overflowX: "hidden" });
    await instructionDialog.getByRole("button", { name: "Close", exact: true }).first().click();
    await instructionDialog.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Expand Skills", exact: true }).click();
    await expect.poll(() => page.getByRole("button", {
      name: "Collapse Instructions",
      exact: true
    }).getAttribute("aria-expanded")).toBe("true");
    expectStableResourceDisclosureHeaders(
      collapsedResourceHeaders,
      await readResourceDisclosureHeaders(workspaceResources),
      ["workspace-instructions", "workspace-skill"]
    );
    await page.getByRole("button", { name: "Copy from Library" }).click();
    await page.getByRole("dialog", { name: "Copy Skill to Workspace" }).waitFor();
    if (captureDir) {
      await page.screenshot({ path: join(captureDir, "project-add-skill-920x620.png") });
    }
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8"))
      .toContain("# Testing");
    const skillResourceList = page.locator(
      '[data-resource-disclosure-id="workspace-skill"] .project-resource-section__list'
    );
    await skillResourceList.locator(".project-resource-entry").waitFor();
    const skillResource = skillResourceList.locator(".project-resource-entry").first();
    expectAlignedResourceRows(
      await readAlignedResourceRows(page.locator(".project-resource-entry")),
      { minimumRows: 1 }
    );
    const resourceHierarchyGeometry = await skillResourceList.evaluate((list) => {
      const row = list.querySelector<HTMLElement>(".project-resource-entry")!;
      const listBox = list.getBoundingClientRect();
      const panel = list.closest<HTMLElement>(".ui-resource-disclosure__panel")!;
      const disclosure = panel.closest<HTMLElement>(".ui-resource-disclosure")!;
      const panelBox = panel.getBoundingClientRect();
      const disclosureBox = disclosure.getBoundingClientRect();
      const listGuide = getComputedStyle(list, "::before");
      const rowGuide = getComputedStyle(row, "::before");
      return {
        panelIsInset: panelBox.left >= disclosureBox.left + 12,
        panelContained: panelBox.right <= disclosureBox.right + 1,
        listHasNoConnector: listGuide.content === "none" || listGuide.display === "none",
        rowHasNoConnector: rowGuide.content === "none" || rowGuide.display === "none",
        listIsContained: listBox.right <= panelBox.right + 1
      };
    });
    expect(resourceHierarchyGeometry).toEqual({
      panelIsInset: true,
      panelContained: true,
      listHasNoConnector: true,
      rowHasNoConnector: true,
      listIsContained: true
    });
    await expect(readFile(join(addedProjectSkill, ".agentenv-skill.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });

    await page.getByRole("button", { name: "Copy from Library" }).click();
    const matchingDialog = page.getByRole("dialog", { name: "Copy Skill to Workspace" });
    await matchingDialog.getByText("Already in this Workspace", { exact: true }).waitFor();
    await expect.poll(() => matchingDialog.getByRole("button", {
      name: "Already added",
      exact: true
    }).isDisabled()).toBe(true);
    await matchingDialog.getByRole("button", { name: "Cancel", exact: true }).click();

    await writeFile(
      join(librarySkill, "SKILL.md"),
      "---\nname: testing\ndescription: Updated test changes.\n---\n\n# Updated Testing\n"
    );
    await page.getByRole("button", { name: "Copy from Library" }).click();
    const conflictDialog = page.getByRole("dialog", { name: "Copy Skill to Workspace" });
    await conflictDialog.getByText("A different Workspace copy already exists", {
      exact: true
    }).waitFor();
    await conflictDialog.getByRole("button", { name: "Keep Workspace copy", exact: true }).click();
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8"))
      .toContain("# Testing");

    await page.getByRole("button", { name: "Copy from Library" }).click();
    await page.getByRole("button", { name: "Replace with Library copy", exact: true }).click();
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8"))
      .toContain("# Updated Testing");

    if (captureDir) {
      await page.screenshot({ path: join(captureDir, "projects-selected-920x620.png") });
      await page.locator(".project-resource-groups").screenshot({
        animations: "disabled",
        path: join(captureDir, "workspaces-resources-region-920.png")
      });
      await page.setViewportSize({ width: 1180, height: 728 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: join(captureDir, "projects-selected-1180x728.png") });
      await page.setViewportSize({ width: 920, height: 620 });
      await page.getByRole("button", { name: "More Workspace actions" }).click();
      await page.getByRole("menuitem", { name: "Loaded resource details" }).click();
      await page.getByRole("dialog", { name: "Loaded resource details" }).waitFor();
      const closePreview = page.getByRole("button", { name: "Close", exact: true });
      await expect.poll(() => closePreview.isEnabled()).toBe(true);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: join(captureDir, "project-environment-preview-920x620.png") });
      await closePreview.click();
    }

    await page.getByRole("button", { name: "More Workspace actions" }).click();
    await page.getByRole("menuitem", { name: "Undo last change" }).click();
    const undoDialog = page.getByRole("dialog", { name: "Undo last Workspace change" });
    const undoButton = undoDialog.getByRole("button", { name: "Restore", exact: true });
    await undoButton.click();
    await undoDialog.waitFor({ state: "hidden" });
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8"))
      .toContain("# Testing");
    await expect.poll(() => page.evaluate((projectId) =>
      window.agentEnv.listProjectRecovery(projectId).then((items) =>
        items.some((item) => item.kind === "skill" && item.status === "restored")
      ), "project-release-tools")).toBe(true);
    const remainingReceipts = await page.evaluate((projectId) =>
      window.agentEnv.listProjectRecovery(projectId), "project-release-tools");
    const addedSkillReceipt = remainingReceipts.find(
      (item) => item.kind === "skill" && item.status === "committed"
    );
    const instructionReceipt = remainingReceipts.find(
      (item) => item.kind === "instructions" && item.status === "committed"
    );
    expect(addedSkillReceipt).toBeDefined();
    expect(instructionReceipt).toBeDefined();

    await page.getByRole("button", { name: "More Workspace actions" }).click();
    await page.getByRole("menuitem", { name: "Recovery" }).click();
    if (captureDir) {
      await page.screenshot({ path: join(captureDir, "project-recovery-920x620.png") });
    }
    await expect.poll(() => page.getByRole("dialog", { name: "Workspace Recovery" })
      .locator("button")
      .evaluateAll((buttons) => buttons.some((button) =>
        button.textContent === "Restore" && !(button as HTMLButtonElement).disabled
      ))).toBe(true);
    const recoveryDialog = page.getByRole("dialog", { name: "Workspace Recovery" });
    const skillRestoreButton = recoveryDialog
      .locator(`[data-recovery-id="${addedSkillReceipt!.id}"]`)
      .getByRole("button", { name: "Restore", exact: true });
    await skillRestoreButton.click({ force: true });
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8").then(
      () => true,
      () => false
    )).toBe(false);
    const instructionRestoreButton = recoveryDialog
      .locator(`[data-recovery-id="${instructionReceipt!.id}"]`)
      .getByRole("button", { name: "Restore", exact: true });
    await expect.poll(() => instructionRestoreButton.isEnabled()).toBe(true);
    await instructionRestoreButton.click({ force: true });
    await expect.poll(() => readFile(instructionsPath, "utf8").then(
      () => true,
      () => false
    )).toBe(false);
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Add instruction", exact: true }).click();
    await page.getByRole("textbox", { name: "Workspace instruction content" }).fill("# Project rules\n");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const recreatedInstructionDialog = page.getByRole("dialog", { name: "Workspace instruction" });
    await recreatedInstructionDialog.getByRole("button", { name: "Close", exact: true }).first().click();
    await recreatedInstructionDialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Copy from Library" }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8"))
      .toContain("# Updated Testing");

    await page.getByRole("button", { name: "Remove testing from Workspace" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8").then(
      () => true,
      () => false
    )).toBe(false);
    await page.getByRole("button", { name: "More Workspace actions" }).click();
    await page.getByRole("menuitem", { name: "Recovery" }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).first().click();
    await expect.poll(() => readFile(join(addedProjectSkill, "SKILL.md"), "utf8"))
      .toContain("# Updated Testing");
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "More Workspace actions" }).click();
    await page.getByRole("menuitem", { name: "Remove reference" }).click();
    await page.getByRole("button", { name: "Remove reference", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(dataRoot, "projects.json"), "utf8")).projects)
      .toEqual([]);
    await expect(readFile(instructionsPath, "utf8")).resolves.toBe("# Project rules\n");
    if (captureDir) {
      await page.screenshot({ path: join(captureDir, "projects-empty-920x620.png") });
    }
  }, 90_000);
});
