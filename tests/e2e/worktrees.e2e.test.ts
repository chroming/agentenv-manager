import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";

const run = promisify(execFile);
let root = "";
let app: ElectronApplication | undefined;
requireCurrentElectronBuild();

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  root = "";
}, 30_000);

describe("Worktrees desktop workflow", () => {
  it("shows local linked worktrees in a scrollable dialog at minimum and regular sizes", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-worktrees-e2e-"));
    const home = join(root, "home");
    const data = join(root, "data");
    const bin = join(root, "bin");
    const repo = join(root, "project");
    const linked = join(root, "_worktrees", "review-change");
    await Promise.all([mkdir(home), mkdir(data), mkdir(bin)]);
    await run("git", ["init", repo]);
    await writeFile(join(repo, "README.md"), "base\n");
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", "base"]);
    await run("git", ["-C", repo, "worktree", "add", "-b", "review-change", linked]);
    await writeFile(join(data, "agentenv-data.json"), '{"formatVersion":2}\n');
    await writeFile(join(data, "worktree-locations.json"), `${JSON.stringify({ formatVersion: 1, scanRoots: [root], kept: {} })}\n`);
    await writeFile(join(data, "settings.json"), `${JSON.stringify({
      locale: "en", conversationTerminal: "default", skillSyncMethod: "copy",
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
    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: ["--disable-gpu", "--force-device-scale-factor=1", `--user-data-dir=${join(root, "electron")}`,
        join(process.cwd(), "out", "main", "main.js")],
      env: {
        ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: data,
        AGENTENV_FAKE_HOME: join(root, "fake-home"), AGENTENV_HOME: home,
        AGENTENV_AUTOMATION_TARGET_PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`
      }
    });
    const page = await app.firstWindow();
    const notNow = page.getByRole("button", { name: "Not now", exact: true });
    if (await notNow.isVisible().catch(() => false)) await notNow.click();
    await page.getByRole("button", { name: "Workspaces", exact: true }).click();
    await page.getByRole("button", { name: "Worktrees", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Worktrees" });
    await dialog.getByText(linked).waitFor();
    for (const viewport of [{ width: 920, height: 620 }, { width: 1180, height: 728 }]) {
      await page.setViewportSize(viewport);
      const geometry = await dialog.evaluate((element) => {
        const frame = element.getBoundingClientRect();
        const body = element.querySelector(".worktree-dialog__body")!;
        return {
          withinWindow: frame.left >= 0 && frame.right <= window.innerWidth &&
            frame.top >= 0 && frame.bottom <= window.innerHeight,
          bodyFits: body.clientWidth + 1 >= body.scrollWidth
        };
      });
      expect(geometry.withinWindow).toBe(true);
      expect(geometry.bodyFits).toBe(true);
      const captureDir = process.env.AGENTENV_CAPTURE_WORKTREES_DIR;
      if (captureDir) {
        await mkdir(captureDir, { recursive: true });
        await page.screenshot({ path: join(captureDir, `worktrees-${viewport.width}.png`) });
      }
    }
    const linkedRow = dialog.locator(".ui-resource-row").filter({ hasText: "review-change" });
    await linkedRow.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Review cleanup" }).click();
    await dialog.getByRole("button", { name: "Remove Worktrees" }).click();
    await dialog.getByText(/Removed: .*review-change/).waitFor();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await dialog.getByRole("button", { name: "Worktree recovery" }).click();
    await page.getByRole("dialog", { name: "Worktree recovery" })
      .getByRole("button", { name: "Restore", exact: true }).click();
    await expect.poll(() => readFile(join(linked, "README.md"), "utf8")).toBe("base\n");
  }, 90_000);
});
