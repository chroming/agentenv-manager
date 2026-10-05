import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";
import { translate } from "../../src/renderer/i18n";
import { expectCatalogToolbar } from "./catalogToolbarAssertions";
// @ts-expect-error Shared capture evidence is implemented as an executable JavaScript module.
import { readInterfaceTypography } from "../../scripts/interface-typography.mjs";

const run = promisify(execFile);
let root = "";
let app: ElectronApplication | undefined;
let server: Server | undefined;
requireCurrentElectronBuild();

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  server = undefined;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  root = "";
}, 30_000);

describe("Worktrees desktop workflow", () => {
  it.each(["en", "zh_CN", "zh_TW"] as const)("keeps discovery, aligned rows and review dialogs consistent in %s", async (locale) => {
    const t = (message: string) => translate(locale, message);
    root = await realpath(await mkdtemp(join(tmpdir(), "agentenv-worktrees-e2e-")));
    const home = join(root, "home");
    const data = join(root, "data");
    const bin = join(root, "bin");
    const repo = join(home, "Github", "project");
    const linked = join(home, ".codex", "worktrees", "review-change");
    await Promise.all([mkdir(home), mkdir(data), mkdir(bin)]);
    await run("git", ["init", repo]);
    await writeFile(join(repo, "README.md"), "base\n");
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "base"]);
    await run("git", ["-C", repo, "worktree", "add", "-b", "review-change", linked]);
    const dirty = join(home, ".codex", "worktrees", "long-name-with-uncommitted-work");
    const locked = join(home, ".codex", "worktrees", "locked-worktree");
    await run("git", ["-C", repo, "worktree", "add", "-b", "feature/a-long-branch-name-that-must-not-move-status", dirty]);
    await writeFile(join(dirty, "notes.txt"), "unsaved work\n");
    for (let index = 0; index < 20; index++) await writeFile(join(dirty, `experiment-${index}.txt`), "keep this experiment\n");
    await run("git", ["-C", repo, "worktree", "add", "-b", "locked", locked]);
    await run("git", ["-C", repo, "worktree", "lock", "--reason", "keep this test scene", locked]);
    const unique = join(home, ".codex", "worktrees", "needs-review");
    await run("git", ["-C", repo, "worktree", "add", "-b", "unfinished-task", unique]);
    await writeFile(join(unique, "README.md"), "committed work needing review\n");
    await run("git", ["-C", unique, "add", "."]);
    await run("git", ["-C", unique, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "Unfinished implementation"]);
    for (let index = 0; index < 8; index++) {
      await run("git", ["-C", repo, "worktree", "add", "-b", `task-${index}`, join(home, ".codex", "worktrees", `task-${index}`)]);
    }
    let calls = 0;
    server = createServer((request, response) => {
      calls++; request.resume(); response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        overview: "Keep the local experiments until their purpose is confirmed.",
        findings: [{ category: "risk", title: "Untracked experiments need review", detail: "Untracked files may contain work that is not in Git history.", suggestion: "Inspect or extract those files before cleanup.", evidence: ["state"] }],
        limitations: ["Untracked file contents are not available in this analysis."]
      }) } }] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await writeFile(join(data, "agentenv-data.json"), '{"formatVersion":2}\n');
    await writeFile(join(data, "worktree-locations.json"), `${JSON.stringify({ formatVersion: 1, scanRoots: [], kept: {} })}\n`);
    await writeFile(join(data, "settings.json"), `${JSON.stringify({
      locale, conversationTerminal: "default", skillSyncMethod: "copy",
      skillManagementFormatVersion: 1, skillStorageLocation: "appData",
      skillAutoCheckEnabled: false, skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null, telemetryEnabled: false, enabledTargetIds: ["opencode"],
      agentDiscoveryVersion: 1, agentDiscoveryReviewedIds: [
        "opencode", "codex", "claude-code", "antigravity", "trae-cli", "pi", "workbuddy"
      ]
    })}\n`);
    const executable = join(bin, "opencode");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);
    const launchOptions = {
      executablePath: electronPath as unknown as string,
      args: ["--disable-gpu", "--force-device-scale-factor=1", `--user-data-dir=${join(root, "electron")}`,
        join(process.cwd(), "out", "main", "main.js")],
      env: {
        ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: data,
        AGENTENV_LOG_ROOT: join(root, "logs"),
        AGENTENV_FAKE_HOME: join(root, "fake-home"), AGENTENV_HOME: home,
        AGENTENV_AUTOMATION_TARGET_PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`
      }
    };
    app = await electron.launch(launchOptions);
    const page = await app.firstWindow();
    await page.getByRole("button", { name: t("Worktrees"), exact: true }).waitFor();
    await page.evaluate((port) => window.agentEnv.saveSkillSummaryConfig({ endpoint: `http://127.0.0.1:${port}/v1`, model: "fixture" }), port);
    const notNow = page.getByRole("button", { name: t("Not now"), exact: true });
    if (await notNow.isVisible().catch(() => false)) await notNow.click();
    await page.getByRole("button", { name: t("Worktrees"), exact: true }).click();
    const workspace = page.locator(".worktree-workspace");
    await workspace.getByText(linked).waitFor();
    const scanLifecycle = await page.evaluate(async () => {
      const [superseded, current] = await Promise.all([
        window.agentEnv.inventoryWorktrees(), window.agentEnv.inventoryWorktrees()
      ]);
      const pending = window.agentEnv.inventoryWorktrees();
      await window.agentEnv.cancelWorktreeScan();
      const stopped = await pending;
      const refreshed = await window.agentEnv.inventoryWorktrees();
      await window.agentEnv.readLatestDiagnosticIssue();
      return {
        superseded, stopped,
        currentPaths: "cancelled" in current ? [] : current.entries.map((entry) => entry.path),
        refreshedPaths: "cancelled" in refreshed ? [] : refreshed.entries.map((entry) => entry.path)
      };
    });
    expect(scanLifecycle.superseded).toEqual({ cancelled: true });
    expect(scanLifecycle.stopped).toEqual({ cancelled: true });
    expect(scanLifecycle.currentPaths).toContain(linked);
    expect(scanLifecycle.refreshedPaths).toContain(linked);
    const runtimeEvents = (await readFile(join(root, "logs", "runtime.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    const scanEvents = runtimeEvents.filter((event) => event.action === "worktrees:inventory");
    expect(scanEvents.filter((event) => event.outcome === "cancelled")).toHaveLength(2);
    expect(scanEvents.some((event) => event.error)).toBe(false);
    for (const viewport of [{ width: 920, height: 620 }, { width: 1180, height: 728 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expectCatalogToolbar(workspace.locator(".ui-catalog-toolbar"), "wide");
      const geometry = await workspace.evaluate((element) => {
        const frame = element.getBoundingClientRect();
        const body = element.querySelector(".worktree-dialog__body")!;
        const rows = [...element.querySelectorAll<HTMLElement>(".worktree-dialog__entries > .ui-resource-row")];
        const lanes = ["metadata", "state", "actions"].map((lane) => rows.map((row) => row.querySelector(`.ui-resource-row__${lane}`)?.getBoundingClientRect().x).filter((x): x is number => x !== undefined));
        return {
          withinWindow: frame.left >= 0 && frame.right <= window.innerWidth &&
            frame.top >= 0 && frame.bottom <= window.innerHeight,
          bodyFits: body.clientWidth + 1 >= body.scrollWidth,
          aligned: lanes.every((xs) => Math.max(...xs) - Math.min(...xs) <= 1),
          stateFits: rows.every((row) => {
            const state = row.querySelector<HTMLElement>(".ui-interactive-status")!;
            const frame = row.getBoundingClientRect();
            const status = state.getBoundingClientRect();
            return state.scrollWidth <= state.clientWidth + 1 && Math.abs(frame.top + frame.height / 2 - status.top - status.height / 2) <= 1;
          }),
          groupActions: [...element.querySelectorAll<HTMLElement>(".worktree-dialog__group")].map((group) => {
            const action = group.querySelector(".worktree-dialog__group-header button")!.getBoundingClientRect();
            const checkbox = group.querySelector('input[type="checkbox"]')!.getBoundingClientRect();
            const title = group.querySelector(".worktree-dialog__group-title")!.getBoundingClientRect();
            return { rightDelta: action.right - checkbox.right, centerDelta: title.top + title.height / 2 - action.top - action.height / 2 };
          })
        };
      });
      expect(geometry.withinWindow).toBe(true);
      expect(geometry.bodyFits).toBe(true);
      expect(geometry.aligned).toBe(true);
      expect(geometry.stateFits).toBe(true);
      expect(geometry.groupActions).toEqual(geometry.groupActions.map(() => ({ rightDelta: 0, centerDelta: 0 })));
      const typography = await readInterfaceTypography(page);
      expect(typography.violations).toEqual([]);
      expect(typography.headings.length).toBeGreaterThan(0);
      const captureDir = process.env.AGENTENV_CAPTURE_WORKTREES_DIR;
      if (captureDir) {
        await mkdir(captureDir, { recursive: true });
        await page.screenshot({ path: join(captureDir, `worktrees-${locale}-${viewport.width}.png`) });
      }
      const sortTrigger = workspace.getByRole("button", { name: `${t("Sort Worktrees")}: ${t("Name")}`, exact: true });
      await sortTrigger.click();
      const sortMenu = page.getByRole("menu", { name: t("Sort Worktrees"), exact: true });
      expect(await sortMenu.getByRole("menuitemradio").count()).toBe(5);
      expect(await sortMenu.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 &&
          box.bottom <= window.innerHeight && element.scrollWidth <= element.clientWidth + 1;
      })).toBe(true);
      if (captureDir) {
        await page.screenshot({ path: join(captureDir, `worktrees-sort-${locale}-${viewport.width}.png`) });
      }
      await page.keyboard.press("Escape");
      expect(await sortMenu.count()).toBe(0);
      expect(await sortTrigger.evaluate((element) => element === document.activeElement)).toBe(true);
      await workspace.getByRole("button", { name: new RegExp(`^${t("Filters")}`) }).click();
      await page.getByRole("combobox", { name: t("Worktree filter") }).selectOption("kept");
      if (captureDir) await page.screenshot({ path: join(captureDir, `worktree-filters-${locale}-${viewport.width}.png`) });
      await page.getByRole("button", { name: t("Clear filters"), exact: true }).click();
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 920, height: 620 });
    expect(await workspace.locator(".worktree-workspace__body").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await workspace.getByRole("checkbox", { name: t("Select Worktree for review") }).first().check();
    const selectedPath = await workspace.locator(".ui-resource-row").filter({
      has: page.getByRole("checkbox", { name: t("Select Worktree for review"), checked: true })
    }).locator(".ui-resource-row__identity > span").textContent();
    await workspace.getByRole("button", { name: `${t("Sort Worktrees")}: ${t("Name")}`, exact: true }).click();
    await page.getByRole("menuitemradio", { name: t("Largest size"), exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(data, "ui-state.json"), "utf8")).worktreeSort).toBe("size-desc");
    const sortedPaths = await workspace.locator(".worktree-dialog__entries .ui-resource-row__identity > span").allTextContents();
    expect(sortedPaths[0]).toBe(repo);
    expect(sortedPaths[1]).toBe(dirty);
    const metrics = workspace.locator(".worktree-dialog__entries .ui-catalog-sort-metric");
    expect(await metrics.count()).toBe(sortedPaths.length);
    expect(await metrics.allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/\d.*B/)]));
    for (const width of [920, 1180, 1440]) {
      await page.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      expect(await metrics.evaluateAll((elements) => elements.every((element) => {
        const row = element.closest(".ui-resource-row")!.getBoundingClientRect();
        const metric = element.getBoundingClientRect();
        return element.scrollWidth <= element.clientWidth + 1 && Math.abs(row.y + row.height / 2 - metric.y - metric.height / 2) <= 1;
      }))).toBe(true);
      expect(await workspace.locator(".worktree-dialog__group-header .ui-catalog-sort-metric").count()).toBeGreaterThan(0);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
        await page.mouse.move(0, 0);
        await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
        await expect.poll(() => page.getByRole("tooltip").count()).toBe(0);
        await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-sizes-${locale}-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 920, height: 620 });
    expect(await workspace.locator(".ui-resource-row").filter({
      has: page.getByRole("checkbox", { name: t("Select Worktree for review"), checked: true })
    }).locator(".ui-resource-row__identity > span").textContent()).toBe(selectedPath);
    await expectCatalogToolbar(workspace.locator(".ui-catalog-toolbar"), "wide");
    await workspace.getByRole("checkbox", { name: t("Select Worktree for review") }).first().uncheck();
    const group = workspace.locator(".worktree-dialog__group").first();
    await group.getByRole("button", { name: t("Select all eligible Worktrees"), exact: true }).click();
    expect(await group.getByRole("checkbox", { checked: true }).count()).toBe(9);
    expect(await group.locator(".ui-resource-row").filter({ hasText: "locked-worktree" }).getByRole("checkbox").count()).toBe(0);
    expect(await group.locator(".ui-resource-row").filter({ hasText: "long-name-with-uncommitted-work" }).getByRole("checkbox").count()).toBe(0);
    expect(await group.locator(".ui-resource-row").filter({ hasText: "needs-review" }).getByRole("checkbox").count()).toBe(0);
    await workspace.getByRole("button", { name: `${t("Review selected")} (9)`, exact: true }).click();
    const batchDialog = page.getByRole("dialog");
    await batchDialog.getByText(t("Selected size"), { exact: true }).waitFor();
    expect(await batchDialog.locator(".ui-resource-row__state .ui-catalog-sort-metric").count()).toBe(9);
    await batchDialog.getByRole("button", { name: t("Cancel"), exact: true }).click();
    await group.getByRole("button", { name: t("Clear Worktree selection"), exact: true }).click();
    await workspace.getByRole("button", { name: t("Scan locations") }).click();
    const scope = page.getByRole("dialog", { name: t("Scan locations") });
    await scope.getByText(join(home, ".codex", "worktrees"), { exact: true }).waitFor();
    expect(await scope.locator(".worktree-dialog__body").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-locations-${locale}-920.png`) });
    }
    await page.keyboard.press("Escape");
    await workspace.getByRole("button", { name: "long-name-with-uncommitted-work", exact: true }).click();
    const dirtyDialog = page.getByRole("dialog");
    const analyze = dirtyDialog.getByRole("button", { name: t("Analyze retention"), exact: true });
    await analyze.waitFor();
    expect(calls).toBe(0);
    expect(await dirtyDialog.getByRole("checkbox").isChecked()).toBe(false);
    await analyze.click();
    await dirtyDialog.getByText("Keep the local experiments until their purpose is confirmed.", { exact: true }).waitFor();
    expect(calls).toBe(1);
    expect(await dirtyDialog.getByRole("checkbox").isChecked()).toBe(false);
    for (const [width, height] of [[920, 620], [1180, 728], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      const review = dirtyDialog.locator(".skill-summary-review");
      await review.scrollIntoViewIfNeeded();
      expect(await dirtyDialog.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= window.innerWidth && element.scrollWidth <= element.clientWidth + 1;
      })).toBe(true);
      expect(await review.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
        // Keep critical pixels stable without exposing temporary or developer paths.
        await page.evaluate((root) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) if (node.textContent?.includes(root)) {
            const text = node as Text;
            text.textContent = text.textContent!.split(root).join("/Users/demo/AgentEnv-Fixture");
          }
        }, root);
        await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-analysis-${locale}-${width}x${height}.png`), animations: "disabled" });
        await page.evaluate((root) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) if (node.textContent?.includes("/Users/demo/AgentEnv-Fixture")) {
            node.textContent = node.textContent!.split("/Users/demo/AgentEnv-Fixture").join(root);
          }
        }, root);
      }
    }
    await page.setViewportSize({ width: 920, height: 620 });
    const typography = await readInterfaceTypography(page);
    expect(typography.violations).toEqual([]);
    expect(typography.paths.length).toBeGreaterThan(0);
    expect(typography.paragraphs.some((item: { size: string }) => item.size === "13px")).toBe(true);
    expect(await dirtyDialog.locator(".ui-dialog-title").evaluate((element) => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, weight: style.fontWeight };
    })).toEqual({ size: "16px", weight: "600" });
    expect(await dirtyDialog.locator(".worktree-dialog__confirmation").evaluate((element) => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, weight: style.fontWeight };
    })).toEqual({ size: "13px", weight: "400" });
    expect(await dirtyDialog.locator(".worktree-dialog__body").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await dirtyDialog.getByRole("checkbox").scrollIntoViewIfNeeded();
    expect(await dirtyDialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-dirty-${locale}-920.png`) });
    }
    await page.keyboard.press("Escape");
    const linkedRow = workspace.locator(".ui-resource-row").filter({ hasText: "review-change" });
    await linkedRow.getByRole("button", { name: "review-change", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await page.setViewportSize({ width: 920, height: 620 });
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-detail-${locale}-920.png`) });
    }
    await dialog.getByRole("button", { name: t("Maximize window") }).click();
    expect(await dialog.evaluate((element) => element.classList.contains("ui-modal--maximized"))).toBe(true);
    expect(await dialog.evaluate((element) => element.getBoundingClientRect().width >= window.innerWidth - 48)).toBe(true);
    await dialog.getByRole("button", { name: t("Restore window size") }).click();
    await page.keyboard.press("Escape");
    expect(await dialog.count()).toBe(0);
    await linkedRow.getByRole("button", { name: "review-change", exact: true }).click();
    await dialog.getByRole("button", { name: t("Review cleanup") }).click();
    await dialog.getByRole("button", { name: t("Remove Worktree"), exact: true }).waitFor();
    expect(await dialog.locator(".ui-resource-row__state .ui-catalog-sort-metric").textContent()).toBe("5 B");
    await dialog.getByText(t("Estimated space freed"), { exact: true }).waitFor();
    for (const width of [920, 1180, 1440]) {
      await page.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      expect(await dialog.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const body = element.querySelector<HTMLElement>(".ui-dialog-body")!;
        return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight && body.scrollWidth <= body.clientWidth + 1;
      })).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-confirm-size-${locale}-${width}.png`) });
    }
    await page.setViewportSize({ width: 920, height: 620 });
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-confirm-${locale}-920.png`) });
    }
    await dialog.getByRole("button", { name: t("Remove Worktree"), exact: true }).click();
    await dialog.getByText(t("Removed"), { exact: true }).waitFor();
    expect(await dialog.locator(".ui-detail-list").textContent()).toContain(`${t("Estimated space freed")}5 B`);
    expect(await workspace.getByText(linked, { exact: true }).count()).toBe(0);
    for (const width of [920, 1180, 1440]) {
      await page.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      expect(await dialog.locator(".ui-dialog-body").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await dialog.locator(".ui-resource-row__metadata .ui-catalog-sort-metric").evaluateAll((elements) =>
        elements.length === 1 && elements.every((element) => element.getBoundingClientRect().width > 0 && element.scrollWidth <= element.clientWidth + 1)
      )).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-results-size-${locale}-${width}.png`) });
    }
    await page.setViewportSize({ width: 920, height: 620 });
    await dialog.getByRole("button", { name: t("Close"), exact: true }).last().click();
    await workspace.getByRole("button", { name: t("Worktree recovery") }).click();
    await dialog.getByText(t("Removed"), { exact: true }).waitFor();
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-recovery-${locale}-920.png`) });
    }
    await dialog.getByRole("button", { name: t("Restore"), exact: true }).click();
    await expect.poll(() => readFile(join(linked, "README.md"), "utf8")).toBe("base\n");
    expect(await readFile(join(dirty, "notes.txt"), "utf8")).toBe("unsaved work\n");

    // Reopen the actual desktop process to prove the preference is device-local and durable.
    await app.close();
    app = await electron.launch(launchOptions);
    const reopened = await app.firstWindow();
    await reopened.getByRole("button", { name: t("Worktrees"), exact: true }).click();
    await reopened.locator(".worktree-workspace").getByRole("button", {
      name: `${t("Sort Worktrees")}: ${t("Largest size")}`, exact: true
    }).waitFor();
    await reopened.locator(".worktree-workspace").getByText(dirty, { exact: true }).waitFor();
    await reopened.getByRole("button", { name: "long-name-with-uncommitted-work", exact: true }).click();
    await reopened.getByText("Keep the local experiments until their purpose is confirmed.", { exact: true }).waitFor();
    expect(calls).toBe(1);
  }, 90_000);
});
