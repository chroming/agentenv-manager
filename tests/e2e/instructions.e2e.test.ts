import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
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

const writeJson = (path: string, value: unknown) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

describe("Instruction Library desktop workflow", () => {
  it("creates reusable Blocks, composes them in a Profile, and restores them after restart", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-instructions-e2e-"));
    const home = join(root, "home");
    const dataRoot = join(root, "data");
    const bin = join(root, "bin");
    const profileDir = join(dataRoot, "profiles", "daily-coding");
    const baselineDir = join(dataRoot, "instructions-library", "baseline-rules");
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(bin, { recursive: true }),
      mkdir(profileDir, { recursive: true }),
      mkdir(baselineDir, { recursive: true })
    ]);
    await writeFile(join(dataRoot, "agentenv-data.json"), '{"formatVersion":2}\n');
    await writeJson(join(dataRoot, "settings.json"), {
      locale: "en",
      conversationTerminal: "default",
      skillSyncMethod: "copy",
      skillManagementFormatVersion: 1,
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null,
      telemetryEnabled: false,
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
    });
    await writeJson(join(profileDir, "profile.json"), {
      id: "daily-coding",
      name: "Daily Coding",
      description: "Daily development workflow",
      preferredTargetId: "opencode",
      createdFromTargetId: "opencode",
      version: 2
    });
    await writeFile(join(profileDir, "INSTRUCTIONS.md"), "# Profile\n\nKeep responses concise.\n");
    await writeJson(join(profileDir, "resources.json"), {
      skills: [],
      mcpByTarget: {}
    });
    await writeJson(join(baselineDir, "instruction.json"), {
      formatVersion: 1,
      id: "baseline-rules",
      name: "Baseline rules",
      description: "Shared engineering baseline",
      iconKey: "book",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z"
    });
    await writeFile(join(baselineDir, "CONTENT.md"), "# Baseline\n\nVerify each change.\n");
    const executable = join(bin, "opencode");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);

    const launch = async () => electron.launch({
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
    const openInstructions = async (page: Page) => {
      await page
        .getByRole("complementary", { name: "Global navigation" })
        .getByRole("button", { name: "Instructions", exact: true })
        .click();
      await page.getByRole("heading", { name: "Instructions", exact: true }).waitFor();
    };

    app = await launch();
    let page = await app.firstWindow();
    for (const viewport of [
      { width: 920, height: 620 },
      { width: 1180, height: 728 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await openInstructions(page);
      await expectNoHorizontalOverflow(page);
      await page.getByText("Baseline rules", { exact: true }).first().waitFor();
      const previewGeometry = await page.locator(".instructions-detail-pane > .instruction-documents")
        .evaluate((documents) => {
          const preview = documents.querySelector<HTMLElement>(".instruction-document__preview");
          const documentRect = documents.getBoundingClientRect();
          const previewRect = preview?.getBoundingClientRect();
          return {
            previewHeight: previewRect?.height ?? 0,
            bottomInset: previewRect ? documentRect.bottom - previewRect.bottom : Number.POSITIVE_INFINITY
          };
        });
      expect(previewGeometry.previewHeight).toBeGreaterThan(140);
      expect(previewGeometry.bottomInset).toBeLessThanOrEqual(20);
      if (process.env.AGENTENV_CAPTURE_INSTRUCTIONS_DIR) {
        await mkdir(process.env.AGENTENV_CAPTURE_INSTRUCTIONS_DIR, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.AGENTENV_CAPTURE_INSTRUCTIONS_DIR,
            `instructions-${viewport.width}x${viewport.height}.png`
          )
        });
      }
    }

    await page.getByRole("button", { name: "New Instruction", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "New Instruction Block" });
    await editor.getByRole("textbox", { name: "Name" }).fill("Review rules");
    await editor.getByRole("textbox", { name: "Description" }).fill("Reusable review workflow");
    await editor.getByRole("button", { name: "Change icon for Review rules" }).click();
    await page.getByRole("menuitemradio", { name: "Code", exact: true }).click();
    await editor.getByRole("textbox", { name: "Instruction content" })
      .fill("# Review\n\nExplain important findings first.\n");
    await editor.locator(".syntax-textarea-field__backdrop .syntax-code-preview")
      .waitFor({ state: "visible" });
    if (process.env.AGENTENV_CAPTURE_INSTRUCTIONS_DIR) {
      await page.screenshot({
        path: join(process.env.AGENTENV_CAPTURE_INSTRUCTIONS_DIR, "instruction-editor-920x620.png")
      });
    }
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    await page.getByText("Review rules", { exact: true }).first().waitFor();
    const baselineRow = page.getByRole("button", { name: "Baseline rules", exact: true });
    const reviewRow = page.getByRole("button", { name: "Review rules", exact: true });
    await baselineRow.click();
    expect(await Promise.all([
      baselineRow.locator(".ui-selectable-row__title").evaluate((title) => getComputedStyle(title).fontWeight),
      reviewRow.locator(".ui-selectable-row__title").evaluate((title) => getComputedStyle(title).fontWeight)
    ])).toEqual(["500", "400"]);
    const instructionIds = await readdir(join(dataRoot, "instructions-library"));
    const reviewInstructionId = instructionIds.find((id) => id.startsWith("review-rules-"));
    expect(reviewInstructionId).toBeTruthy();
    await expect(readFile(
      join(dataRoot, "instructions-library", reviewInstructionId!, "instruction.json"),
      "utf8"
    ).then(JSON.parse)).resolves.toMatchObject({ iconKey: "code" });

    await reviewRow.click({ button: "right" });
    const instructionMenu = page.getByRole("menu", { name: "Instruction actions" });
    await instructionMenu.getByRole("menuitem", { name: "Preview", exact: true }).click();
    const libraryPreview = page.getByRole("dialog", { name: "Instruction document" });
    await expect.poll(() => libraryPreview.getByLabel("Preview of CONTENT.md").textContent())
      .toContain("# Review");
    await expect.poll(() => libraryPreview.locator(".syntax-code-preview span[style]").count())
      .toBeGreaterThan(0);
    await libraryPreview.locator(".ui-dialog-footer")
      .getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Profiles", exact: true }).click();
    const composer = page.getByRole("region", { name: "Profile composer" });
    const instructions = composer.locator('[data-profile-composer-id="instructions"]');
    const disclosure = instructions.getByRole("button", { name: "Instructions", exact: true });
    if (await disclosure.getAttribute("aria-expanded") !== "true") await disclosure.click();
    await instructions.getByRole("button", { name: "Add", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Add Instruction Blocks" });
    await picker.getByRole("checkbox", { name: "Review rules" }).check();
    await picker.getByRole("checkbox", { name: "Baseline rules" }).check();
    await picker.getByRole("button", { name: "Add 2", exact: true }).click();
    await picker.waitFor({ state: "hidden" });
    await expect.poll(async () => {
      const resources = JSON.parse(await readFile(join(profileDir, "resources.json"), "utf8"));
      return resources.instructions?.length ?? 0;
    }).toBe(3);
    await expect(readFile(join(profileDir, "INSTRUCTIONS.md"), "utf8")).resolves.toBe("");
    await expectNoHorizontalOverflow(page);
    if (process.env.AGENTENV_CAPTURE_INSTRUCTIONS_DIR) {
      await page.screenshot({
        path: join(process.env.AGENTENV_CAPTURE_INSTRUCTIONS_DIR, "profile-instructions-920x620.png")
      });
    }

    await instructions.getByRole("button", { name: "Preview output", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Instruction document" });
    const previewText = await preview.getByLabel("Preview of AGENTS.md").textContent();
    expect(previewText).toContain("# Review");
    expect(previewText).toContain("# Baseline");
    expect(previewText).toContain("# Profile");
    await preview.getByRole("button", { name: "Close", exact: true }).first().click();

    await instructions.getByRole("button", { name: "Daily Coding instructions", exact: true }).click();
    const sharedEditor = page.getByRole("dialog", { name: "Edit Instruction Block" });
    await sharedEditor.getByText("Used by 1 Profile", { exact: true }).waitFor();
    await sharedEditor.getByText(/Daily Coding/).waitFor({ state: "visible" });
    await sharedEditor.getByRole("button", { name: "Cancel", exact: true }).click();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 920, height: 620 });
    await openInstructions(page);
    await page.getByText("Review rules", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Profiles", exact: true }).click();
    const restoredComposer = page.getByRole("region", { name: "Profile composer" });
    const restoredInstructions = restoredComposer.locator('[data-profile-composer-id="instructions"]');
    const restoredDisclosure = restoredInstructions.getByRole("button", {
      name: "Instructions",
      exact: true
    });
    if (await restoredDisclosure.getAttribute("aria-expanded") !== "true") {
      await restoredDisclosure.click();
    }
    await restoredInstructions.getByText("Review rules", { exact: true }).waitFor();
    await restoredInstructions.getByText("Baseline rules", { exact: true }).waitFor();

    await openInstructions(page);
    await page.getByRole("button", { name: "Review rules", exact: true }).click();
    await page.getByRole("button", { name: "More actions for Review rules" }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete Instruction Block" });
    await deleteDialog.getByText("Daily Coding", { exact: true }).waitFor();
    await deleteDialog.getByText("This Instruction will be removed from 1 Profile", {
      exact: true
    }).waitFor();
    if (process.env.AGENTENV_CAPTURE_INSTRUCTIONS_DIR) {
      await page.screenshot({
        path: join(
          process.env.AGENTENV_CAPTURE_INSTRUCTIONS_DIR,
          "instruction-referenced-delete-920x620.png"
        )
      });
    }
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await deleteDialog.waitFor({ state: "hidden" });
    await expect.poll(() => page.getByText("Review rules", { exact: true }).count()).toBe(0);
    await expect.poll(async () => {
      const resources = JSON.parse(await readFile(join(profileDir, "resources.json"), "utf8"));
      return resources.instructions?.some(
        (reference: { libraryId: string }) => reference.libraryId === reviewInstructionId
      );
    }).toBe(false);
    await expect.poll(async () => {
      const entries = await readdir(join(dataRoot, "trash", "instructions"));
      return entries.some((entry) => entry.startsWith(`${reviewInstructionId}-`));
    }).toBe(true);
  }, 30_000);
});
