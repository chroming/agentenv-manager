import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";

let root = "";
let app: ElectronApplication | undefined;

requireCurrentElectronBuild();

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe.skipIf(process.platform !== "darwin")("application updates", () => {
  it("checks the official fixture, prefetches with Homebrew, and persists preferences", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-app-updates-"));
    const dataRoot = join(root, "data");
    const homeRoot = join(root, "home");
    const agentBinRoot = join(root, "agent-bin");
    const applicationDirectory = join(homeRoot, "Applications");
    const brewLog = join(root, "brew.log");
    const brewVersion = join(root, "brew-version");
    const brewPath = join(root, "brew");
    const releaseFixture = join(root, "release.json");
    await Promise.all([
      mkdir(homeRoot, { recursive: true }),
      mkdir(agentBinRoot, { recursive: true })
    ]);
    await writeFile(brewVersion, "0.1.0\n");
    await writeFile(brewPath, `#!/bin/sh\necho "$@" >> "${brewLog}"\nif [ "$1" = "upgrade" ]; then echo "0.2.0" > "${brewVersion}"; fi\nif [ "$1" = "list" ]; then echo "agentenv-manager $(cat "${brewVersion}")"; fi\nexit 0\n`);
    await chmod(brewPath, 0o755);
    await writeFile(releaseFixture, JSON.stringify({
      tag_name: "v0.2.0",
      html_url: "https://github.com/chroming/agentenv-manager/releases/tag/v0.2.0",
      draft: false,
      prerelease: false,
      published_at: "2026-08-03T00:00:00Z",
      body: "Verified update",
      assets: [{
        name: `AgentEnv-Manager-0.2.0-mac-${process.arch}.dmg`,
        browser_download_url: `https://github.com/chroming/agentenv-manager/releases/download/v0.2.0/AgentEnv-Manager-0.2.0-mac-${process.arch}.dmg`,
        digest: `sha256:${"a".repeat(64)}`,
        size: 123
      }]
    }));

    const launch = () => electron.launch({
      executablePath: electronPath as unknown as string,
      args: [
        `--user-data-dir=${join(root, "electron-user-data")}`,
        join(process.cwd(), "out", "main", "main.js")
      ],
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_AUTOMATION_UPDATE_PACKAGED: "1",
        AGENTENV_AUTOMATION_APP_VERSION: "0.1.0",
        AGENTENV_AUTOMATION_APP_DIR: applicationDirectory,
        AGENTENV_AUTOMATION_UPDATE_FIXTURE: releaseFixture,
        AGENTENV_AUTOMATION_BREW_PATH: brewPath,
        AGENTENV_AUTOMATION_TARGET_PATH: agentBinRoot,
        AGENTENV_DATA_ROOT: dataRoot,
        AGENTENV_HOME: homeRoot
      }
    });

    app = await launch();
    let page = await app.firstWindow();
    await expect.poll(
      () => page.evaluate(() => window.agentEnv.readStartupStatus()),
      { timeout: 10_000 }
    ).toEqual({ state: "ready" });
    await page.getByRole("complementary", { name: "Global navigation" })
      .getByRole("button", { name: "Settings" })
      .click({ timeout: 5_000 });
    await page.getByText("Installed with Homebrew").waitFor({ timeout: 5_000 });
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByText("This build does not send anonymous usage statistics. Your preference is kept for future builds.")
      .waitFor({ timeout: 5_000 });
    await expect.poll(() =>
      page.getByRole("switch", { name: "Share anonymous usage statistics" }).isDisabled()
    ).toBe(false);
    await page.getByRole("switch", { name: "Share anonymous usage statistics" }).click();
    await expect.poll(async () =>
      JSON.parse(await readFile(join(dataRoot, "settings.json"), "utf8"))
        .telemetryEnabled
    ).toBe(false);
    await page.getByRole("tab", { name: "General" }).click();
    await page.getByRole("button", { name: "Check now" }).click({ timeout: 5_000 });
    await expect.poll(
      () => page.evaluate(() => window.agentEnv.readAppUpdateStatus()),
      { timeout: 5_000 }
    ).toMatchObject({ phase: "ready", release: { version: "0.2.0" } });
    await page.getByText("Version 0.2.0 is ready to install").waitFor({ timeout: 5_000 });
    await expect.poll(() => readFile(brewLog, "utf8")).toContain(
      "fetch --cask chroming/tap/agentenv-manager"
    );

    await page.getByRole("switch", { name: "Automatic update checks" }).click();
    await page.evaluate(() => window.agentEnv.updateSettings({ appUpdateInstallOnQuit: false }));
    await expect.poll(async () =>
      JSON.parse(await readFile(join(dataRoot, "settings.json"), "utf8"))
        .appUpdateAutoCheckEnabled
    ).toBe(false);

    await app.evaluate(({ app: electronApp }) => {
      (electronApp as unknown as { relaunch(): void }).relaunch = () => undefined;
    });
    await page.getByRole("button", { name: "Restart and update" }).click();
    await expect.poll(() => readFile(brewLog, "utf8")).toContain(
      `upgrade --cask --appdir=${applicationDirectory} chroming/tap/agentenv-manager`
    );
    await expect.poll(() => app?.windows().length ?? 0).toBe(0);
    app = undefined;
    app = await launch();
    page = await app.firstWindow();
    await expect.poll(
      () => page.evaluate(() => window.agentEnv.readStartupStatus()),
      { timeout: 10_000 }
    ).toEqual({ state: "ready" });
    await page.getByRole("complementary", { name: "Global navigation" })
      .getByRole("button", { name: "Settings" })
      .click({ timeout: 5_000 });
    await expect.poll(() =>
      page.getByRole("switch", { name: "Automatic update checks" })
        .getAttribute("aria-checked")
    ).toBe("false");
    await page.getByRole("tab", { name: "Data" }).click();
    await expect.poll(() =>
      page.getByRole("switch", { name: "Share anonymous usage statistics" })
        .getAttribute("aria-checked")
    ).toBe("false");
  }, 60_000);
});
