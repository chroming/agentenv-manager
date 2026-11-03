import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { createBackupStore } from "../../src/main/backupStore";
import { createPaths } from "../../src/main/paths";
import { requireCurrentElectronBuild } from "./currentBuild";
import { expectInViewport, expectNoHorizontalOverflow } from "./layoutAssertions";

requireCurrentElectronBuild();
let root = "";
let app: ElectronApplication | undefined;
const closeApp = async () => {
  const current = app;
  app = undefined;
  if (!current) return;
  const timer = setTimeout(() => current.process().kill("SIGKILL"), 5_000);
  try { await current.close(); } catch { /* Process may already have closed. */ }
  finally { clearTimeout(timer); }
};
afterEach(async () => {
  await closeApp();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 4 });
  root = "";
}, 30_000);

describe.skipIf(process.platform === "win32")("Protected Worktree backups in the existing native manager", () => {
  it("lists and previews mock recovery copies, preserves them across cleanup/restart, and isolates unsafe storage", async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "aem-worktree-backups-ui-")));
    const home = join(root, "home"), data = join(root, "data"), bin = join(root, "bin");
    for (const path of [home, data, bin]) await mkdir(path);
    await writeFile(join(data, "agentenv-data.json"), JSON.stringify({ formatVersion: 2 }));
    await writeFile(join(data, "settings.json"), JSON.stringify({
      locale: "en", enabledTargetIds: ["codex"], agentDiscoveryVersion: 1,
      agentDiscoveryReviewedIds: ["codex", "claude-code", "opencode", "antigravity", "antigravity-app", "pi", "trae-cli", "workbuddy"],
      telemetryEnabled: false, telemetryConsentVersion: 1, skillAutoCheckEnabled: false,
      backupRetentionDays: 7, deletedConversationRetentionDays: 7
    }));
    await writeFile(join(bin, "codex"), "#!/bin/sh\necho 'codex-cli 0.100.0'\n");
    await chmod(join(bin, "codex"), 0o755);
    const paths = createPaths({ appDataRoot: data, homeDir: home });
    await createBackupStore(paths).createBackup([], { operation: "apply", targetId: "codex", profileName: "Daily" });
    const recovery = join(data, "worktree-recovery");
    const id = "106f655d-0b71-4bd8-a74c-c2d302123f36";
    const pending = "fc0f7baa-baff-4016-a8ea-f2fbf9e54fb6";
    const orphan = "e5fc1b61-3207-4a8a-969a-cb6419968299";
    const payload = join(recovery, id, "files");
    await mkdir(join(payload, "cache"), { recursive: true });
    const note = join(payload, "uncommitted-note.txt"), index = join(recovery, id, "index");
    await writeFile(note, "The sole saved uncommitted mock note.");
    await writeFile(join(payload, "cache", "ignored-output.txt"), "saved ignored mock data");
    await writeFile(index, "mock staged state");
    const record = {
      id, path: "/fixture/Workspace/unfinished-task-with-local-experiments", repositoryPath: join(root, "offline-repository"),
      head: "a".repeat(40), createdAt: "2000-01-01T00:00:00.000Z", status: "removed",
      backupHash: "b".repeat(64), indexHash: "c".repeat(64), protectedRef: `refs/agentenv/worktree-recovery/${id}`
    };
    const journal = join(recovery, `${id}.json`);
    await writeFile(journal, JSON.stringify(record));
    await writeFile(join(recovery, `${pending}.json`), JSON.stringify({
      ...record, id: pending, status: "prepared", backupHash: undefined, indexHash: undefined,
      path: "/fixture/Workspace/interrupted-cleanup"
    }));
    await mkdir(join(recovery, orphan, "files"), { recursive: true });
    await writeFile(join(recovery, orphan, "files", "orphan-note.txt"), "preserve an interrupted copy");
    // Mock repository metadata is deliberately offline; inventory must never run Git.
    const ref = join(root, "offline-repository", ".git", "refs", "agentenv", "worktree-recovery", id);
    await mkdir(join(ref, ".."), { recursive: true });
    await writeFile(ref, `${record.head}\n`);
    const saved = await Promise.all([journal, note, index, ref].map((path) => readFile(path, "utf8")));
    const launch = () => electron.launch({
      executablePath: electronPath as unknown as string,
      args: ["--disable-gpu", "--force-device-scale-factor=1", `--user-data-dir=${join(root, "electron")}`, join(process.cwd(), "out/main/main.js")],
      env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: data,
        AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_LOG_ROOT: join(root, "logs"),
        AGENTENV_HOME: home, AGENTENV_FAKE_HOME: join(root, "fake-home"),
        AGENTENV_AUTOMATION_TARGET_PATH: bin, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
    });
    app = await launch();
    const page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus())).toEqual({ state: "ready" });
    const inventory = await page.evaluate(() => window.agentEnv.listManagedBackups());
    const copies = inventory.items.filter((item) => item.kind === "worktree-recovery");
    expect(copies).toHaveLength(3);
    expect(copies.every((item) => !item.deletable && item.cleanupStatus === "required")).toBe(true);
    expect(copies.find((item) => item.id === id)?.sizeBytes).toBeGreaterThan(0);
    expect(inventory.eligibleCount).toBe(0);
    await page.getByRole("complementary", { name: "Global navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Data", exact: true }).click();
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Backups & recovery", exact: true });
    await dialog.getByText("Protected Worktree recovery", { exact: true }).waitFor();
    expect(await dialog.getByText("Incomplete Worktree recovery", { exact: true }).count()).toBe(2);
    const row = dialog.locator(".backup-manager-row").filter({ hasText: "unfinished-task-with-local-experiments" });
    expect(await row.getByRole("button").count()).toBe(1);
    expect(await dialog.getByRole("button", { name: "Clean up now", exact: true }).isEnabled()).toBe(false);
    const capture = async (name: string) => {
      const directory = process.env.AGENTENV_CAPTURE_WORKTREES_DIR;
      if (!directory) return;
      await mkdir(directory, { recursive: true });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: join(directory, name), animations: "disabled" });
    };
    for (const [width, height] of [[920, 620], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await expectInViewport(page, dialog);
      await expectNoHorizontalOverflow(page);
      await capture(`worktree-recovery-backups-en-${width}.png`);
    }
    await page.setViewportSize({ width: 920, height: 620 });
    await row.getByRole("button").click();
    await dialog.getByText(note, { exact: true }).waitFor();
    await dialog.getByText("Worktree recovery may hold the only copy of uncommitted files. Retention cleanup and manual deletion are disabled. Git recovery references are preserved.").waitFor();
    expect(await dialog.getByRole("button", { name: "Delete backup", exact: true }).count()).toBe(0);
    await expectInViewport(page, dialog);
    await expectNoHorizontalOverflow(page);
    expect(await dialog.getByRole("button", { name: "Back", exact: true }).isEnabled()).toBe(true);
    await capture("worktree-recovery-backups-preview-en-920.png");
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    const deletion = await page.evaluate(async (id) => {
      try { await window.agentEnv.deleteManagedBackup({ id, kind: "worktree-recovery" }); return "unexpected deletion"; }
      catch (error) { return String(error); }
    }, id);
    expect(deletion).toContain("whole-transaction");
    for (const scope of [undefined, "recovery", "deleted"] as const) {
      expect(await page.evaluate((scope) => window.agentEnv.cleanupManagedBackups(scope), scope)).toMatchObject({ deletedCount: 0, freedBytes: 0 });
    }
    expect(await Promise.all([journal, note, index, ref].map((path) => readFile(path, "utf8")))).toEqual(saved);
    await closeApp();
    app = await launch();
    const reopened = await app.firstWindow();
    await expect.poll(() => reopened.evaluate(() => window.agentEnv.readStartupStatus())).toEqual({ state: "ready" });
    expect((await reopened.evaluate(() => window.agentEnv.listManagedBackups())).items.filter((item) => item.kind === "worktree-recovery")).toHaveLength(3);
    expect(await Promise.all([journal, note, index, ref].map((path) => readFile(path, "utf8")))).toEqual(saved);
    await closeApp();
    await rm(recovery, { recursive: true });
    await symlink(join(root, "offline-repository"), recovery);
    app = await launch();
    const unsafe = await app.firstWindow();
    await expect.poll(() => unsafe.evaluate(() => window.agentEnv.readStartupStatus())).toEqual({ state: "ready" });
    const limited = await unsafe.evaluate(() => window.agentEnv.listManagedBackups());
    expect(limited.items.some((item) => item.kind === "target-recovery")).toBe(true);
    expect(limited.issues).toEqual([expect.stringContaining("not a regular directory")]);
    expect(await readFile(ref, "utf8")).toBe(saved[3]);
  }, 90_000);
});
