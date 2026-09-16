import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";
import { expectNoHorizontalOverflow, findVisibleTextLayoutDefects } from "./layoutAssertions";

requireCurrentElectronBuild();
let root = "";
let app: ElectronApplication | undefined;
afterEach(async () => { await app?.close().catch(() => undefined); if (root) await rm(root, { recursive: true, force: true }); });

it.skipIf(process.platform === "win32")("keeps device counts, refresh geometry and Conversations settings stable across window sizes", async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-refresh-layout-"));
  const home = join(root, "home"), data = join(root, "data"), bin = join(root, "bin");
  for (const path of [home, data, bin]) await mkdir(path, { recursive: true });
  await writeFile(join(data, "settings.json"), JSON.stringify({ locale: "en", enabledTargetIds: ["codex"], telemetryEnabled: false, skillAutoCheckEnabled: false, agentDiscoveryVersion: 1, agentDiscoveryReviewedIds: ["codex"] }));
  await writeFile(join(bin, "codex"), "#!/bin/sh\nprintf 'codex-cli 0.148.0\\n'\n");
  await chmod(join(bin, "codex"), 0o755);
  await writeFile(join(bin, "ssh"), "#!/bin/sh\nprintf 'HOME\\t/home/demo\\nOS\\tLinux\\nARCH\\tx86_64\\nMACHINE\\tfixture\\nCMD\\tcodex\\t/usr/bin/codex\\n'\n");
  await chmod(join(bin, "ssh"), 0o755);
  await writeFile(join(data, "remote-devices.json"), JSON.stringify({ formatVersion: 1, devices: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Build server", host: "build.invalid", createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Test server", host: "test.invalid", createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z" }
  ] }));
  await mkdir(join(home, ".codex"), { recursive: true });
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [`--user-data-dir=${join(root, "electron")}`, "."], env: {
    ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ""), AGENTENV_AUTOMATION: "1", AGENTENV_AUTOMATION_TARGET_PATH: bin,
    AGENTENV_DATA_ROOT: data, AGENTENV_HOME: home, AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_LOG_ROOT: join(root, "logs")
  } });
  const page = await app.firstWindow();
  await page.locator(".target-card").first().waitFor();
  await expect.poll(() => page.getByRole("button", { name: "Show Remote Agents" }).innerText()).toBe("2");
  const output = process.env.AGENTENV_STATUS_CAPTURE_DIR ?? "/tmp/agentenv-refresh-layout";
  await mkdir(output, { recursive: true });
  for (const width of [920, 1180, 1440]) {
    await page.setViewportSize({ width, height: 620 });
    expect(await page.getByRole("button", { name: "Show Local Agents" }).innerText()).toBe("1");
    expect(await page.locator(".app-shell").evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
    const before = await page.locator(".target-card").first().boundingBox();
    await page.locator(".target-list__header").getByRole("button", { name: "Refresh", exact: true }).click();
    const during = await page.locator(".target-card").first().boundingBox();
    expect(during?.y).toBe(before?.y);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expectNoHorizontalOverflow(page);
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
    await page.screenshot({ path: join(output, `agents-${width}.png`), animations: "disabled" });
  }
  await page.getByRole("complementary", { name: "Global navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
  expect(await page.getByRole("button", { name: "Conversation sources", exact: true }).count()).toBe(0);
  await page.getByRole("tab", { name: "Conversations", exact: true }).click();
  await expect.poll(() => page.getByRole("tab", { name: "Conversations", exact: true }).getAttribute("aria-selected")).toBe("true");
  for (const width of [920, 1180, 1440]) {
    await page.setViewportSize({ width, height: 620 });
    await expectNoHorizontalOverflow(page);
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
    await page.screenshot({ path: join(output, `conversation-settings-${width}.png`), animations: "disabled" });
  }
  await page.getByRole("button", { name: "Conversation sources", exact: true }).click();
  await page.getByRole("dialog", { name: "Conversation sources", exact: true }).waitFor();
  await page.getByRole("dialog", { name: "Conversation sources", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await page.getByRole("combobox", { name: "Interface language" }).selectOption("zh_CN");
  await page.getByRole("tab", { name: "对话", exact: true }).click();
  await page.setViewportSize({ width: 920, height: 620 });
  await expectNoHorizontalOverflow(page);
  expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
  await page.screenshot({ path: join(output, "conversation-settings-zh-920.png"), animations: "disabled" });
}, 45_000);
