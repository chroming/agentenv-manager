import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";
import { translate } from "../../src/renderer/i18n";
import { parseDiagnosticErrorMessage } from "../../src/renderer/diagnostics";
import { expectCatalogToolbar } from "./catalogToolbarAssertions";
import { createBackupStore } from "../../src/main/backupStore";
import { createPaths } from "../../src/main/paths";
// @ts-expect-error Shared capture evidence is implemented as an executable JavaScript module.
import { readInterfaceTypography } from "../../scripts/interface-typography.mjs";

const run = promisify(execFile);
let root = "";
let app: ElectronApplication | undefined;
let server: Server | undefined;
requireCurrentElectronBuild();

afterEach(async () => {
  const closing = app;
  const kill = setTimeout(() => closing?.process().kill("SIGKILL"), 5000);
  try { await closing?.close().catch(() => undefined); } finally { clearTimeout(kill); }
  app = undefined;
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  server = undefined;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  root = "";
}, 30_000);

describe("Worktrees desktop workflow", () => {
  it.each(["manual", "timeout"] as const)("handles %s for a paused tenth deletion in a fourteen-item queue and retries only its retained remainder", async (mode) => {
    root = await realpath(await mkdtemp(join(tmpdir(), "aem-stop-worktree-ui-")));
    const home = join(root, "home"), data = join(root, "data"), repo = join(home, "repo"), trees = join(root, "trees");
    await mkdir(home); await mkdir(data);
    await run("git", ["init", "-b", "main", repo]);
    await writeFile(join(repo, "README.md"), "Preserve the main repository\n");
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "base"]);
    for (let i = 1; i <= 14; i++) {
      const name = `task-${String(i).padStart(2, "0")}`, path = join(trees, name);
      await run("git", ["-C", repo, "worktree", "add", "-b", name, path]);
      await writeFile(join(path, "partial.txt"), "A synthetic first deletion\n");
      await writeFile(join(path, "keep.txt"), "Preserve after stopping\n");
    }
    await writeFile(join(data, "agentenv-data.json"), '{"formatVersion":2}');
    await writeFile(join(data, "settings.json"), JSON.stringify({ locale: "en", enabledTargetIds: [], agentDiscoveryVersion: 1,
      agentDiscoveryReviewedIds: ["opencode", "codex", "claude-code", "antigravity", "antigravity-app", "trae-cli", "pi", "workbuddy"],
      telemetryEnabled: false, telemetryConsentVersion: 1, skillAutoCheckEnabled: false, backupRetentionDays: null }));
    const hook = join(root, "hold-owned-cleanup.mjs");
    await writeFile(hook, `import { createRequire } from "node:module";
import { join } from "node:path";
const fs = createRequire(import.meta.url)("original-fs").promises;
process.on("SIGTERM", () => {});
process.parentPort.on("message", async ({ data }) => {
  const info = await fs.lstat(data.path, { bigint: true });
  if (String(info.dev) !== data.device || String(info.ino) !== data.inode || info.isSymbolicLink()) process.exit(1);
  process.parentPort.postMessage({ stage: "removing" });
  await fs.unlink(join(data.path, "partial.txt"));
  setInterval(() => {}, 1000);
});\n`);
    const packaged = process.env.AGENTENV_WORKTREE_PACKAGED_EXECUTABLE;
    app = await electron.launch({ executablePath: packaged ?? electronPath as unknown as string,
      args: ["--disable-gpu", `--user-data-dir=${join(root, "electron")}`, ...(packaged ? [] : [join(process.cwd(), "out", "main", "main.js")])],
      env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: data, AGENTENV_HOME: home,
        AGENTENV_FAKE_HOME: join(root, "fake"), AGENTENV_LOG_ROOT: join(root, "logs"), AGENTENV_CACHE_ROOT: join(root, "cache") } });
    const page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus())).toEqual({ state: "ready" });
    await page.evaluate(async (repo) => { await window.agentEnv.addWorktreeScanRoot(repo); await window.agentEnv.inventoryWorktrees(); }, repo);
    await app.evaluate((_electron, { hook, mode }) => {
      const utility = process.getBuiltinModule("module").createRequire(process.execPath)("electron").utilityProcess;
      const original = utility.fork.bind(utility);
      let started = 0;
      let accelerated = false;
      const originalTimeout = globalThis.setTimeout;
      globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
        if (mode === "timeout" && started === 10 && !accelerated && typeof args[1] === "number" && args[1] > 100_000 && args[1] <= 120_000) {
          args[1] = 2500; accelerated = true;
        }
        return originalTimeout(...args);
      }) as typeof setTimeout;
      utility.fork = (path: string, args: string[], options: Electron.ForkOptions) => {
        if (options?.serviceName === "AgentEnv Worktree cleanup") {
          ++started;
          Object.assign(globalThis, { aemCleanupStarts: started });
          if (started === 10) return original(hook, args, options);
        }
        return original(path, args, options);
      };
    }, { hook, mode });
    await page.setViewportSize({ width: 920, height: 620 });
    await page.getByRole("button", { name: "Worktrees", exact: true }).click();
    const workspace = page.locator(".worktree-workspace");
    await workspace.getByText(join(trees, "task-14"), { exact: true }).waitFor();
    await workspace.getByRole("button", { name: "Select Worktrees in this view", exact: true }).click();
    await page.getByRole("menuitem", { name: "Select all removable Worktrees", exact: true }).click();
    await workspace.getByRole("button", { name: "Delete permanently...", exact: true }).click();
    await page.getByRole("dialog", { name: "Permanently delete Worktrees?", exact: true })
      .getByRole("button", { name: "Permanently delete 14", exact: true }).click();
    const results = page.getByRole("dialog", { name: "Cleanup results", exact: true });
    await expect.poll(() => results.textContent(), { timeout: 10_000 }).toContain("9/14 · task-10");
    await expect.poll(async () => ({ text: await results.textContent() }), { timeout: 5000 }).toMatchObject({ text: expect.stringMatching(/9\/14 · task-10 · 0:0[1-9]/) });
    const stop = results.getByRole("button", { name: "Stop", exact: true });
    if (mode === "manual") for (const viewport of [{ width: 920, height: 620 }, { width: 1180, height: 728 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await stop.isVisible()).toBe(true);
      expect(await results.evaluate((element) => {
        const body = element.querySelector<HTMLElement>(".ui-dialog-body")!;
        return body.scrollWidth <= body.clientWidth + 1 && element.querySelector(".ui-dialog-footer")!.getBoundingClientRect().bottom <= innerHeight;
      })).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
        await mkdir(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-stoppable-${packaged ? "packaged" : "source"}-${viewport.width}.png`) });
      }
    }
    if (mode === "manual") await stop.click();
    await results.getByText(mode === "manual" ? "Stopped" : "Timed out", { exact: true }).waitFor({ timeout: 10_000 });
    await expect.poll(() => results.getByText("Deleted", { exact: true }).count()).toBe(mode === "manual" ? 9 : 13);
    expect(await results.getByText("Not run", { exact: true }).count()).toBe(mode === "manual" ? 4 : 0);
    expect(await results.getByRole("button", { name: "Close", exact: true }).last().isEnabled()).toBe(true);
    if (mode === "timeout") {
      expect(await results.getByRole("button", { name: "Copy details", exact: true }).count()).toBe(1);
      const message = await results.locator(".ui-diagnostic-message .selectable").first().textContent() ?? "";
      const { reference } = parseDiagnosticErrorMessage(message);
      expect(reference).toBeDefined();
      const issue = await page.evaluate((reference) => window.agentEnv.readDiagnosticIssue(reference!), reference);
      expect(issue?.events.some((event) => event.phase === "cleanup-timed-out" && event.outcome === "partial")).toBe(true);
      expect(issue?.context).toMatchObject({ removal: { stage: "removing", pid: expect.any(Number), exitConfirmed: true } });
    }
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) for (const width of [920, 1180, 1440]) {
      await page.setViewportSize({ width, height: width === 920 ? 620 : width === 1180 ? 728 : 900 });
      expect(await results.getByText(mode === "manual" ? "Deletion stopped. Deleted files cannot be restored; remaining contents stay in Worktree Trash." : "Some Worktrees timed out. Their remaining contents stay in Trash and can be retried.", { exact: true }).evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= 0 && bounds.bottom <= innerHeight;
      })).toBe(true);
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-${mode === "manual" ? "stopped" : "timed-out"}-${packaged ? "packaged" : "source"}-${width}.png`) });
    }
    await expect.poll(() => app!.evaluate(({ app }) => app.getAppMetrics().filter((item) => item.name === "AgentEnv Worktree cleanup").length)).toBe(0);
    const records = await page.evaluate(() => window.agentEnv.listWorktreeRecovery("trash"));
    expect(records.records).toEqual([expect.objectContaining({ path: join(trees, "task-10"), disposalIncomplete: true })]);
    const retained = records.records[0].retainedPath!;
    await expect(lstat(join(retained, "partial.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(retained, "keep.txt"), "utf8")).toBe("Preserve after stopping\n");
    expect((await readdir(trees)).sort()).toEqual(mode === "manual" ? ["task-11", "task-12", "task-13", "task-14"] : []);
    if (mode === "manual") for (let i = 11; i <= 14; i++) expect(await readFile(join(trees, `task-${i}`, "partial.txt"), "utf8")).toBe("A synthetic first deletion\n");
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("Preserve the main repository\n");
    const retry = await page.evaluate((id) => window.agentEnv.previewWorktreeTrashDeletion(id), records.records[0].id);
    await page.evaluate((preview) => window.agentEnv.removeWorktree(preview), retry);
    expect((await page.evaluate(() => window.agentEnv.listWorktreeRecovery("trash"))).records).toEqual([]);
    await expect(lstat(retained)).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);
  it.each(["runtime", "packaged", "partial-retry"] as const)("purges physical Electron archives from %s Trash and backups without ASAR virtual-directory retries", async (fixture) => {
    root = await realpath(await mkdtemp(join(tmpdir(), "aem-trash-asar-ui-")));
    const home = join(root, "home"), data = join(root, "data"), repo = join(home, "repo"), tree = join(root, "trees", "archive-task");
    await mkdir(home); await mkdir(data);
    await run("git", ["init", "-b", "main", repo]);
    await writeFile(join(repo, "README.md"), "Preserve the main repository\n");
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "base"]);
    await run("git", ["-C", repo, "worktree", "add", "-b", "archive-task", tree]);
    const commonDir = join(repo, ".git");
    const resources = process.platform === "darwin" ? join(dirname(electronPath as unknown as string), "..", "Resources") : join(dirname(electronPath as unknown as string), "resources");
    const archive = join(resources, "default_app.asar");
    const originalArchive = await readFile(archive);
    const bundle = fixture === "runtime"
      ? join(tree, "node_modules", "electron", "dist", "Electron.app", "Contents", "Resources")
      : join(tree, "apps", "example-app", "release", "mac-arm64", "Example \u5de5\u5177\uff08\u6d4b\u8bd5\uff09.app", "Contents", "Resources");
    await mkdir(bundle, { recursive: true });
    await copyFile(archive, join(bundle, fixture === "runtime" ? "default_app.asar" : "app.asar"));
    if (fixture !== "runtime") {
      await mkdir(join(bundle, "app.asar.unpacked", "native"), { recursive: true });
      await writeFile(join(bundle, "app.asar.unpacked", "native", "fixture.node"), "Synthetic unpacked content\n");
    }
    const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "keep.txt"), "Do not follow this link\n");
    if (process.platform !== "win32") await symlink(outside, join(tree, "outside-link"), "dir");
    await writeFile(join(data, "agentenv-data.json"), '{"formatVersion":2}');
    await writeFile(join(data, "settings.json"), JSON.stringify({ locale: "en", enabledTargetIds: [], agentDiscoveryVersion: 1,
      agentDiscoveryReviewedIds: ["opencode", "codex", "claude-code", "antigravity", "antigravity-app", "trae-cli", "pi", "workbuddy"],
      telemetryEnabled: false, telemetryConsentVersion: 1, skillAutoCheckEnabled: false, backupRetentionDays: null }));
    const backup = await createBackupStore(createPaths({ appDataRoot: data, homeDir: home })).createBackup([bundle]);
    const launchOptions = { executablePath: electronPath as unknown as string,
      args: ["--disable-gpu", `--user-data-dir=${join(root, "electron")}`, join(process.cwd(), "out", "main", "main.js")],
      env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: data, AGENTENV_HOME: home,
        AGENTENV_FAKE_HOME: join(root, "fake"), AGENTENV_LOG_ROOT: join(root, "logs"), AGENTENV_CACHE_ROOT: join(root, "cache") } };
    app = await electron.launch(launchOptions);
    let page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus())).toEqual({ state: "ready" });
    const moved = await page.evaluate(async ({ repo, commonDir, tree }) => {
      await window.agentEnv.addWorktreeScanRoot(repo);
      await window.agentEnv.inventoryWorktrees();
      return window.agentEnv.removeWorktree(await window.agentEnv.previewWorktreeCleanup(commonDir, tree, true, "trash"));
    }, { repo, commonDir, tree });
    await mkdir(tree); await writeFile(join(tree, "new.txt"), "A new original folder must survive\n");
    if (fixture === "partial-retry") {
      await app.close(); app = undefined;
      const journalPath = join(data, "worktree-trash", `${moved.id}.json`);
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      await rm(join(journal.storage, relative(tree, bundle), "app.asar.unpacked"), { recursive: true });
      await writeFile(journalPath, JSON.stringify({ ...journal, phase: "deleting", mode: "permanent" }));
      app = await electron.launch(launchOptions); page = await app.firstWindow();
      await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus())).toEqual({ state: "ready" });
      expect((await page.evaluate(() => window.agentEnv.listWorktreeRecovery("trash"))).records)
        .toEqual([expect.objectContaining({ id: moved.id, disposalIncomplete: true })]);
    }
    const preview = await page.evaluate((id) => window.agentEnv.previewWorktreeTrashDeletion(id), moved.id);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const removed = await Promise.race([page.evaluate((preview) => window.agentEnv.removeWorktree(preview), preview),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Physical archive purge stalled in Electron")), 3000); })]);
      expect(removed).toMatchObject({ mode: "permanent", status: "removed" });
      if (fixture === "partial-retry") {
        expect(removed.sourceSizeBytes).toBeUndefined();
        expect(removed.reclaimedSizeBytes).toBeUndefined();
      }
    } finally { clearTimeout(timeout); }
    expect(await readFile(join(tree, "new.txt"), "utf8")).toBe("A new original folder must survive\n");
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("Do not follow this link\n");
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("Preserve the main repository\n");
    expect((await page.evaluate(() => window.agentEnv.listWorktreeRecovery("trash"))).records).toEqual([]);
    const removedBackup = await page.evaluate((id) => window.agentEnv.deleteManagedBackup({ kind: "target-recovery", id }), backup.id);
    expect(removedBackup.deletedCount).toBe(1);
    await expect(lstat(join(data, "backups", backup.id))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(archive)).toEqual(originalArchive);
  }, 30_000);
  it.each(["en", "zh_CN", "zh_TW"] as const)("keeps discovery, aligned rows and review dialogs consistent in %s", async (locale) => {
    const t = (message: string, values?: Record<string, string | number>) => translate(locale, message, values);
    root = await realpath(await mkdtemp(join(tmpdir(), "agentenv-worktrees-e2e-")));
    const home = join(root, "home");
    const data = join(root, "data");
    const bin = join(root, "bin");
    const repo = join(home, "Github", "project");
    const linked = join(home, ".codex", "worktrees", "review-change");
    await Promise.all([mkdir(home), mkdir(data), mkdir(bin)]);
    await run("git", ["init", "-b", "main", repo]);
    await writeFile(join(repo, "README.md"), "base\n");
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "base"]);
    await run("git", ["-C", repo, "worktree", "add", "-b", "review-change", linked]);
    await utimes(join(linked, "README.md"), new Date("2024-04-12T10:30:00Z"), new Date("2024-04-12T10:30:00Z"));
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
    await page.setViewportSize({ width: 920, height: 620 });
    await page.getByRole("button", { name: t("Worktrees"), exact: true }).waitFor();
    await page.evaluate((port) => window.agentEnv.saveSkillSummaryConfig({ endpoint: `http://127.0.0.1:${port}/v1`, model: "fixture" }), port);
    const notNow = page.getByRole("button", { name: t("Not now"), exact: true });
    if (await notNow.isVisible().catch(() => false)) await notNow.click();
    await page.getByRole("button", { name: t("Worktrees"), exact: true }).click();
    const workspace = page.locator(".worktree-workspace");
    await workspace.getByText(linked).waitFor();
    const capturedSelectionScopes = new Set<"view" | "repository">();
    const selectWorktrees = async (scope: "view" | "repository", item: string) => {
      const label = t(scope === "view" ? "Select Worktrees in this view" : "Select Worktrees in this repository");
      await workspace.getByRole("button", { name: label, exact: true }).click();
      const menu = page.getByRole("menu", { name: label, exact: true });
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR && !capturedSelectionScopes.has(scope)) {
        await mkdir(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-selection-${scope}-${locale}-920.png`) });
        capturedSelectionScopes.add(scope);
      }
      const geometry = await menu.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          withinWindow: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
          menuFits: element.scrollWidth <= element.clientWidth + 1,
          labels: [...element.querySelectorAll<HTMLElement>('[role="menuitem"] > span')].map((label) => ({
            text: label.textContent, fits: label.scrollWidth <= label.clientWidth + 1,
            width: label.clientWidth, scrollWidth: label.scrollWidth
          }))
        };
      });
      expect(geometry.withinWindow, JSON.stringify(geometry)).toBe(true);
      expect(geometry.menuFits, JSON.stringify(geometry)).toBe(true);
      expect(geometry.labels.every((label) => label.fits), JSON.stringify(geometry)).toBe(true);
      await menu.getByRole("menuitem", { name: t(item), exact: true }).click();
    };
    expect(await workspace.getByRole("button", { name: `${t("Move to Trash...")} (1)`, exact: true }).count()).toBe(0);
    expect(await workspace.getByText(t("{{count}} selected", { count: 0 }), { exact: true }).count()).toBe(0);
    const initialChoice = workspace.locator(".ui-resource-row").filter({ has: page.getByText(linked, { exact: true }) }).getByRole("checkbox");
    expect(await initialChoice.isEnabled()).toBe(true);
    await initialChoice.check();
    await initialChoice.uncheck();
    await expect.poll(() => page.evaluate(async () => (await window.agentEnv.cachedWorktreeInventory()).inventory?.measuring)).toBe(false);
    await expect.poll(() => workspace.getByText(t("Measuring size..."), { exact: true }).count()).toBe(0);
    expect(await workspace.getByText(t("Main"), { exact: true }).count()).toBe(0);
    await workspace.getByRole("button", { name: t("Repository actions"), exact: true }).click();
    const repositoryMenu = page.getByRole("menu", { name: t("Repository actions"), exact: true });
    expect(await repositoryMenu.getByRole("menuitem").allTextContents()).toEqual([t("Ignore repository")]);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
      await mkdir(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-repository-menu-${locale}-920.png`) });
    }
    await page.keyboard.press("Escape");
    await selectWorktrees("repository", "Select all removable Worktrees");
    expect(await workspace.getByRole("button", { name: `${t("Move to Trash...")} (12)`, exact: true }).isEnabled()).toBe(true);
    expect(calls).toBe(0);
    await selectWorktrees("repository", "Clear Worktree selection");
    expect(await workspace.getByRole("checkbox", { name: t("Select Worktree for review"), checked: true }).count()).toBe(0);
    expect(await workspace.locator(".ui-resource-row").filter({ has: page.getByText(linked, { exact: true }) })
      .locator(".worktree-dialog__metrics").textContent()).toContain("2024");
    const beforeReopen = await page.evaluate(() => window.agentEnv.cachedWorktreeInventory());
    expect(beforeReopen.fresh).toBe(true);
    await page.getByRole("button", { name: t("Agents"), exact: true }).click();
    await page.getByRole("button", { name: t("Worktrees"), exact: true }).click();
    await workspace.getByText(linked).waitFor();
    expect(await page.evaluate(() => window.agentEnv.cachedWorktreeInventory())).toEqual(beforeReopen);
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
    expect(scanLifecycle.superseded).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ path: linked })]) });
    expect(scanLifecycle.stopped).toEqual({ cancelled: true });
    expect(scanLifecycle.currentPaths).toContain(linked);
    expect(scanLifecycle.refreshedPaths).toContain(linked);
    const runtimeEvents = (await readFile(join(root, "logs", "runtime.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    const scanEvents = runtimeEvents.filter((event) => event.action === "worktrees:inventory");
    expect(scanEvents.filter((event) => event.outcome === "cancelled")).toHaveLength(1);
    expect(scanEvents.some((event) => event.error)).toBe(false);
    await expect.poll(() => page.evaluate(async () => (await window.agentEnv.cachedWorktreeInventory()).inventory?.measuring)).toBe(false);
    await expect.poll(() => workspace.getByText(t("Measuring size..."), { exact: true }).count()).toBe(0);
    for (const viewport of [{ width: 920, height: 620 }, { width: 1180, height: 728 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expectCatalogToolbar(workspace.locator(".ui-catalog-toolbar"), "wide");
      const geometry = await workspace.evaluate((element, dateLabel) => {
        const frame = element.getBoundingClientRect();
        const body = element.querySelector(".worktree-dialog__body")!;
        const rows = [...element.querySelectorAll<HTMLElement>(".worktree-dialog__entries > .ui-resource-row")];
        const lanes = ["metadata", "state", "actions"].map((lane) => rows.map((row) => row.querySelector(`.ui-resource-row__${lane}`)?.getBoundingClientRect().x).filter((x): x is number => x !== undefined));
        return {
          withinWindow: frame.left >= 0 && frame.right <= window.innerWidth &&
            frame.top >= 0 && frame.bottom <= window.innerHeight,
          bodyFits: body.clientWidth + 1 >= body.scrollWidth,
          datesVisible: rows.filter((row) => row.querySelector(".ui-resource-row__metadata")).every((row) => [...row.querySelectorAll(".ui-catalog-sort-metric")]
            .some((metric) => metric.getAttribute("aria-label")?.startsWith(`${dateLabel}:`))),
          selectionClearance: [...body.querySelectorAll('input[type="checkbox"]')].every((input) =>
            input.getBoundingClientRect().right <= body.getBoundingClientRect().right - 16),
          rowActionCenters: rows.flatMap((row) => [...row.querySelectorAll<HTMLElement>(".ui-resource-row__actions input")])
            .map((action) => { const bounds = action.getBoundingClientRect(); return bounds.left + bounds.width / 2; }),
          aligned: lanes.every((xs) => Math.max(...xs) - Math.min(...xs) <= 1),
          stateFits: rows.every((row) => {
            const state = row.querySelector<HTMLElement>(".ui-interactive-status")!;
            const frame = row.getBoundingClientRect();
            const status = state.getBoundingClientRect();
            return state.scrollWidth <= state.clientWidth + 1 && Math.abs(frame.top + frame.height / 2 - status.top - status.height / 2) <= 1;
          }),
          stateLabelsFit: rows.every((row) => {
            const label = row.querySelector<HTMLElement>(".ui-interactive-status__label")!;
            return label.scrollWidth <= label.clientWidth + 1;
          }),
          groupActions: [...element.querySelectorAll<HTMLElement>(".worktree-dialog__group")].map((group) => {
            const actions = group.querySelector(".ui-resource-disclosure__actions")!.getBoundingClientRect();
            const title = group.querySelector(".ui-resource-disclosure__trigger")!.getBoundingClientRect();
            const bounds = group.getBoundingClientRect();
            return { fits: actions.right <= bounds.right && title.right <= actions.left + 1,
              centered: Math.abs(title.top + title.height / 2 - actions.top - actions.height / 2) <= 1 };
          })
        };
      }, t("Last modified"));
      expect(geometry.withinWindow).toBe(true);
      expect(geometry.bodyFits).toBe(true);
      expect(geometry.datesVisible).toBe(true);
      expect(geometry.selectionClearance).toBe(true);
      expect(Math.max(...geometry.rowActionCenters) - Math.min(...geometry.rowActionCenters)).toBeLessThanOrEqual(1);
      expect(geometry.aligned).toBe(true);
      expect(geometry.stateFits).toBe(true);
      expect(geometry.stateLabelsFit).toBe(true);
      expect(geometry.groupActions).toEqual(geometry.groupActions.map(() => ({ fits: true, centered: true })));
      const typography = await readInterfaceTypography(page);
      expect(typography.violations).toEqual([]);
      const headings = workspace.locator(".ui-resource-disclosure__title");
      expect(await headings.count()).toBeGreaterThan(0);
      expect(await headings.evaluateAll((elements) => {
        const tokens = getComputedStyle(document.documentElement);
        return elements.every((element) => {
          const style = getComputedStyle(element);
          return style.fontSize === tokens.getPropertyValue("--font-size-body").trim() &&
            style.fontWeight === tokens.getPropertyValue("--font-weight-medium").trim();
        });
      })).toBe(true);
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
      const filterSelect = page.getByRole("combobox", { name: t("Worktree filter") });
      await filterSelect.selectOption("candidate");
      expect(await workspace.getByRole("checkbox", { name: t("Select Worktree for review") }).count()).toBe(9);
      expect(await workspace.getByText(dirty, { exact: true }).count()).toBe(0);
      expect(await workspace.getByText(unique, { exact: true }).count()).toBe(0);
      if (captureDir) await page.screenshot({ path: join(captureDir, `worktree-eligible-${locale}-${viewport.width}.png`) });
      await filterSelect.selectOption("review");
      expect(await workspace.getByRole("checkbox", { name: t("Select Worktree for review") }).count()).toBe(2);
      expect(await workspace.getByText(dirty, { exact: true }).count()).toBe(1);
      expect(await workspace.getByText(unique, { exact: true }).count()).toBe(1);
      await filterSelect.selectOption("kept");
      if (captureDir) await page.screenshot({ path: join(captureDir, `worktree-filters-${locale}-${viewport.width}.png`) });
      await page.getByRole("button", { name: t("Clear filters"), exact: true }).click();
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 920, height: 620 });
    expect(await workspace.locator(".worktree-workspace__body").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    const lastChoice = workspace.getByRole("checkbox", { name: t("Select Worktree for review") }).last();
    await lastChoice.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 100);
    expect(await lastChoice.evaluate((input) => {
      const bounds = input.getBoundingClientRect();
      return document.elementFromPoint(bounds.right - 2, bounds.top + bounds.height / 2) === input;
    })).toBe(true);
    await lastChoice.check();
    expect(await lastChoice.isChecked()).toBe(true);
    await lastChoice.uncheck();
    await workspace.getByRole("checkbox", { name: t("Select Worktree for review") }).first().check();
    const selectedPath = await workspace.locator(".ui-resource-row").filter({
      has: page.getByRole("checkbox", { name: t("Select Worktree for review"), checked: true })
    }).locator(".worktree-dialog__identity > .selectable").textContent();
    await workspace.getByRole("button", { name: `${t("Sort Worktrees")}: ${t("Name")}`, exact: true }).click();
    await page.getByRole("menuitemradio", { name: t("Largest size"), exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(data, "ui-state.json"), "utf8")).worktreeSort).toBe("size-desc");
    const sortedPaths = await workspace.locator(".worktree-dialog__entries .worktree-dialog__identity > .selectable").allTextContents();
    expect(sortedPaths).not.toContain(repo);
    expect(sortedPaths[0]).toBe(dirty);
    const metrics = workspace.locator(`.worktree-dialog__entries .ui-catalog-sort-metric[aria-label^="${t("Size")}:"]`);
    expect(await metrics.count()).toBe(sortedPaths.length);
    expect(await metrics.allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/\d.*B/)]));
    for (const width of [920, 1180, 1440]) {
      await page.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      expect(await metrics.evaluateAll((elements) => elements.every((element) => {
        const row = element.closest(".ui-resource-row")!.getBoundingClientRect();
        const metric = element.getBoundingClientRect();
        const metadata = element.closest(".ui-resource-row__metadata")!.getBoundingClientRect();
        return element.scrollWidth <= element.clientWidth + 1 && metric.top >= row.top && metric.bottom <= row.bottom &&
          Math.abs(row.y + row.height / 2 - metadata.y - metadata.height / 2) <= 1;
      }))).toBe(true);
      expect(await workspace.locator(".worktree-dialog__group .ui-resource-disclosure__actions .ui-catalog-sort-metric").count()).toBeGreaterThan(0);
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
    }).locator(".worktree-dialog__identity > .selectable").textContent()).toBe(selectedPath);
    await expectCatalogToolbar(workspace.locator(".ui-catalog-toolbar"), "wide");
    await workspace.getByRole("checkbox", { name: t("Select Worktree for review") }).first().uncheck();
    const group = workspace.locator(".worktree-dialog__group").first();
    const disclosure = group.locator(".ui-resource-disclosure__trigger");
    await disclosure.click();
    expect(await group.locator(".ui-resource-row").count()).toBe(0);
    await disclosure.click();
    await selectWorktrees("repository", "Select integrated, unchanged Worktrees");
    expect(await group.getByRole("checkbox", { name: t("Select Worktree for review"), checked: true }).count()).toBe(9);
    const globalSelection = workspace.getByRole("button", { name: t("Select Worktrees in this view"), exact: true });
    expect(await globalSelection.isEnabled()).toBe(true);
    await selectWorktrees("view", "Clear Worktree selection");
    expect(await group.getByRole("checkbox", { name: t("Select Worktree for review"), checked: true }).count()).toBe(0);
    await selectWorktrees("view", "Select integrated, unchanged Worktrees");
    for (const width of [920, 1180, 1440]) {
      await page.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      const selectionRow = workspace.locator(".ui-resource-row").filter({
        has: page.getByRole("button", { name: `${t("Move to Trash...")} (9)`, exact: true })
      });
      expect(await selectionRow.getByText(t("{{count}} selected", { count: 9 }), { exact: true }).count()).toBe(1);
      expect(await selectionRow.locator(".ui-resource-row__metadata").textContent()).not.toContain(t("{{count}} selected", { count: 9 }));
      expect(await selectionRow.evaluate((row) => [...row.querySelectorAll<HTMLElement>("button, input, .ui-resource-row__metadata")]
        .every((element) => {
          const bounds = element.getBoundingClientRect();
          return element.scrollWidth <= element.clientWidth + 1 && bounds.left >= 0 && bounds.right <= window.innerWidth;
        }))).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-selected-${locale}-${width}.png`) });
    }
    await page.setViewportSize({ width: 920, height: 620 });
    expect(await group.locator(".ui-resource-row").filter({ hasText: "locked-worktree" }).getByRole("checkbox").count()).toBe(1);
    expect(await group.locator(".ui-resource-row").filter({ hasText: "long-name-with-uncommitted-work" }).getByRole("checkbox").isChecked()).toBe(false);
    expect(await group.locator(".ui-resource-row").filter({ hasText: "needs-review" }).getByRole("checkbox").isChecked()).toBe(false);
    // Hold the read-only IPC boundary to inspect pending/error layouts deterministically.
    await app.evaluate(({ ipcMain }) => {
      const channel = "worktrees:preview-batch";
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers;
      const original = handlers.get(channel)!;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        await new Promise<void>((resolve) => Object.assign(globalThis, { releaseWorktreePreparation: resolve }));
        try {
          const results = await original(...args) as Array<{ path: string; preview?: unknown }>;
          return results.map((result, index) => index ? result : { path: result.path, error: "Fixture inspection failure; retry this item." });
        } finally {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, original);
        }
      });
    });
    await workspace.getByRole("button", { name: `${t("Move to Trash...")} (9)`, exact: true }).click();
    const batchDialog = page.getByRole("dialog");
    await batchDialog.waitFor();
    expect(await batchDialog.getByText(t("Checking..."), { exact: true }).count()).toBe(9);
    expect(await batchDialog.getByRole("button", { name: t("Move {{count}} to Trash", { count: 9 }), exact: true }).isDisabled()).toBe(true);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-preparing-${locale}-920.png`) });
    await expect.poll(() => app!.evaluate(() => typeof (globalThis as typeof globalThis & { releaseWorktreePreparation?: () => void }).releaseWorktreePreparation)).toBe("function");
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseWorktreePreparation?: () => void }).releaseWorktreePreparation!());
    const retryPreparedItem = batchDialog.getByRole("button", { name: t("Retry review of {{name}}", { name: "review-change" }), exact: true });
    await retryPreparedItem.click({ trial: true });
    expect(await batchDialog.getByRole("alert").textContent()).toContain("Fixture inspection failure");
    expect(await batchDialog.getByRole("button", { name: t("Move {{count}} to Trash", { count: 8 }), exact: true }).isEnabled()).toBe(true);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-preparation-error-${locale}-920.png`) });
    await retryPreparedItem.click();
    await batchDialog.getByRole("button", { name: t("Move {{count}} to Trash", { count: 9 }), exact: true }).click({ trial: true });
    expect(await batchDialog.getByText(t("Selected size"), { exact: true }).count()).toBe(0);
    expect(await batchDialog.getByText(t("Selected Worktrees"), { exact: true }).count()).toBe(1);
    expect(await batchDialog.getByText(t("Space retained in Trash"), { exact: true }).count()).toBe(1);
    expect(await batchDialog.getByText(t("Local recovery copies"), { exact: true }).count()).toBe(0);
    expect(await batchDialog.locator(".ui-resource-row__metadata .ui-catalog-sort-metric").count()).toBe(18);
    await batchDialog.getByRole("button", { name: t("Cancel"), exact: true }).click();
    await selectWorktrees("repository", "Clear Worktree selection");
    await group.getByRole("button", { name: t("Repository actions"), exact: true }).click();
    await page.getByRole("menuitem", { name: t("Ignore repository"), exact: true }).click();
    const ignoredSection = workspace.getByRole("button", { name: t("Ignored repositories"), exact: true });
    await ignoredSection.waitFor();
    expect(await ignoredSection.getAttribute("aria-expanded")).toBe("false");
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-ignored-collapsed-${locale}-920.png`) });
    await ignoredSection.click();
    const repositoryActions = group.getByRole("button", { name: t("Repository actions"), exact: true });
    await repositoryActions.waitFor();
    expect(await group.getByRole("checkbox").count()).toBe(0);
    const keptSettings = JSON.parse(await readFile(join(data, "worktree-locations.json"), "utf8"));
    expect(Object.values(keptSettings.keptRepositories)).toEqual(["Kept by user"]);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-kept-${locale}-920.png`) });
    await workspace.getByRole("button", { name: "long-name-with-uncommitted-work", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: t("View repository"), exact: true }).click();
    expect(await repositoryActions.evaluate((element) => document.activeElement === element)).toBe(true);
    await repositoryActions.click();
    await page.getByRole("menuitem", { name: t("Stop ignoring repository"), exact: true }).click();
    await group.getByRole("button", { name: t("Select Worktrees in this repository"), exact: true }).waitFor();
    expect(await group.getByRole("checkbox", { name: t("Select Worktree for review") }).count()).toBe(12);
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
    expect(await dirtyDialog.getByRole("button", { name: t("Git details"), exact: true }).getAttribute("aria-expanded")).toBe("false");
    expect(await dirtyDialog.getByRole("combobox", { name: t("Integration target"), exact: true }).count()).toBe(0);
    expect(await dirtyDialog.getByRole("button", { name: t("Ignore Worktree"), exact: true }).isEnabled()).toBe(true);
    const analyze = dirtyDialog.getByRole("button", { name: t("Analyze retention"), exact: true });
    await analyze.waitFor();
    expect(await analyze.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return Boolean(element.closest(".ui-dialog-footer")) && box.top >= 0 && box.bottom <= window.innerHeight;
    })).toBe(true);
    expect(calls).toBe(0);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-analysis-entry-${locale}-920.png`) });
    expect(await dirtyDialog.getByRole("checkbox").count()).toBe(0);
    await analyze.click();
    await dirtyDialog.getByText("Keep the local experiments until their purpose is confirmed.", { exact: true }).waitFor();
    expect(await dirtyDialog.getByText("Keep the local experiments until their purpose is confirmed.", { exact: true }).evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight;
    })).toBe(true);
    expect(calls).toBe(1);
    expect(await dirtyDialog.getByRole("checkbox").count()).toBe(0);
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
    expect(await dirtyDialog.locator(".worktree-dialog__body").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await dirtyDialog.getByRole("button", { name: t("Move to Trash...") }).evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return element.closest(".ui-dialog-footer") !== null && bounds.top >= 0 && bounds.bottom <= innerHeight;
    })).toBe(true);
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
    const gitDetails = dialog.getByRole("button", { name: t("Git details"), exact: true });
    expect(await gitDetails.getAttribute("aria-expanded")).toBe("false");
    expect(await dialog.getByText("HEAD", { exact: true }).count()).toBe(0);
    expect(await dialog.getByRole("combobox", { name: t("Integration target"), exact: true }).count()).toBe(0);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-detail-collapsed-${locale}-920.png`) });
    }
    await gitDetails.click();
    expect(await gitDetails.getAttribute("aria-expanded")).toBe("true");
    expect(await dialog.getByText("HEAD", { exact: true }).count()).toBe(1);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-detail-expanded-${locale}-920.png`) });
    }
    const target = dialog.getByRole("combobox", { name: t("Integration target"), exact: true });
    await target.selectOption("refs/heads/main");
    await expect.poll(() => target.inputValue()).toBe("refs/heads/main");
    expect(await dialog.getByText(t("Contained in target"), { exact: true }).count()).toBe(1);
    const savedTarget = JSON.parse(await readFile(join(data, "worktree-locations.json"), "utf8"));
    expect(Object.values(savedTarget.integrationRefs)).toEqual(["refs/heads/main"]);
    for (const viewport of [{ width: 920, height: 620 }, { width: 1180, height: 728 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= window.innerWidth && element.scrollWidth <= element.clientWidth + 1;
      })).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-target-${locale}-${viewport.width}.png`) });
    }
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
    await dialog.getByRole("button", { name: t("Move to Trash...") }).click();
    await dialog.getByRole("button", { name: t("Move {{count}} to Trash", { count: 1 }), exact: true }).click({ trial: true });
    expect(await dialog.locator(`.ui-resource-row__metadata .ui-catalog-sort-metric[aria-label^="${t("Size")}:"]`).textContent()).toBe("5 B");
    await dialog.getByText(t("Space retained in Trash"), { exact: true }).waitFor();
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
    await dialog.getByRole("button", { name: t("Move {{count}} to Trash", { count: 1 }), exact: true }).click();
    await dialog.getByText(t("Moved to Trash"), { exact: true }).waitFor();
    expect(await dialog.locator(".ui-detail-list").textContent()).toContain(`${t("Estimated space freed")}0 B`);
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
    await workspace.getByRole("button", { name: t("Worktree Trash") }).click();
    await dialog.getByText(t("In Trash"), { exact: true }).waitFor();
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) {
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktrees-recovery-${locale}-920.png`) });
    }
    await dialog.getByRole("button", { name: t("Restore"), exact: true }).click();
    await expect.poll(() => readFile(join(linked, "README.md"), "utf8")).toBe("base\n");
    await expect.poll(() => dialog.locator(".ui-resource-row").filter({ has: page.getByText(linked, { exact: true }) }).count()).toBe(0);
    await dialog.getByRole("button", { name: t("Close"), exact: true }).last().click({ trial: true });
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

    // The direct route needs only Preview and final confirmation, even with fresh staged/ignored files.
    await reopened.keyboard.press("Escape");
    await writeFile(join(dirty, "README.md"), "staged work kept by recovery\n");
    await run("git", ["-C", dirty, "add", "README.md"]);
    await writeFile(join(dirty, ".gitignore"), "cache/\n");
    await mkdir(join(dirty, "cache"));
    await writeFile(join(dirty, "cache", "result.txt"), "ignored experiment\n");
    const beforeDirtyStatus = (await run("git", ["-C", dirty, "status", "--porcelain=v1", "-z", "--ignored=matching"])).stdout;
    const dirtyRow = reopened.locator(".worktree-workspace .ui-resource-row").filter({ has: reopened.getByText(dirty, { exact: true }) });
    await dirtyRow.hover();
    await dirtyRow.getByRole("button", { name: t("Move to Trash..."), exact: true }).click();
    const dirtyConfirm = reopened.getByRole("dialog", { name: t("Move Worktrees to Trash?"), exact: true });
    await dirtyConfirm.getByRole("button", { name: t("Move {{count}} to Trash", { count: 1 }), exact: true }).click({ trial: true });
    await dirtyConfirm.getByText(t("The folder is moved, not copied. It still uses disk space until Trash is emptied. You can restore it from Worktree recovery.")).waitFor();
    expect(await dirtyConfirm.getByRole("checkbox").count()).toBe(0);
    for (const [width, height] of [[920, 620], [1180, 728], [1440, 900]]) {
      await reopened.setViewportSize({ width, height });
      expect(await dirtyConfirm.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const body = element.querySelector<HTMLElement>(".ui-dialog-body")!;
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && body.scrollWidth <= body.clientWidth + 1;
      })).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await reopened.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-direct-confirm-${locale}-${width}.png`) });
    }
    expect((await run("git", ["-C", dirty, "status", "--porcelain=v1", "-z", "--ignored=matching"])).stdout).toBe(beforeDirtyStatus);
    await dirtyConfirm.getByRole("button", { name: t("Cancel"), exact: true }).click();
    expect(await readFile(join(dirty, "notes.txt"), "utf8")).toBe("unsaved work\n");
    await dirtyRow.hover();
    await dirtyRow.getByRole("button", { name: t("Move to Trash..."), exact: true }).click();
    await dirtyConfirm.getByRole("button", { name: t("Move {{count}} to Trash", { count: 1 }), exact: true }).click();
    const dirtyResults = reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true });
    await dirtyResults.getByText(t("Moved to Trash"), { exact: true }).waitFor();
    expect(await dirtyResults.locator(".ui-detail-list").textContent()).toContain(`${t("Estimated space freed")}0 B`);
    expect(await dirtyResults.getByText(t("Space retained in Trash"), { exact: true }).count()).toBe(1);
    const dirtyRecovery = (await reopened.evaluate(() => window.agentEnv.listWorktreeRecovery())).records.find((record) => record.path === dirty)!;
    expect(dirtyRecovery.mode).toBe("trash");
    expect(dirtyRecovery.backupHash).toBeUndefined();
    expect(dirtyRecovery.retainedPath).toBeTruthy();
    expect((await run("git", ["-C", dirtyRecovery.retainedPath!, "status", "--porcelain=v1", "-z", "--ignored=matching"])).stdout).toBe(beforeDirtyStatus);
    expect(dirtyRecovery.reclaimedSizeBytes).toBe(0);
    await expect(readFile(join(dirty, "notes.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await run("git", ["-C", repo, "worktree", "list", "--porcelain"])).stdout).not.toContain(dirty);
    await dirtyResults.getByRole("button", { name: t("View Trash"), exact: true }).click();
    const recoveryDialog = reopened.getByRole("dialog", { name: t("Trash and recovery"), exact: true });
    const dirtyRecoveryRow = recoveryDialog.locator(".ui-resource-row").filter({ has: reopened.getByText(dirty, { exact: true }) });
    await dirtyRecoveryRow.getByRole("button", { name: t("Restore"), exact: true }).click();
    await dirtyRecoveryRow.waitFor({ state: "hidden" });
    await expect.poll(() => readFile(join(dirty, "notes.txt"), "utf8")).toBe("unsaved work\n");
    expect(await readFile(join(dirty, "README.md"), "utf8")).toBe("staged work kept by recovery\n");
    expect(await readFile(join(dirty, "cache", "result.txt"), "utf8")).toBe("ignored experiment\n");
    for (let index = 0; index < 20; index++) expect(await readFile(join(dirty, `experiment-${index}.txt`), "utf8")).toBe("keep this experiment\n");
    expect((await run("git", ["-C", dirty, "status", "--porcelain=v1", "-z", "--ignored=matching"])).stdout).toBe(beforeDirtyStatus);
    expect(calls).toBe(1);

    // Explicitly select two dirty trees and a clean tree, then authorize one combined removal.
    await reopened.getByRole("dialog", { name: t("Trash and recovery"), exact: true })
      .getByRole("button", { name: t("Close"), exact: true }).last().click();
    const secondDirty = join(home, ".codex", "worktrees", "manual-second");
    await run("git", ["-C", repo, "worktree", "add", "-b", "manual-second", secondDirty]);
    await writeFile(join(secondDirty, "README.md"), "second staged change\n");
    await run("git", ["-C", secondDirty, "add", "README.md"]);
    await writeFile(join(secondDirty, "extra.txt"), "second untracked note\n");
    const secondStatus = (await run("git", ["-C", secondDirty, "status", "--porcelain=v1", "-z", "--ignored=matching"])).stdout;
    const reopenedWorkspace = reopened.locator(".worktree-workspace");
    await reopenedWorkspace.getByRole("button", { name: t("Refresh Worktrees"), exact: true }).click();
    await reopenedWorkspace.getByText(secondDirty, { exact: true }).waitFor();
    await expect.poll(() => reopenedWorkspace.getByRole("button", { name: t("Refresh Worktrees"), exact: true }).getAttribute("aria-busy")).toBe("false");
    for (const path of [dirty, secondDirty, linked]) {
      const row = reopenedWorkspace.locator(".ui-resource-row").filter({ has: reopened.getByText(path, { exact: true }) });
      const choice = row.getByRole("checkbox", { name: t("Select Worktree for review"), exact: true });
      const current = await reopened.evaluate(async (path) => (await window.agentEnv.cachedWorktreeInventory()).inventory?.entries.find((entry) => entry.path === path), path);
      expect(await choice.count(), JSON.stringify(current)).toBe(1);
      await choice.check();
    }
    const previewSelection = reopenedWorkspace.getByRole("button", { name: `${t("Move to Trash...")} (3)`, exact: true });
    await previewSelection.click();
    const combinedConfirm = reopened.getByRole("dialog", { name: t("Move Worktrees to Trash?", { count: 3 }), exact: true });
    await combinedConfirm.getByRole("button", { name: t("Move {{count}} to Trash", { count: 3 }), exact: true }).click({ trial: true });
    expect(await combinedConfirm.getByText(t("Selected Worktrees"), { exact: true }).count()).toBe(1);
    expect(await combinedConfirm.getByText(t("Ready"), { exact: true }).count()).toBe(3);
    expect(await combinedConfirm.getByText(t("The owning repository's branches and remote refs are not deleted."), { exact: true }).count()).toBe(1);
    expect(await combinedConfirm.getByText(t("Selected size"), { exact: true }).count()).toBe(0);
    for (const [width, height] of [[920, 620], [1180, 728], [1440, 900]]) {
      await reopened.setViewportSize({ width, height });
      expect(await combinedConfirm.evaluate((element) => {
        const body = element.querySelector<HTMLElement>(".ui-dialog-body")!;
        const footer = element.querySelector(".ui-dialog-footer")!.getBoundingClientRect();
        return body.scrollWidth <= body.clientWidth + 1 && footer.bottom <= innerHeight;
      })).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await reopened.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-manual-batch-${locale}-${width}.png`) });
    }
    await combinedConfirm.getByRole("button", { name: t("Cancel"), exact: true }).click();
    expect((await run("git", ["-C", dirty, "status", "--porcelain=v1", "-z", "--ignored=matching"])).stdout).toBe(beforeDirtyStatus);
    expect((await run("git", ["-C", secondDirty, "status", "--porcelain=v1", "-z", "--ignored=matching"])).stdout).toBe(secondStatus);
    await previewSelection.click();
    await combinedConfirm.getByRole("button", { name: t("Move {{count}} to Trash", { count: 3 }), exact: true }).click();
    const combinedResults = reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true });
    await combinedResults.getByRole("button", { name: t("Close"), exact: true }).last().click({ trial: true });
    expect(await combinedResults.getByText(t("Moved to Trash"), { exact: true }).count(), (await combinedResults.textContent()) ?? undefined).toBe(3);
    for (const path of [dirty, secondDirty, linked]) {
      await expect(readFile(join(path, "README.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect((await run("git", ["-C", repo, "worktree", "list", "--porcelain"])).stdout).not.toContain(path);
    }
    await combinedResults.getByRole("button", { name: t("Close"), exact: true }).last().click();
    await reopenedWorkspace.getByRole("button", { name: t("Worktree Trash"), exact: true }).click();
    for (const path of [dirty, secondDirty]) {
      const rows = reopened.getByRole("dialog", { name: t("Trash and recovery"), exact: true }).locator(".ui-resource-row")
        .filter({ has: reopened.getByText(path, { exact: true }) });
      const restore = rows.getByRole("button", { name: t("Restore"), exact: true });
      await restore.click();
      await restore.waitFor({ state: "hidden" });
    }
    expect((await run("git", ["-C", dirty, "status", "--porcelain=v1", "-z", "--ignored=matching"])).stdout).toBe(beforeDirtyStatus);
    expect((await run("git", ["-C", secondDirty, "status", "--porcelain=v1", "-z", "--ignored=matching"])).stdout).toBe(secondStatus);
    expect(await readFile(join(dirty, "notes.txt"), "utf8")).toBe("unsaved work\n");
    expect(await readFile(join(dirty, "cache", "result.txt"), "utf8")).toBe("ignored experiment\n");
    expect(await readFile(join(secondDirty, "extra.txt"), "utf8")).toBe("second untracked note\n");
    expect(calls).toBe(1);

    // Leaving the page lets the current verified transaction finish, but stops queued removals.
    await reopened.getByRole("dialog", { name: t("Trash and recovery"), exact: true })
      .getByRole("button", { name: t("Close"), exact: true }).last().click();
    const firstQueued = join(home, ".codex", "worktrees", "task-0");
    const secondQueued = join(home, ".codex", "worktrees", "task-1");
    for (const path of [firstQueued, secondQueued]) {
      await reopenedWorkspace.locator(".ui-resource-row").filter({ has: reopened.getByText(path, { exact: true }) })
        .getByRole("checkbox", { name: t("Select Worktree for review"), exact: true }).check();
    }
    await reopenedWorkspace.getByRole("button", { name: `${t("Move to Trash...")} (2)`, exact: true }).click();
    const navigationConfirm = reopened.getByRole("dialog", { name: t("Move Worktrees to Trash?", { count: 2 }), exact: true });
    const navigationRemove = navigationConfirm.getByRole("button", { name: t("Move {{count}} to Trash", { count: 2 }), exact: true });
    await navigationRemove.click({ trial: true });
    await app.evaluate(({ ipcMain }) => {
      const channel = "worktrees:remove";
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers;
      const original = handlers.get(channel)!;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (event, ...args) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, original);
        const preview = args[0] as { entry: { path: string } };
        Object.assign(globalThis, { worktreeNavigationPath: preview.entry.path });
        const active = original(event, ...args);
        event.sender.send("app:open-settings-requested");
        return active;
      });
    });
    await navigationRemove.click();
    await reopenedWorkspace.waitFor({ state: "hidden" });
    const activePath = await app.evaluate(() => (globalThis as typeof globalThis & { worktreeNavigationPath?: string }).worktreeNavigationPath);
    expect([firstQueued, secondQueued]).toContain(activePath);
    const retainedPath = activePath === firstQueued ? secondQueued : firstQueued;
    await expect.poll(async () => (await run("git", ["-C", repo, "worktree", "list", "--porcelain"])).stdout).not.toContain(activePath!);
    await expect(readFile(join(activePath!, "README.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(retainedPath, "README.md"), "utf8")).toBe("base\n");
    expect((await run("git", ["-C", repo, "worktree", "list", "--porcelain"])).stdout).toContain(retainedPath);

    // A paused merge is a recoverable state, not an actively running Git process.
    const paused = join(home, ".codex", "worktrees", "paused-merge");
    const identity = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com"];
    await run("git", ["-C", repo, "worktree", "add", "-b", "paused-merge", paused]);
    await writeFile(join(paused, "README.md"), "local branch content\n");
    await run("git", ["-C", paused, "add", "README.md"]);
    await run("git", ["-C", paused, ...identity, "commit", "-m", "local side"]);
    await writeFile(join(repo, "README.md"), "integration branch content\n");
    await run("git", ["-C", repo, "add", "README.md"]);
    await run("git", ["-C", repo, ...identity, "commit", "-m", "integration side"]);
    await expect(run("git", ["-C", paused, ...identity, "merge", "main", "--no-edit"])).rejects.toMatchObject({ code: 1 });
    const pausedStatus = (await run("git", ["-C", paused, "status", "--porcelain=v1", "-z"])).stdout;
    const pausedGitDir = (await run("git", ["-C", paused, "rev-parse", "--absolute-git-dir"])).stdout.trim();
    const mergeHead = await readFile(join(pausedGitDir, "MERGE_HEAD"), "utf8");
    const mergeMessage = await readFile(join(pausedGitDir, "MERGE_MSG"), "utf8");
    const conflictedContent = await readFile(join(paused, "README.md"), "utf8");
    // Stale operation history is pre-existing damage, not new recovery data loss.
    const missingOperationObject = "f".repeat(40);
    await writeFile(join(pausedGitDir, "REBASE_HEAD"), `${missingOperationObject}\n`);
    await reopened.getByRole("button", { name: t("Worktrees"), exact: true }).click();
    await reopenedWorkspace.getByRole("button", { name: t("Refresh Worktrees"), exact: true }).click();
    await expect.poll(() => reopenedWorkspace.getByRole("button", { name: t("Refresh Worktrees"), exact: true }).getAttribute("aria-busy")).toBe("false");
    await reopened.setViewportSize({ width: 920, height: 620 });
    const pausedRow = reopenedWorkspace.locator(".ui-resource-row").filter({ has: reopened.getByText(paused, { exact: true }) });
    await pausedRow.getByRole("checkbox", { name: t("Select Worktree for review"), exact: true }).check();
    // Optional measurement can still be pending when the real Git preview is ready.
    await app.evaluate(({ ipcMain }) => {
      const channel = "worktrees:preview";
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers;
      const original = handlers.get(channel)!;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        try {
          const result = await original(...args) as { entry: { sizeBytes?: number; measurementPending?: boolean } };
          return { ...result, entry: { ...result.entry, sizeBytes: undefined, measurementPending: true } };
        } finally {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, original);
        }
      });
    });
    await reopenedWorkspace.getByRole("button", { name: `${t("Move to Trash...")} (1)`, exact: true }).click();
    const pausedConfirm = reopened.getByRole("dialog", { name: t("Move Worktrees to Trash?"), exact: true });
    await pausedConfirm.getByRole("button", { name: t("Move {{count}} to Trash", { count: 1 }), exact: true }).click({ trial: true });
    await expect.poll(() => pausedConfirm.getByText(t("Not measured"), { exact: true }).count()).toBeGreaterThan(0);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await reopened.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-paused-operation-${locale}-920.png`) });
    await pausedConfirm.getByRole("button", { name: t("Move {{count}} to Trash", { count: 1 }), exact: true }).click();
    const pausedResults = reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true });
    await pausedResults.getByText(t("Moved to Trash"), { exact: true }).waitFor();
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await reopened.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-incomplete-history-${locale}-920.png`) });
    await expect(readFile(join(paused, "README.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await pausedResults.getByRole("button", { name: t("View Trash"), exact: true }).click();
    const pausedRecovery = reopened.getByRole("dialog", { name: t("Trash and recovery"), exact: true })
      .locator(".ui-resource-row").filter({ has: reopened.getByText(paused, { exact: true }) });
    await pausedRecovery.getByRole("button", { name: t("Restore"), exact: true }).click();
    await pausedRecovery.waitFor({ state: "hidden" });
    expect((await run("git", ["-C", paused, "status", "--porcelain=v1", "-z"])).stdout).toBe(pausedStatus);
    const restoredGitDir = (await run("git", ["-C", paused, "rev-parse", "--absolute-git-dir"])).stdout.trim();
    expect(await readFile(join(restoredGitDir, "MERGE_HEAD"), "utf8")).toBe(mergeHead);
    expect(await readFile(join(restoredGitDir, "MERGE_MSG"), "utf8")).toBe(mergeMessage);
    expect(await readFile(join(restoredGitDir, "REBASE_HEAD"), "utf8")).toBe(`${missingOperationObject}\n`);
    expect(await readFile(join(paused, "README.md"), "utf8")).toBe(conflictedContent);
    expect(calls).toBe(1);

    await reopened.getByRole("dialog", { name: t("Trash and recovery"), exact: true }).getByRole("button", { name: t("Close"), exact: true }).last().click();
    const permanent = join(home, ".codex", "worktrees", "discard-local-work");
    await run("git", ["-C", repo, "worktree", "add", "-b", "discard-local-work", permanent]);
    await writeFile(join(permanent, "experiment.txt"), "explicitly discard this local experiment\n");
    const permanentGit = (await run("git", ["-C", permanent, "rev-parse", "--absolute-git-dir"])).stdout.trim();
    await writeFile(join(permanentGit, "REBASE_HEAD"), `${"f".repeat(40)}\n`);
    const graph = join(repo, ".git", "objects", "info", "commit-graph");
    await writeFile(graph, "invalid unrelated graph cache\n");
    await reopenedWorkspace.getByRole("button", { name: t("Refresh Worktrees"), exact: true }).click();
    const permanentRow = reopenedWorkspace.locator(".ui-resource-row").filter({ has: reopened.getByText(permanent, { exact: true }) });
    await permanentRow.getByRole("checkbox", { name: t("Select Worktree for review"), exact: true }).waitFor();
    await permanentRow.click({ button: "right" });
    const contextMenu = reopened.getByRole("menu", { name: t("Worktree actions"), exact: true });
    await contextMenu.getByRole("menuitem", { name: t("Delete permanently..."), exact: true }).waitFor();
    await contextMenu.getByRole("menuitem", { name: t("Move to Trash..."), exact: true }).waitFor();
    await reopened.keyboard.press("Escape");
    await permanentRow.getByRole("checkbox").check();
    await reopenedWorkspace.getByRole("button", { name: t("Delete permanently..."), exact: true }).click();
    const permanentConfirm = reopened.getByRole("dialog", { name: t("Permanently delete Worktrees?"), exact: true });
    await permanentConfirm.getByRole("button", { name: t("Permanently delete {{count}}", { count: 1 }), exact: true }).click({ trial: true });
    expect(await readFile(join(permanent, "experiment.txt"), "utf8")).toContain("explicitly discard");
    for (const width of [920, 1180, 1440]) {
      await reopened.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      expect(await permanentConfirm.evaluate((element) => {
        const box = element.getBoundingClientRect(), body = element.querySelector<HTMLElement>(".ui-dialog-body")!;
        return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && body.scrollWidth <= body.clientWidth + 1;
      })).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await reopened.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-permanent-${locale}-${width}.png`) });
    }
    await permanentConfirm.getByRole("button", { name: t("Permanently delete {{count}}", { count: 1 }), exact: true }).click();
    const permanentResults = reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true });
    await permanentResults.getByText(t("Deleted"), { exact: true }).waitFor();
    await expect(readFile(join(permanent, "experiment.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(graph, "utf8")).toBe("invalid unrelated graph cache\n");
    expect((await run("git", ["-C", repo, "for-each-ref", "--format=%(refname)", "refs/heads/discard-local-work"])).stdout).toContain("refs/heads/discard-local-work");
    await rm(graph);
    await permanentResults.getByRole("button", { name: t("View Trash"), exact: true }).click();
    const trashDialog = reopened.getByRole("dialog", { name: t("Trash and recovery"), exact: true });
    const trashItems = await reopened.evaluate(() => window.agentEnv.listWorktreeRecovery("trash"));
    const count = trashItems.records.filter((item) => item.mode === "trash" && item.status === "removed").length;
    expect(count).toBeGreaterThan(0);
    await reopened.setViewportSize({ width: 920, height: 620 });
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await reopened.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-trash-${locale}-920.png`) });
    // A failed permanent deletion must remain part of the same Empty Trash command.
    const partial = trashItems.records.find((item) => item.mode === "trash" && item.status === "removed")!;
    const partialJournalPath = join(data, "worktree-trash", `${partial.id}.json`);
    const partialJournal = JSON.parse(await readFile(partialJournalPath, "utf8"));
    partialJournal.mode = "permanent"; partialJournal.phase = "deleting";
    partialJournal.entry.sizeBytes = 9999999;
    await rm(join(partialJournal.storage, ".git"));
    await writeFile(partialJournalPath, JSON.stringify(partialJournal));
    await mkdir(partial.path, { recursive: true });
    await writeFile(join(partial.path, "new-work.txt"), "A new folder at the original path must survive\n");
    await trashDialog.getByRole("button", { name: t("Recheck recovery"), exact: true }).click();
    await trashDialog.getByText(t("Deletion incomplete"), { exact: true }).waitFor();
    await trashDialog.getByRole("button", { name: t("Empty Trash..."), exact: true }).click();
    const emptyTrashConfirm = reopened.getByRole("dialog", { name: t("Permanently delete Worktrees?"), exact: true });
    await emptyTrashConfirm.getByRole("button", { name: t("Permanently delete {{count}}", { count }), exact: true }).click({ trial: true });
    expect(await emptyTrashConfirm.getByText(partialJournal.storage, { exact: true }).count()).toBe(1);
    for (const width of [920, 1180, 1440]) {
      await reopened.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      expect(await emptyTrashConfirm.evaluate((element) => {
        const box = element.getBoundingClientRect(), body = element.querySelector<HTMLElement>(".ui-dialog-body")!;
        const footer = element.querySelector(".ui-dialog-footer")!.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && body.scrollWidth <= body.clientWidth + 1 && footer.bottom <= innerHeight;
      })).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await reopened.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-empty-trash-partial-${locale}-${width}.png`) });
    }
    await emptyTrashConfirm.getByRole("button", { name: t("Permanently delete {{count}}", { count }), exact: true }).click();
    await expect.poll(async () => reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true }).getByText(t("Deleted"), { exact: true }).count()).toBe(count);
    expect((await reopened.evaluate(() => window.agentEnv.listWorktreeRecovery("trash"))).records).toEqual([]);
    expect(await readFile(join(partial.path, "new-work.txt"), "utf8")).toBe("A new folder at the original path must survive\n");
    expect(calls).toBe(1);
    await reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true }).getByRole("button", { name: t("Close"), exact: true }).last().click();
    const broken = join(home, ".codex", "worktrees", "broken-git-metadata");
    const gone = join(home, ".codex", "worktrees", "already-removed");
    for (const path of [broken, gone]) await run("git", ["-C", repo, "worktree", "add", "-b", path === broken ? "broken-metadata" : "already-removed", path]);
    await rm(gone, { recursive: true });
    await writeFile(join(broken, ".git"), "invalid Git metadata\n");
    await reopenedWorkspace.getByRole("button", { name: t("Refresh Worktrees"), exact: true }).click();
    await expect.poll(() => reopenedWorkspace.getByRole("button", { name: t("Refresh Worktrees"), exact: true }).getAttribute("aria-busy")).toBe("false");
    expect(await reopenedWorkspace.getByText(gone, { exact: true }).count()).toBe(0);
    const brokenRow = reopenedWorkspace.locator(".ui-resource-row").filter({ has: reopened.getByText(broken, { exact: true }) });
    await brokenRow.getByRole("checkbox", { name: t("Select Worktree for review"), exact: true }).check();
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers;
      for (const channel of ["worktrees:remove", "diagnostics:read-issue", "clipboard:write-text"]) {
        const original = handlers.get(channel)!;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_event, ...args) => {
          ipcMain.removeHandler(channel); ipcMain.handle(channel, original);
          if (channel === "worktrees:remove") throw new Error("ENOTEMPTY: directory not empty\nDiagnostic reference: AEM-20261104-ABCDEF");
          if (channel === "diagnostics:read-issue") return new Promise(() => {});
          Object.assign(globalThis, { worktreeCopiedError: String(args[0]) });
        });
      }
    });
    await reopenedWorkspace.getByRole("button", { name: t("Delete permanently..."), exact: true }).click();
    await reopened.getByRole("dialog", { name: t("Permanently delete Worktrees?"), exact: true }).getByRole("button", { name: t("Permanently delete {{count}}", { count: 1 }), exact: true }).click();
    const failedResults = reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true });
    await failedResults.getByText(t("Failed"), { exact: true }).waitFor();
    await failedResults.getByRole("button", { name: t("Copy details"), exact: true }).click();
    await failedResults.getByRole("button", { name: t("Copied"), exact: true }).waitFor();
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { worktreeCopiedError?: string }).worktreeCopiedError)).toContain("AEM-20261104-ABCDEF");
    expect(await failedResults.evaluate((element) => {
      const body = element.querySelector<HTMLElement>(".ui-dialog-body")!;
      return body.scrollWidth <= body.clientWidth + 1 && element.querySelector(".ui-dialog-footer")!.getBoundingClientRect().bottom <= innerHeight;
    })).toBe(true);
    if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await reopened.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-copy-fallback-${locale}-920.png`) });
    await failedResults.getByRole("button", { name: t("Close"), exact: true }).last().click();
    await brokenRow.getByRole("checkbox", { name: t("Select Worktree for review"), exact: true }).check();
    await reopenedWorkspace.getByRole("button", { name: t("Delete permanently..."), exact: true }).click();
    const brokenConfirm = reopened.getByRole("dialog", { name: t("Permanently delete Worktrees?"), exact: true });
    await brokenConfirm.getByRole("button", { name: t("Permanently delete {{count}}", { count: 1 }), exact: true }).click();
    await reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true }).getByText(t("Deleted"), { exact: true }).waitFor();
    await expect(readFile(join(broken, "README.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true }).getByRole("button", { name: t("Close"), exact: true }).last().click();
    const writing = join(home, ".codex", "worktrees", "git-still-writing");
    await run("git", ["-C", repo, "worktree", "add", "-b", "git-still-writing", writing]);
    const writingAdmin = (await run("git", ["-C", writing, "rev-parse", "--absolute-git-dir"])).stdout.trim();
    await writeFile(join(writingAdmin, "index.lock"), "fixture writer\n");
    const writingFile = await readFile(join(writing, "README.md"), "utf8"), mainFile = await readFile(join(repo, "README.md"), "utf8");
    const writingHead = await readFile(join(writingAdmin, "HEAD"), "utf8"), writingBacklink = await readFile(join(writingAdmin, "gitdir"), "utf8");
    await reopenedWorkspace.getByRole("button", { name: t("Refresh Worktrees"), exact: true }).click();
    await expect.poll(() => reopenedWorkspace.getByRole("button", { name: t("Refresh Worktrees"), exact: true }).getAttribute("aria-busy")).toBe("false");
    const writingRow = reopenedWorkspace.locator(".ui-resource-row").filter({ has: reopened.getByText(writing, { exact: true }) });
    await writingRow.getByRole("checkbox", { name: t("Select Worktree for review"), exact: true }).check();
    await reopenedWorkspace.getByRole("button", { name: `${t("Move to Trash...")} (1)`, exact: true }).click();
    const writingConfirm = reopened.getByRole("dialog", { name: t("Move Worktrees to Trash?"), exact: true });
    await writingConfirm.getByText(t("Git may still be writing. Cleanup can continue; Git metadata will be left unchanged.")).waitFor();
    const moveWriting = writingConfirm.getByRole("button", { name: t("Move {{count}} to Trash", { count: 1 }), exact: true });
    for (const width of [920, 1180, 1440]) {
      await reopened.setViewportSize({ width, height: width === 920 ? 620 : width === 1180 ? 728 : 900 });
      await moveWriting.click({ trial: true });
      expect(await writingConfirm.evaluate((element) => {
        const body = element.querySelector<HTMLElement>(".ui-dialog-body")!;
        return body.scrollWidth <= body.clientWidth + 1 && element.querySelector(".ui-dialog-footer")!.getBoundingClientRect().bottom <= innerHeight;
      })).toBe(true);
      if (process.env.AGENTENV_CAPTURE_WORKTREES_DIR) await reopened.screenshot({ path: join(process.env.AGENTENV_CAPTURE_WORKTREES_DIR, `worktree-git-writing-${locale}-${width}.png`) });
    }
    await moveWriting.click();
    const writingResults = reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true });
    await writingResults.getByText(t("Moved to Trash"), { exact: true }).waitFor();
    expect(await readFile(join(writingAdmin, "index.lock"), "utf8")).toBe("fixture writer\n");
    expect(await readFile(join(writingAdmin, "HEAD"), "utf8")).toBe(writingHead);
    expect(await readFile(join(writingAdmin, "gitdir"), "utf8")).toBe(writingBacklink);
    await writingResults.getByRole("button", { name: t("View Trash"), exact: true }).click();
    const writingRecovery = reopened.getByRole("dialog", { name: t("Trash and recovery"), exact: true });
    await writingRecovery.getByRole("button", { name: t("Restore"), exact: true }).click();
    await expect.poll(() => readFile(join(writing, "README.md"), "utf8")).toBe(writingFile);
    await expect.poll(() => writingRecovery.getByRole("button", { name: t("Close"), exact: true }).last().isEnabled()).toBe(true);
    await writingRecovery.getByRole("button", { name: t("Close"), exact: true }).last().click();
    await writingRow.getByRole("checkbox", { name: t("Select Worktree for review"), exact: true }).check();
    await reopenedWorkspace.getByRole("button", { name: t("Delete permanently..."), exact: true }).click();
    const writingDelete = reopened.getByRole("dialog", { name: t("Permanently delete Worktrees?"), exact: true });
    await writingDelete.getByText(t("Git may still be writing. Cleanup can continue; Git metadata will be left unchanged.")).waitFor();
    await writingDelete.getByRole("button", { name: t("Permanently delete {{count}}", { count: 1 }), exact: true }).click();
    await reopened.getByRole("dialog", { name: t("Cleanup results"), exact: true }).getByText(t("Deleted"), { exact: true }).waitFor();
    await expect(readFile(join(writing, "README.md"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(writingAdmin, "index.lock"), "utf8")).toBe("fixture writer\n");
    expect(await readFile(join(writingAdmin, "HEAD"), "utf8")).toBe(writingHead);
    expect(await readFile(join(writingAdmin, "gitdir"), "utf8")).toBe(writingBacklink);
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe(mainFile);
    expect(calls).toBe(1);
    const cleanupEvents = (await readFile(join(root, "logs", "runtime.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(cleanupEvents.some((event) => event.action === "worktrees:preview-batch" && event.phase === "prepared-worktrees")).toBe(true);
    const stages = cleanupEvents.filter((event) => event.action === "worktrees:remove" && event.phase === "stage-finished");
    expect(stages.some((event) => event.context?.stage === "removing")).toBe(true);
    expect(stages.every((event) => event.durationMs >= 0)).toBe(true);
  }, 90_000);
});
