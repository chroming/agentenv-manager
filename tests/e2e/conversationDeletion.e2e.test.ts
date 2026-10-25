import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { translate } from "../../src/renderer/i18n";
import { requireCurrentElectronBuild } from "./currentBuild";
import { expectInViewport, expectNoHorizontalOverflow } from "./layoutAssertions";

requireCurrentElectronBuild();
let root = "";
let app: ElectronApplication | undefined;
const closeApp = async () => {
  if (!app) return;
  const current = app; app = undefined;
  const timer = setTimeout(() => current.process().kill("SIGKILL"), 5000);
  try { await current.close(); } catch { /* The test process may already have exited. */ }
  finally { clearTimeout(timer); }
};
afterEach(async () => {
  await closeApp();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 4 });
}, 30_000);

describe.skipIf(process.platform === "win32")("Conversation deletion and shared recovery UI", () => {
  it.each(["en", "zh_CN"] as const)("previews, deletes, restores and reindexes in %s", async (locale) => {
    const t = (key: string) => translate(locale, key);
    root = await realpath(await mkdtemp(join(tmpdir(), "aem-delete-ui-")));
    const home = join(root, "home"), data = join(root, "data"), cache = join(root, "cache"), bin = join(root, "bin");
    const history = join(home, ".codex", "sessions");
    await Promise.all([mkdir(history, { recursive: true }), mkdir(data), mkdir(cache), mkdir(bin)]);
    await writeFile(join(data, "agentenv-data.json"), JSON.stringify({formatVersion:2}));
    await writeFile(join(data, "settings.json"), JSON.stringify({ locale, enabledTargetIds:["codex"], agentDiscoveryVersion:1,
      agentDiscoveryReviewedIds:["codex","claude-code","opencode","antigravity","antigravity-app","pi","trae-cli","workbuddy"],
      telemetryEnabled:false, telemetryConsentVersion:1, skillAutoCheckEnabled:false, backupRetentionDays:null, deletedConversationRetentionDays:null }));
    const file = join(history, "rollout-session-1.jsonl");
    const transcript = [{type:"session_meta",payload:{id:"session-1",cwd:"/example/project"}},
      {type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"Synthetic deletion example"}]}},
      {type:"response_item",payload:{type:"message",role:"assistant",content:[{type:"output_text",text:"A preserved fixture reply."}]}}
    ].map((r) => JSON.stringify(r)).join("\n");
    await writeFile(file, transcript); await utimes(file, new Date(0), new Date(0));
    const executable = join(bin, "codex");
    await writeFile(executable, "#!/bin/sh\necho 'codex-cli 0.100.0'\n"); await chmod(executable, 0o755);
    const launch = () => electron.launch({executablePath:electronPath as unknown as string,
      args:["--disable-gpu", "--force-device-scale-factor=1", `--user-data-dir=${join(root,"electron")}`, join(process.cwd(),"out/main/main.js")],
      env:{...process.env, AGENTENV_AUTOMATION:"1", AGENTENV_DATA_ROOT:data, AGENTENV_CACHE_ROOT:cache, AGENTENV_LOG_ROOT:join(root,"logs"), AGENTENV_HOME:home, AGENTENV_FAKE_HOME:join(root,"fake-home"), AGENTENV_AUTOMATION_TARGET_PATH:bin, PATH:`${bin}${delimiter}${process.env.PATH ?? ""}`}});
    app = await launch();
    let page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.agentEnv));
    await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus())).toEqual({state:"ready"});
    await page.evaluate(async () => {
      const status = await window.agentEnv.conversationHistoryStatus();
      const sources = status.availableSources.filter((s) => s.deviceId === "local" && s.agentId === "codex").map(({ deviceName, agentName, ...source }) => source);
      await window.agentEnv.configureConversationHistory({version:1,enabled:true,paused:false,sources});
      await window.agentEnv.refreshConversations();
    });
    const nav = () => page.getByRole("complementary",{name:t("Global navigation")}).getByRole("button",{name:t("Conversations"),exact:true});
    await nav().click();
    const capture = async (name: string) => {
      if (!process.env.AGENTENV_CAPTURE_DELETION_DIR) return;
      await mkdir(process.env.AGENTENV_CAPTURE_DELETION_DIR,{recursive:true});
      await page.mouse.move(0,0);
      await page.screenshot({path:join(process.env.AGENTENV_CAPTURE_DELETION_DIR,`${name}-${locale}-full.png`),animations:"disabled"});
      await page.getByRole("dialog").screenshot({path:join(process.env.AGENTENV_CAPTURE_DELETION_DIR,`${name}-${locale}.png`),animations:"disabled",
        maskColor:"#eff1f3",mask:[page.locator(".backup-row-copy small:visible"),page.locator(".backup-preview-file code:visible"),page.locator(".backup-preview-header ~ footer > span:visible")]});
    };
    for (const width of [920,1180,1440]) {
      await page.setViewportSize({width,height:width === 920 ? 620 : 900});
      await page.getByRole("option").filter({hasText:"Synthetic deletion example"}).click({button:"right"});
      await page.getByRole("menuitem",{name:t("Delete conversation…"),exact:true}).click();
      const dialog = page.getByRole("dialog",{name:t("Delete conversation?"),exact:true});
      await dialog.getByRole("button",{name:t("Delete conversation"),exact:true}).waitFor();
      await expect.poll(() => dialog.getByRole("button",{name:t("Delete conversation"),exact:true}).isEnabled()).toBe(true);
      await expectInViewport(page,dialog); await expectNoHorizontalOverflow(page);
      await capture(`conversation-delete-${width}`);
      if (width !== 1440) await dialog.getByRole("button",{name:t("Cancel"),exact:true}).click();
      else await dialog.getByRole("button",{name:t("Delete conversation"),exact:true}).click();
    }
    await expect.poll(() => stat(file).then(() => true, () => false)).toBe(false);
    expect(await page.evaluate(() => window.agentEnv.searchConversations({query:"Synthetic deletion example"}))).toHaveLength(0);
    await page.getByRole("button",{name:t("Undo"),exact:true}).click();
    await expect.poll(() => readFile(file,"utf8").catch(() => "")).toBe(transcript);
    await page.getByRole("option").filter({hasText:"Synthetic deletion example"}).waitFor();
    await utimes(file,new Date(0),new Date(0));
    await page.getByRole("option").filter({hasText:"Synthetic deletion example"}).click({button:"right"});
    await page.getByRole("menuitem",{name:t("Delete conversation…"),exact:true}).click();
    await page.getByRole("dialog",{name:t("Delete conversation?"),exact:true}).getByRole("button",{name:t("Delete conversation"),exact:true}).click();
    await expect.poll(() => stat(file).then(() => true, () => false)).toBe(false);
    // A fresh Electron process must expose the persisted recovery record.
    await closeApp(); app = await launch(); page = await app.firstWindow();
    await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus())).toEqual({state:"ready"});
    await nav().click();
    if (locale === "en") {
      await page.getByRole("complementary",{name:t("Global navigation")}).getByRole("button",{name:t("Settings"),exact:true}).click();
      await page.getByRole("tab",{name:t("Data"),exact:true}).click();
      await page.getByRole("button",{name:t("Manage"),exact:true}).click();
      await page.getByRole("button",{name:t("Recently deleted"),exact:true}).click();
    } else {
      await page.locator(".conversation-list-pane").getByRole("button",{name:t("More"),exact:true}).click();
      await page.getByRole("menuitem",{name:t("Recently deleted"),exact:true}).click();
    }
    const manager = page.getByRole("dialog",{name:t("Backups & recovery"),exact:true});
    const row = manager.getByRole("button",{name:/Synthetic deletion example/}).first();
    await row.waitFor();
    for (const width of [920,1440]) {
      await page.setViewportSize({width,height:width === 920 ? 620 : 900});
      await expectInViewport(page,manager); await expectNoHorizontalOverflow(page);
      await capture(`conversation-recovery-${width}`);
    }
    await row.click();
    await page.setViewportSize({width:920,height:620});
    await manager.locator(".backup-preview-file").first().waitFor();
    await expect.poll(() => manager.getByRole("button",{name:t("Back"),exact:true}).evaluate((button) => button === document.activeElement)).toBe(true);
    await capture("conversation-restore-920");
    await writeFile(file,"A new session owns this path");
    await manager.getByRole("button",{name:t("Restore conversation"),exact:true}).click();
    await manager.getByRole("alert").filter({hasText:"overwrite"}).waitFor();
    expect(await readFile(file,"utf8")).toBe("A new session owns this path");
    await expectInViewport(page,manager); await expectNoHorizontalOverflow(page);
    await capture("conversation-restore-occupied-920");
    await rm(file);
    await manager.getByRole("button",{name:t("Restore conversation"),exact:true}).click();
    await expect.poll(() => readFile(file,"utf8").catch(() => "")).toBe(transcript);
    await expect.poll(async () => (await page.evaluate(() => window.agentEnv.searchConversations({query:"Synthetic deletion example"}))).length).toBe(1);
    await manager.getByText(t("Conversation restored"),{exact:true}).waitFor();
    await expect.poll(() => manager.getByRole("button",{name:t("Close"),exact:true}).evaluate((button) => button === document.activeElement)).toBe(true);
    await manager.getByRole("button",{name:t("Close"),exact:true}).click();
    await nav().click();
    await page.getByRole("option").filter({hasText:"Synthetic deletion example"}).waitFor();
    // Removing a recovery record must retire the corresponding Undo in the live workspace.
    await utimes(file,new Date(0),new Date(0));
    await page.getByRole("option").filter({hasText:"Synthetic deletion example"}).click({button:"right"});
    await page.getByRole("menuitem",{name:t("Delete conversation…"),exact:true}).click();
    await page.getByRole("dialog",{name:t("Delete conversation?"),exact:true}).getByRole("button",{name:t("Delete conversation"),exact:true}).click();
    await page.getByRole("button",{name:t("Undo"),exact:true}).waitFor();
    await page.locator(".conversation-list-pane").getByRole("button",{name:t("More"),exact:true}).click();
    await page.getByRole("menuitem",{name:t("Recently deleted"),exact:true}).click();
    const pendingRow = manager.locator(".backup-manager-row").filter({hasText:t("Kept until deleted")}).first();
    await pendingRow.getByRole("button",{name:/More actions|更多操作/}).click();
    await page.getByRole("menuitem",{name:t("Delete permanently"),exact:true}).click();
    await expect.poll(() => manager.getByRole("button",{name:t("Cancel"),exact:true}).evaluate((button) => button === document.activeElement)).toBe(true);
    await manager.getByRole("button",{name:t("Delete permanently"),exact:true}).click();
    await manager.getByRole("button",{name:t("Close"),exact:true}).click();
    expect(await page.getByRole("button",{name:t("Undo"),exact:true}).count()).toBe(0);
  },120_000);
});
