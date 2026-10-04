import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication, type Locator } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { translate } from "../../src/renderer/i18n";
import { expectInViewport, expectNoHorizontalOverflow } from "./layoutAssertions";
import { requireCurrentElectronBuild } from "./currentBuild";

requireCurrentElectronBuild();
let root = "";
let app: ElectronApplication | undefined;
afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  root = "";
}, 30_000);
const json = async (path: string, value: unknown) => writeFile(path, JSON.stringify(value));

describe("Device-local catalog views", () => {
  it.each(["en", "zh_CN", "zh_TW"] as const)("keeps compact controls, projections and restart preferences consistent in %s", async (locale) => {
    const t = (message: string) => translate(locale, message);
    root = await mkdtemp(join(tmpdir(), "agentenv-catalog-views-"));
    const home = join(root, "home"), data = join(root, "data"), bin = join(root, "bin"), cache = join(root, "cache");
    await Promise.all([mkdir(home), mkdir(data), mkdir(bin), mkdir(join(cache, "skill-source-observations"), { recursive: true })]);
    await json(join(data, "agentenv-data.json"), { formatVersion: 2 });
    await json(join(data, "settings.json"), { locale, skillSyncMethod: "copy", skillManagementFormatVersion: 1,
      skillStorageLocation: "appData", skillAutoCheckEnabled: false, skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null, telemetryEnabled: false, enabledTargetIds: ["opencode"],
      agentDiscoveryVersion: 1, agentDiscoveryReviewedIds: ["opencode", "claude-code", "codex", "antigravity", "trae-cli", "pi", "workbuddy"] });
    const skillContents = new Map<string, string>();
    const sources = [];
    for (let index = 0; index < 3; index++) {
      const id = `Skill${index + 1}`, repository = join(home, `source-${index}`);
      await mkdir(repository);
      const canonicalLink = pathToFileURL(repository).href;
      const sourceId = `source-${createHash("sha256").update(`${repository}\0\0\0`).digest("hex").slice(0, 20)}`;
      const collection = { formatVersion: 1, kind: "local", repository, canonicalLink, ref: "", directory: "", sourceId, sourceSubpath: id };
      const skillDir = join(data, "skills-library", id);
      await mkdir(skillDir, { recursive: true });
      const content = `---\nname: ${id}\ndescription: Synthetic catalog fixture\n---\n# ${id}\n`;
      skillContents.set(join(skillDir, "SKILL.md"), content);
      await writeFile(join(skillDir, "SKILL.md"), content);
      await json(join(skillDir, ".agentenv-skill.json"), { sourceType: "local", source: repository,
        updatePolicy: "untracked", sourceCollection: collection,
        upstream: { kind: "local", locator: repository, updatedAt: `2026-09-0${index + 1}T00:00:00Z` } });
      sources.push({ ...collection, id: sourceId, displayName: `Source ${index + 1}`, automaticChecks: true,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
      await json(join(cache, "skill-source-observations", `${createHash("sha256").update(canonicalLink).digest("hex")}.json`), {
        ...collection, checkedAt: "2026-01-01T00:00:00Z", accessTransport: "file", complete: true,
        candidates: Array.from({ length: index + 1 }, (_, candidate) => ({ sourceSubpath: `new-${candidate}`, directory: `new-${candidate}`,
          name: `New ${candidate}`, description: "Synthetic", contentRevision: `revision-${candidate}`, validity: "valid" }))
      });
    }
    await json(join(data, "skill-sources.json"), { formatVersion: 1, sources });
    await json(join(data, "skill-groups.json"), { formatVersion: 1, groups: ["Zebra", "Alpha"].map((name) => ({
      formatVersion: 1, id: name.toLowerCase(), name, description: "", skillIds: ["Skill1"],
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" })) });
    for (const [index, name] of ["Alpha", "Zebra"].entries()) {
      const dir = join(data, "instructions-library", name.toLowerCase());
      await mkdir(dir, { recursive: true });
      await json(join(dir, "instruction.json"), { formatVersion: 1, id: name.toLowerCase(), name, description: "",
        createdAt: "2026-01-01T00:00:00Z", updatedAt: `2026-09-0${index + 1}T00:00:00Z` });
      await writeFile(join(dir, "CONTENT.md"), `# ${name}\nSynthetic instructions.\n`);
    }
    const profileDir = join(data, "profiles", "daily");
    await mkdir(profileDir, { recursive: true });
    await json(join(profileDir, "profile.json"), { id: "daily", name: "Daily", description: "", version: 2 });
    await writeFile(join(profileDir, "INSTRUCTIONS.md"), "");
    await json(join(profileDir, "resources.json"), { skills: [{ libraryId: "Skill2", targetName: "Skill2", enabled: true }], instructions: [{ libraryId: "alpha", enabled: true }], mcpByTarget: {} });
    for (const [index, createdAt] of ["2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z"].entries()) {
      const id = createdAt.replaceAll(":", "-").replace("Z", "-000Z");
      const dir = join(data, "backups", id);
      await mkdir(join(dir, "files"), { recursive: true });
      await json(join(dir, "manifest.json"), { id, createdAt, operation: "apply", targetId: "opencode",
        profileId: "daily", profileName: `Recovery ${index + 1}`, entries: [] });
    }
    const executable = join(bin, "opencode");
    await writeFile(executable, "#!/bin/sh\nexit 0\n"); await chmod(executable, 0o755);
    const launch = () => electron.launch({ executablePath: electronPath as unknown as string,
      args: ["--disable-gpu", "--force-device-scale-factor=1", `--user-data-dir=${join(root, "electron")}`, join(process.cwd(), "out", "main", "main.js")],
      env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: data, AGENTENV_CACHE_ROOT: cache,
        AGENTENV_LOG_ROOT: join(root, "logs"), AGENTENV_FAKE_HOME: join(root, "fake-home"), AGENTENV_HOME: home,
        AGENTENV_AUTOMATION_TARGET_PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` }
    });
    app = await launch();
    let page = await app.firstWindow();
    const nav = (label: string) => page.getByRole("complementary", { name: t("Global navigation") }).getByRole("button", { name: t(label), exact: true });
    const chooseSort = async (label: string, option: string) => {
      await page.getByRole("button", { name: new RegExp(`^${t(label)}:`) }).click();
      await expectInViewport(page, page.getByRole("menu", { name: t(label), exact: true }));
      await capture(`menu-${label.replaceAll(" ", "-")}-${page.viewportSize()?.width}`);
      await page.getByRole("menuitemradio", { name: t(option), exact: true }).click();
      await page.mouse.move(0, 0);
    };
    const capture = async (name: string) => {
      if (!process.env.AGENTENV_CAPTURE_CATALOG_DIR) return;
      await mkdir(process.env.AGENTENV_CAPTURE_CATALOG_DIR, { recursive: true });
      await page.mouse.move(0, 0);
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement && !document.activeElement.closest('[role="menu"], .ui-filter-popover__panel')) document.activeElement.blur(); });
      await expect.poll(() => page.getByRole("tooltip").count()).toBe(0);
      await page.screenshot({ path: join(process.env.AGENTENV_CAPTURE_CATALOG_DIR, `${name}-${locale}.png`) });
    };
    const expectAdjacentControls = async (first: Locator, second: Locator) => {
      const a = (await first.boundingBox())!, b = (await second.boundingBox())!;
      expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThanOrEqual(1);
      expect(b.x - a.x - a.width).toBeGreaterThanOrEqual(0);
      expect(b.x - a.x - a.width).toBeLessThanOrEqual(12);
    };
    for (const width of [920, 1180, 1440]) {
      await page.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      await nav("Skills").click();
      await page.getByRole("tab", { name: t("Skill list"), exact: true }).click();
      await page.getByRole("button", { name: "Skill1", exact: true }).waitFor();
      await chooseSort("Sort Skills", "Source updated");
      expect(await page.locator(".library-table .library-skill-name-button").allTextContents()).toEqual(["Skill3", "Skill2", "Skill1"]);
      await expectNoHorizontalOverflow(page, [".library-toolbar"]);
      await capture(`skills-${width}`);
      await page.getByRole("tab", { name: t("By source"), exact: true }).click();
      await chooseSort("Sort sources", "Changes");
      await expectNoHorizontalOverflow(page, [".skill-source-toolbar"]);
      await capture(`sources-${width}`);
      await page.getByRole("tab", { name: t("Groups"), exact: true }).click();
      await chooseSort("Sort groups", "Updates");
      await expectNoHorizontalOverflow(page, [".skill-group-toolbar"]);
      await capture(`groups-${width}`);
      await nav("Instructions").click();
      await chooseSort("Sort Instructions", "Recently modified");
      await expectNoHorizontalOverflow(page, [".instructions-list-toolbar"]);
      const actions = page.locator(".instructions-list-toolbar__actions");
      await expectAdjacentControls(actions.getByRole("button", { name: new RegExp(`^${t("Sort Instructions")}:`) }),
        actions.getByRole("button", { name: new RegExp(`^${t("Filters")}`) }));
      await expectAdjacentControls(actions.getByRole("button", { name: t("New"), exact: true }),
        actions.getByRole("button", { name: t("More"), exact: true }));
      expect((await page.getByRole("searchbox", { name: t("Search Instructions") }).boundingBox())!.width).toBeGreaterThan(200);
      expect(await page.locator(".instructions-list-row .ui-selectable-row__title").allTextContents()).toEqual(["Zebra", "Alpha"]);
      await capture(`instructions-${width}`);
    }
    const instructions = page.locator(".instructions-list-pane");
    await instructions.getByRole("button", { name: new RegExp(`^${t("Filters")}`) }).click();
    await page.getByRole("combobox", { name: t("Instruction usage filter") }).selectOption("referenced");
    await page.keyboard.press("Escape");
    expect(await page.locator(".instructions-list-row .ui-selectable-row__title").allTextContents()).toEqual(["Alpha"]);
    await nav("Settings").click();
    await page.getByRole("tab", { name: t("Data"), exact: true }).click();
    await page.getByRole("button", { name: t("Manage"), exact: true }).click();
    const backups = page.getByRole("dialog", { name: t("Manage Backups"), exact: true });
    await backups.waitFor();
    await chooseSort("Sort backups", "Oldest first");
    for (const width of [920, 1440]) {
      await page.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      await expectAdjacentControls(backups.getByRole("button", { name: new RegExp(`^${t("Sort backups")}:`) }),
        backups.getByRole("button", { name: new RegExp(`^${t("Filters")}`) }));
      await backups.getByRole("button", { name: new RegExp(`^${t("Filters")}`) }).click();
      const filters = page.getByRole("dialog", { name: t("Filters"), exact: true });
      await expectInViewport(page, filters);
      await page.keyboard.press("Tab");
      expect(await page.getByRole("combobox", { name: t("Backup status filter") }).evaluate((element) => element === document.activeElement)).toBe(true);
      await page.getByRole("combobox", { name: t("Backup status filter") }).selectOption("eligible");
      await capture(`backup-filters-${width}`);
      await page.keyboard.press("Escape");
      expect(await backups.isVisible()).toBe(true);
      await expectNoHorizontalOverflow(page, [".backup-manager-dialog"]);
      await capture(`backups-${width}`);
    }
    await backups.getByRole("button", { name: t("Close"), exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(data, "ui-state.json"), "utf8"))).toMatchObject({ catalogViews: {
      skills: { sort: "source-updated" }, sources: { sort: "changes" }, groups: { sort: "updates" },
      instructions: { sort: "modified", usageFilter: "referenced" }, backups: { sort: "oldest", statusFilter: "eligible" }
    } });
    await app.close(); app = await launch(); page = await app.firstWindow();
    await nav("Instructions").click();
    await page.getByRole("button", { name: `${t("Sort Instructions")}: ${t("Recently modified")}`, exact: true }).waitFor();
    await page.locator(".instructions-list-row").waitFor();
    expect(await page.locator(".instructions-list-row .ui-selectable-row__title").allTextContents()).toEqual(["Alpha"]);
    for (const [path, content] of skillContents) expect(await readFile(path, "utf8")).toBe(content);
  }, 90_000);
});
