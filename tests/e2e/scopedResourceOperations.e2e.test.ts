import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createSkillGroupStore } from "../../src/main/skillGroupStore";
import { createTargetStateRepository } from "../../src/main/targetStateRepository";
import { translate } from "../../src/renderer/i18n";
import { requireCurrentElectronBuild } from "./currentBuild";
import { expectInViewport, expectNoHorizontalOverflow } from "./layoutAssertions";

requireCurrentElectronBuild();
let root = "", app: ElectronApplication | undefined;
afterEach(async () => {
  if (app) {
    const current = app; app = undefined;
    const timer = setTimeout(() => current.process().kill("SIGKILL"), 5000);
    try { await current.close(); } finally { clearTimeout(timer); }
  }
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 4 });
}, 30_000);

describe.skipIf(process.platform === "win32")("Scoped resource operations", () => {
  it("reviews referenced removal across desktop sizes/locales, shows stale errors inline and restores the whole transaction", async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "aem-scoped-ui-")));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const bin = join(root, "bin"); await mkdir(bin, { recursive: true });
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(join(paths.appDataRoot, "agentenv-data.json"), '{"formatVersion":2}');
    const settings = createSettingsStore(paths);
    await settings.updateSettings({ locale: "en", enabledTargetIds: ["codex"], agentDiscoveryVersion: 1,
      agentDiscoveryReviewedIds: ["codex", "claude-code", "opencode", "antigravity", "antigravity-app", "pi", "trae-cli", "workbuddy"],
      telemetryEnabled: false, telemetryConsentVersion: 1, skillAutoCheckEnabled: false, backupRetentionDays: null });
    await writeFile(join(bin, "codex"), "#!/bin/sh\necho 'codex-cli 0.100.0'\n"); await chmod(join(bin, "codex"), 0o755);
    const source = join(root, "source"); await mkdir(source);
    await writeFile(join(source, "SKILL.md"), "---\nname: review\ndescription: Synthetic review\n---\nReview safely\n");
    const library = createSkillLibraryStore(paths, settings);
    await library.importSkill({ id: "review", sourcePath: source });
    const group = await createSkillGroupStore(paths.skillGroupsPath, () => library.listSkills())
      .create({ name: "A reusable review group", description: "", skillIds: ["review"] });
    const profilePath = join(paths.profilesDir, "daily"); await mkdir(profilePath, { recursive: true });
    await writeFile(join(profilePath, "profile.json"), JSON.stringify({ version: 2, id: "daily", name: "Daily synthetic review setup", description: "" }));
    await writeFile(join(profilePath, "INSTRUCTIONS.md"), "");
    await writeFile(join(profilePath, "resources.json"), JSON.stringify({ skills: [{ libraryId: "review", targetName: "review", enabled: true }], mcpByTarget: {} }));
    const copy = join(paths.codexHome, "skills", "review"); await mkdir(join(copy, ".."), { recursive: true });
    await cp(join(paths.skillsLibraryDir, "review"), copy, { recursive: true });
    await createTargetStateRepository(paths).write("codex", { managedMcpNames: [], managedResources: [{
      kind: "skill", id: "review", source: "skills-library/review", path: copy, contentHash: "fixture"
    }] });
    app = await electron.launch({ executablePath: electronPath as unknown as string,
      args: ["--disable-gpu", "--force-device-scale-factor=1", `--user-data-dir=${join(root, "electron")}`, join(process.cwd(), "out/main/main.js")],
      env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: paths.appDataRoot,
        AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_LOG_ROOT: join(root, "logs"), AGENTENV_HOME: paths.homeDir,
        AGENTENV_FAKE_HOME: join(root, "fake"), AGENTENV_AUTOMATION_TARGET_PATH: bin, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` } });
    const page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus())).toEqual({ state: "ready" });
    const captureDir = process.env.AGENTENV_CAPTURE_SCOPED_DIR;
    if (captureDir) await mkdir(captureDir, { recursive: true });
    for (const locale of ["en", "zh_CN", "zh_TW"] as const) {
      await page.evaluate((locale) => window.agentEnv.updateSettings({ locale }), locale); await page.reload();
      const t = (key: string) => translate(locale, key);
      await page.getByRole("complementary", { name: t("Global navigation") }).getByRole("button", { name: t("Skills"), exact: true }).click();
      for (const width of [920, 1180, 1440]) {
        await page.setViewportSize({ width, height: width === 920 ? 620 : 900 });
        const row = page.getByRole("group", { name: translate(locale, "Library item {{id}}", { id: "review" }) });
        await row.getByRole("button", { name: translate(locale, "More actions for {{id}}", { id: "review" }) }).click();
        await page.getByRole("menuitem", { name: new RegExp(t("Remove from library")) }).click();
        const dialog = page.getByRole("dialog", { name: t("Remove from library"), exact: true });
        await dialog.getByText("Daily synthetic review setup", { exact: true }).waitFor();
        await dialog.getByText(group.name, { exact: true }).waitFor();
        await expectInViewport(page, dialog); await expectNoHorizontalOverflow(page);
        const button = dialog.getByRole("button", { name: t("Remove skill and installs"), exact: true });
        expect(await button.isEnabled()).toBe(true);
        if (captureDir) { await page.mouse.move(0, 0); await page.screenshot({ path: join(captureDir, `removal-${locale}-${width}.png`), animations: "disabled" }); }
        if (locale === "en" && width === 920) {
          await writeFile(join(copy, "external-note.md"), "Keep my new work");
          await button.click();
          await dialog.getByText(/Skill removal changed after preview/).waitFor();
          await dialog.getByRole("button", { name: t("Copy details"), exact: true }).click();
          await dialog.getByRole("button", { name: t("Copied"), exact: true }).waitFor();
          expect(await app!.evaluate(({ clipboard }) => clipboard.readText())).toContain("skills:remove-library");
          expect(await readFile(join(copy, "external-note.md"), "utf8")).toBe("Keep my new work");
          if (captureDir) await page.screenshot({ path: join(captureDir, "removal-inline-error-en-920.png"), animations: "disabled" });
          await dialog.getByRole("button", { name: t("Review again"), exact: true }).click();
          await expect.poll(() => button.isEnabled()).toBe(true);
        }
        await dialog.getByRole("button", { name: t("Cancel"), exact: true }).click();
      }
    }
    const preview = await page.evaluate(() => window.agentEnv.previewRemoveLibrarySkill("review"));
    const result = await page.evaluate((previewId) => window.agentEnv.removeSkillFromLibrary("review", previewId), preview.previewId);
    await expect(lstat(copy)).rejects.toMatchObject({ code: "ENOENT" });
    const resources = () => readFile(join(profilePath, "resources.json"), "utf8").then(JSON.parse);
    expect((await resources()).skills).toEqual([]);
    await page.evaluate((id) => window.agentEnv.rollbackSkillCleanup(id), result.backupId);
    expect((await resources()).skills[0].libraryId).toBe("review");
    expect(await readFile(join(copy, "SKILL.md"), "utf8")).toContain("Review safely");
    expect((await page.evaluate(() => window.agentEnv.listSkillGroups()))[0].skillIds).toEqual(["review"]);

    await page.evaluate(() => window.agentEnv.updateSettings({ locale: "en" }));
    await page.reload();
    await page.getByRole("complementary", { name: "Global navigation" }).getByRole("button", { name: "Profiles", exact: true }).click();
    await page.getByRole("button", { name: "Choose Profile", exact: true }).click();
    await page.getByRole("dialog", { name: "Choose Profile", exact: true }).getByRole("button", { name: "New Profile", exact: true }).click();
    const create = page.getByRole("dialog", { name: "New Profile", exact: true });
    await create.getByLabel("Profile name").fill("Saved without readback");
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("profiles:list");
      ipcMain.handle("profiles:list", () => { throw new Error("Synthetic Profile list unavailable"); });
    });
    await create.getByRole("button", { name: "Create", exact: true }).click();
    await create.waitFor({ state: "hidden" });
    await page.getByRole("heading", { name: "Saved without readback", exact: true }).waitFor();
    const notice = page.locator(".app-feedback--warning");
    await notice.getByText("Changes saved; view refresh failed", { exact: true }).waitFor();
    const manifests = await Promise.all((await readdir(paths.profilesDir)).map((id) =>
      readFile(join(paths.profilesDir, id, "profile.json"), "utf8").then(JSON.parse)));
    expect(manifests.filter((manifest) => manifest.name === "Saved without readback")).toHaveLength(1);
    for (const width of [920, 1180, 1440]) {
      await page.setViewportSize({ width, height: width === 920 ? 620 : 900 });
      await expectInViewport(page, notice);
      expect(await notice.getByRole("button", { name: "Refresh", exact: true }).isEnabled()).toBe(true);
      if (captureDir) await page.screenshot({ path: join(captureDir, `readback-warning-en-${width}.png`), animations: "disabled" });
    }
  }, 90_000);
});
