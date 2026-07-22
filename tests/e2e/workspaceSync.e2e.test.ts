import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { expectInViewport, expectNoHorizontalOverflow, findVisibleTextLayoutDefects } from "./layoutAssertions";

const execFileAsync = promisify(execFile);
let root = "";
let app: ElectronApplication | undefined;

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Workspace Sync desktop flow", () => {
  it("publishes a deterministic Workspace through system Git at minimum desktop size", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-workspace-sync-e2e-"));
    const remote = join(root, "workspace.git");
    await execFileAsync("/usr/bin/git", ["init", "--bare", remote]);
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: ["."],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_DATA_ROOT: join(root, "data"),
        AGENTENV_CACHE_ROOT: join(root, "cache"),
        AGENTENV_HOME: home
      }
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 920, height: 620 });
    await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus()), {
      timeout: 15_000
    }).toEqual({ state: "ready" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const section = page.getByRole("region", { name: "Workspace Sync" });
    await section.waitFor({ state: "visible" });
    await section.getByLabel("Private Git repository").fill(remote);
    await section.getByLabel("Branch").fill("main");
    await section.getByRole("button", { name: "Connect repository" }).click();
    await expect.poll(() => section.getByText("Changes to publish").count()).toBe(1);

    await section.getByRole("button", { name: "Review changes" }).click();
    const review = page.getByRole("dialog", { name: "Review Workspace changes" });
    await review.waitFor({ state: "visible" });
    await expectInViewport(page, review);
    expect(await review.locator(".workspace-sync-change").count()).toBe(1);
    expect(await review.getByRole("button", { name: "Publish" }).getAttribute("class")).toContain("ui-button--primary");
    await review.getByRole("button", { name: "Publish" }).click();
    await expect.poll(() => section.getByText("Up to date").count(), { timeout: 15_000 }).toBe(1);

    await expectNoHorizontalOverflow(page);
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
    const remoteHead = (await execFileAsync("/usr/bin/git", ["--git-dir", remote, "rev-parse", "refs/heads/main"])).stdout.trim();
    expect(remoteHead).toMatch(/^[a-f0-9]{40}$/);
  }, 30_000);
});
