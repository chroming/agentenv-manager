import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectInViewport,
  expectNoHorizontalOverflow,
  expectStructuredDialog,
  expectTopmost,
  findVisibleTextLayoutDefects
} from "./layoutAssertions";
import { requireCurrentElectronBuild } from "./currentBuild";

const execFileAsync = promisify(execFile);
let root = "";
let app: ElectronApplication | undefined;

requireCurrentElectronBuild();

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
    const dataRoot = join(root, "data");
    await mkdir(home, { recursive: true });
    const profileRoot = join(dataRoot, "profiles", "portable-workspace");
    await mkdir(profileRoot, { recursive: true });
    await writeFile(
      join(dataRoot, "agentenv-data.json"),
      `${JSON.stringify({ formatVersion: 2 }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      join(profileRoot, "profile.json"),
      `${JSON.stringify({
        id: "portable-workspace",
        name: "Portable Workspace",
        description: "Workspace Sync e2e fixture",
        preferredTargetId: "opencode",
        version: 2
      }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      join(profileRoot, "INSTRUCTIONS.md"),
      "# Portable Workspace\n",
      "utf8"
    );
    await writeFile(
      join(profileRoot, "resources.json"),
      `${JSON.stringify({ skills: [], managementByTarget: {}, mcpByTarget: {} }, null, 2)}\n`,
      "utf8"
    );
    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [`--user-data-dir=${join(root, "electron-user-data")}`, "."],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_AUTOMATION_TARGET_PATH: join(root, "agent-bin"),
        AGENTENV_DATA_ROOT: dataRoot,
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
    await page.getByRole("tab", { name: "Connections" }).click();
    const section = page.getByRole("region", { name: "Device Sync" });
    await section.waitFor({ state: "visible" });
    await section.getByRole("button", { name: "Set up" }).click();
    await section.getByLabel("Private Git repository").fill(remote);
    await section.getByLabel("Branch").fill("main");
    await section.getByRole("button", { name: "Connect repository" }).click();
    await expect.poll(() => section.getByText("Changes to publish").count()).toBe(1);

    await section.getByRole("button", { name: "Publish" }).click();
    const review = page.getByRole("dialog", { name: "Review Device Sync changes" });
    await review.waitFor({ state: "visible" });
    await expectInViewport(page, review);
    await expectStructuredDialog(review);
    await expectTopmost(review);
    expect(await review.locator(".workspace-sync-change").count()).toBe(3);
    expect(await review.getByRole("button", { name: "Publish" }).getAttribute("class")).toContain("ui-button--primary");
    await review.getByRole("button", { name: "Publish" }).click();
    await expect.poll(() => section.getByText("Up to date").count(), { timeout: 15_000 }).toBe(1);

    await expectNoHorizontalOverflow(page);
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
    const remoteHead = (await execFileAsync("/usr/bin/git", ["--git-dir", remote, "rev-parse", "refs/heads/main"])).stdout.trim();
    expect(remoteHead).toMatch(/^[a-f0-9]{40}$/);

    await app.close();
    app = undefined;
    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [`--user-data-dir=${join(root, "electron-user-data-restart")}`, "."],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_AUTOMATION_TARGET_PATH: join(root, "agent-bin"),
        AGENTENV_DATA_ROOT: dataRoot,
        AGENTENV_CACHE_ROOT: join(root, "cache"),
        AGENTENV_HOME: home
      }
    });
    const restartedPage = await app.firstWindow();
    await restartedPage.setViewportSize({ width: 920, height: 620 });
    await expect.poll(() => restartedPage.evaluate(
      () => window.agentEnv.readStartupStatus()
    )).toEqual({ state: "ready" });
    await restartedPage.getByRole("button", { name: "Settings", exact: true }).click();
    await restartedPage.getByRole("tab", { name: "Connections" }).click();
    const restartedSection = restartedPage.getByRole("region", { name: "Device Sync" });
    await expect.poll(() => restartedPage.evaluate(
      () => window.agentEnv.readWorkspaceSyncStatus()
    )).toMatchObject({
      connection: {
        repository: remote,
        branch: "main"
      }
    });
    await expect.poll(
      () => restartedSection.getByRole("button", { name: "Set up" }).count(),
      { timeout: 15_000 }
    ).toBe(0);
    await expectNoHorizontalOverflow(restartedPage);

    await app.close();
    app = undefined;
    const receivingDataRoot = join(root, "receiving-data");
    await mkdir(receivingDataRoot, { recursive: true });
    await writeFile(
      join(receivingDataRoot, "agentenv-data.json"),
      `${JSON.stringify({ formatVersion: 2 }, null, 2)}\n`,
      "utf8"
    );
    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [`--user-data-dir=${join(root, "electron-user-data-receiving")}`, "."],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_AUTOMATION_TARGET_PATH: join(root, "agent-bin"),
        AGENTENV_DATA_ROOT: receivingDataRoot,
        AGENTENV_CACHE_ROOT: join(root, "receiving-cache"),
        AGENTENV_HOME: join(root, "receiving-home")
      }
    });
    const receivingPage = await app.firstWindow();
    await receivingPage.setViewportSize({ width: 920, height: 620 });
    await expect.poll(() => receivingPage.evaluate(
      () => window.agentEnv.readStartupStatus()
    )).toEqual({ state: "ready" });
    await expect(receivingPage.evaluate(
      ({ repository }) => window.agentEnv.connectWorkspaceSync({ repository, branch: "main" }),
      { repository: remote }
    )).resolves.toMatchObject({ kind: "remote-changes" });
    await receivingPage.getByRole("button", { name: "Settings", exact: true }).click();
    await receivingPage.getByRole("tab", { name: "Connections" }).click();
    const receivingSection = receivingPage.getByRole("region", { name: "Device Sync" });
    await expect.poll(() => receivingSection.getByText("Changes to receive").count(), {
      timeout: 15_000
    }).toBe(1);
    await receivingSection.getByRole("button", { name: "Update this device" }).click();
    const updateReview = receivingPage.getByRole("dialog", {
      name: "Review Device Sync changes"
    });
    await updateReview.getByRole("button", { name: "Update this device" }).click();
    await expect.poll(() => receivingSection.getByText("Up to date").count(), {
      timeout: 15_000
    }).toBe(1);

    await receivingPage.getByRole("button", { name: "Profiles", exact: true }).click();
    await receivingPage.getByRole("button", { name: "Choose Profile" }).click();
    await receivingPage.getByRole("option", {
      name: "Profile Portable Workspace"
    }).waitFor({ state: "visible" });
  }, 50_000);
});
