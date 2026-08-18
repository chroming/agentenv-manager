import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";

let root = "";
let app: ElectronApplication | undefined;
const run = promisify(execFile);

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

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
    await writeFile(brewPath, `#!/bin/sh\necho "$@" >> "${brewLog}"\nif [ "$1" = "upgrade" ]; then sleep 2; echo "0.2.0" > "${brewVersion}"; fi\nif [ "$1" = "list" ]; then echo "agentenv-manager $(cat "${brewVersion}")"; fi\nexit 0\n`);
    await chmod(brewPath, 0o755);
    await writeFile(releaseFixture, JSON.stringify({
      tag_name: "v0.2.0",
      html_url: "https://github.com/chroming/agentenv-manager/releases/tag/v0.2.0",
      draft: false,
      prerelease: false,
      published_at: "2026-08-03T00:00:00Z",
      body: "Verified update",
      assets: [{
        name: `AgentEnv-Manager-0.2.0-mac-${process.arch}.zip`,
        browser_download_url: `https://github.com/chroming/agentenv-manager/releases/download/v0.2.0/AgentEnv-Manager-0.2.0-mac-${process.arch}.zip`,
        digest: `sha256:${"a".repeat(64)}`,
        size: 123
      }]
    }));

    const launch = (appVersion = "0.1.0") => electron.launch({
      executablePath: electronPath as unknown as string,
      args: [
        `--user-data-dir=${join(root, "electron-user-data")}`,
        join(process.cwd(), "out", "main", "main.js")
      ],
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_AUTOMATION_POSTHOG_PROJECT_TOKEN: "phc_e2e_consent_only",
        AGENTENV_AUTOMATION_UPDATE_PACKAGED: "1",
        AGENTENV_AUTOMATION_APP_VERSION: appVersion,
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
    const telemetryDialog = page.getByRole("dialog", { name: "Anonymous usage statistics" });
    await telemetryDialog.waitFor({ state: "visible", timeout: 5_000 });
    await expect(fileExists(join(dataRoot, "telemetry-state.json"))).resolves.toBe(false);
    await telemetryDialog.getByRole("switch", { name: "Share anonymous usage statistics" }).click();
    await telemetryDialog.getByRole("button", { name: "Continue" }).click();
    await telemetryDialog.waitFor({ state: "hidden" });
    await expect.poll(async () =>
      JSON.parse(await readFile(join(dataRoot, "settings.json"), "utf8"))
    ).toMatchObject({ telemetryEnabled: false, telemetryConsentVersion: 1 });
    await expect(fileExists(join(dataRoot, "telemetry-state.json"))).resolves.toBe(false);
    await page.getByRole("complementary", { name: "Global navigation" })
      .getByRole("button", { name: "Settings" })
      .click({ timeout: 5_000 });
    await page.getByText("Installed with Homebrew").waitFor({ timeout: 5_000 });
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByText("Shares one anonymous startup event per day. Turn it off at any time.")
      .waitFor({ timeout: 5_000 });
    await expect.poll(() =>
      page.getByRole("switch", { name: "Share anonymous usage statistics" }).isDisabled()
    ).toBe(false);
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
    await expect.poll(() => app?.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById("app.check-for-updates")?.label
    )).toBe("Restart to Update to 0.2.0…");
    await page.getByText("Version 0.2.0 is ready to install").waitFor({ timeout: 5_000 });
    await expect.poll(() => readFile(brewLog, "utf8")).toContain(
      "fetch --cask chroming/tap/agentenv-manager"
    );

    await page.getByRole("switch", { name: "Automatic update checks" }).click();
    await expect.poll(async () =>
      JSON.parse(await readFile(join(dataRoot, "settings.json"), "utf8"))
        .appUpdateAutoCheckEnabled
    ).toBe(false);

    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await expect.poll(() => app?.windows().length ?? 0, { timeout: 1_500 }).toBe(0);
    await expect(readFile(brewVersion, "utf8")).resolves.toBe("0.1.0\n");
    app = undefined;
    await expect.poll(
      () => readFile(brewLog, "utf8"),
      { timeout: 10_000 }
    ).toContain(
      `upgrade --cask --appdir=${applicationDirectory} chroming/tap/agentenv-manager`
    );
    await expect.poll(() => readFile(brewVersion, "utf8"), { timeout: 10_000 }).toBe("0.2.0\n");
    app = await launch("0.2.0");
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
    await page.getByText("Finish updates after quitting").waitFor({
      state: "visible",
      timeout: 5_000
    });
    await page.getByRole("tab", { name: "Data" }).click();
    await expect.poll(() =>
      page.getByRole("switch", { name: "Share anonymous usage statistics" })
        .getAttribute("aria-checked")
    ).toBe("false");
  }, 60_000);

  it("downloads and verifies an official direct-install ZIP in the packaged lifecycle", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-direct-app-update-"));
    const dataRoot = join(root, "data");
    const homeRoot = join(root, "home");
    const agentBinRoot = join(root, "agent-bin");
    const applicationPath = join(homeRoot, "Applications", "AgentEnv Manager.app");
    const candidatePath = join(root, "candidate", "AgentEnv Manager.app");
    const candidateExecutable = join(candidatePath, "Contents", "MacOS", "AgentEnv Manager");
    const archivePath = join(root, `AgentEnv-Manager-0.2.0-mac-${process.arch}.zip`);
    const releaseFixture = join(root, "release.json");
    const brewPath = join(root, "brew");
    await Promise.all([
      mkdir(applicationPath, { recursive: true }),
      mkdir(join(candidatePath, "Contents", "MacOS"), { recursive: true }),
      mkdir(agentBinRoot, { recursive: true })
    ]);
    await writeFile(join(candidatePath, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.github.chroming.agentenvmanager</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>CFBundleExecutable</key><string>AgentEnv Manager</string>
</dict></plist>\n`);
    await writeFile(candidateExecutable, "#!/bin/sh\nexit 0\n");
    await chmod(candidateExecutable, 0o755);
    await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", candidatePath]);
    await run("/usr/bin/ditto", [
      "-c", "-k", "--sequesterRsrc", "--keepParent", candidatePath, archivePath
    ]);
    const archive = await readFile(archivePath);
    await writeFile(brewPath, "#!/bin/sh\nexit 1\n");
    await chmod(brewPath, 0o755);
    await writeFile(releaseFixture, JSON.stringify({
      tag_name: "v0.2.0",
      html_url: "https://github.com/chroming/agentenv-manager/releases/tag/v0.2.0",
      draft: false,
      prerelease: false,
      published_at: "2026-08-09T00:00:00Z",
      body: "Verified direct update",
      assets: [{
        name: `AgentEnv-Manager-0.2.0-mac-${process.arch}.zip`,
        browser_download_url: `https://github.com/chroming/agentenv-manager/releases/download/v0.2.0/AgentEnv-Manager-0.2.0-mac-${process.arch}.zip`,
        digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`,
        size: archive.byteLength
      }]
    }));

    app = await electron.launch({
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
        AGENTENV_AUTOMATION_APP_PATH: applicationPath,
        AGENTENV_AUTOMATION_UPDATE_FIXTURE: releaseFixture,
        AGENTENV_AUTOMATION_UPDATE_ASSET: archivePath,
        AGENTENV_AUTOMATION_BREW_PATH: brewPath,
        AGENTENV_AUTOMATION_TARGET_PATH: agentBinRoot,
        AGENTENV_DATA_ROOT: dataRoot,
        AGENTENV_HOME: homeRoot
      }
    });
    const page = await app.firstWindow();
    await expect.poll(
      () => page.evaluate(() => window.agentEnv.readStartupStatus()),
      { timeout: 10_000 }
    ).toEqual({ state: "ready" });
    await page.getByRole("complementary", { name: "Global navigation" })
      .getByRole("button", { name: "Settings" })
      .click({ timeout: 5_000 });
    await page.getByText("Installed directly").waitFor({ timeout: 5_000 });
    await page.getByRole("button", { name: "Check now" }).click({ timeout: 5_000 });
    await expect.poll(
      () => page.evaluate(() => window.agentEnv.readAppUpdateStatus()),
      { timeout: 15_000 }
    ).toMatchObject({
      phase: "ready",
      installChannel: "direct",
      automaticInstallSupported: true,
      release: { version: "0.2.0" }
    });
    await page.getByText("Version 0.2.0 is ready to install").waitFor({ timeout: 5_000 });
    await expect.poll(() => page.getByText("Finish updates after quitting").count()).toBe(0);
  }, 60_000);
});
