import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";
import { expectNoHorizontalOverflow, findVisibleTextLayoutDefects } from "./layoutAssertions";

requireCurrentElectronBuild();
let app: ElectronApplication | undefined;
let root = "";
afterEach(async () => { await app?.close().catch(() => undefined); if (root) await rm(root,{recursive:true,force:true}); });

it.skipIf(process.platform === "win32")("requires opt-in, searches local and SSH sources, and clears cached results without touching histories", async () => {
  root = await mkdtemp(join(tmpdir(),"aem-history-desktop-"));
  const home = join(root,"home"), remoteHome = join(root,"remote"), data = join(root,"data"), bin = join(root,"bin");
  for (const folder of [home,remoteHome,data,bin]) await mkdir(folder,{recursive:true});
  const sourceFiles: string[] = [];
  for (const [folder,label] of [[home,"Local"],[remoteHome,"Remote"]]) {
    const dir = join(folder!,".codex/sessions/2026/09/12"); await mkdir(dir,{recursive:true});
    const file = join(dir,"rollout-same-session.jsonl"); sourceFiles.push(file);
    await writeFile(file,[
      {type:"session_meta",payload:{id:"same-session",cwd:`/work/${label!.toLowerCase()}/example`}},
      {type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:`${label} searchable history fixture`}]}},
      {type:"response_item",payload:{type:"message",role:"assistant",content:[{type:"output_text",text:"The needle appears at the end of this conversation."}]}}
    ].map((v)=>JSON.stringify(v)).join("\n"));
    await utimes(file,new Date("2026-09-01T10:00:00Z"),new Date("2026-09-01T10:00:00Z"));
  }
  const originals = await Promise.all(sourceFiles.map((p)=>readFile(p,"utf8")));
  const ssh = join(bin,"ssh");
  const scanGate = join(root, "scan-pending");
  await writeFile(scanGate, "pending");
  await writeFile(ssh,`#!/bin/sh\nexport HOME=${JSON.stringify(remoteHome)}\nwhile [ -f ${JSON.stringify(scanGate)} ]; do sleep 0.1; done\nfor arg do last="$arg"; done\neval "$last"\n`); await chmod(ssh,0o755);
  await writeFile(join(data,"settings.json"),JSON.stringify({locale:"en",enabledTargetIds:[],telemetryEnabled:false,skillAutoCheckEnabled:false,agentDiscoveryVersion:1,agentDiscoveryReviewedIds:["codex"]}));
  await writeFile(join(data,"remote-devices.json"),JSON.stringify({formatVersion:1,devices:[{id:"11111111-1111-4111-8111-111111111111",name:"Build machine",host:"fixture.invalid",createdAt:"2026-09-12T00:00:00.000Z",updatedAt:"2026-09-12T00:00:00.000Z"}]}));
  app = await electron.launch({executablePath:electronPath as unknown as string,args:[`--user-data-dir=${join(root,"electron")}`,join(process.cwd(),"out/main/main.js")],env:{...process.env,AGENTENV_AUTOMATION:"1",AGENTENV_HOME:home,AGENTENV_DATA_ROOT:data,AGENTENV_CACHE_ROOT:join(root,"cache"),AGENTENV_AUTOMATION_TARGET_PATH:bin,PATH:bin+delimiter+(process.env.PATH??"")}});
  const page = await app.firstWindow();
  await expect.poll(()=>page.evaluate(()=>window.agentEnv.readStartupStatus())).toEqual({state:"ready"});
  expect(await page.evaluate(()=>window.agentEnv.searchConversations({query:"needle"}))).toEqual([]);
  await page.getByRole("complementary",{name:"Global navigation"}).getByRole("button",{name:"Conversations",exact:true}).click();
  await page.getByText("Histories are indexed locally. Original files are never changed.").waitFor();
  expect(await page.getByRole("button",{name:"History sources",exact:true}).count()).toBe(0);
  const output = process.env.AGENTENV_CAPTURE_HISTORY_DIR ?? "/tmp/aem-history-search-captures"; await mkdir(output,{recursive:true});
  await page.setViewportSize({width:920,height:620});
  await page.screenshot({path:join(output,"history-disabled-920.png"),animations:"disabled"});
  await page.getByRole("button",{name:"Choose devices",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"History search",exact:true});
  expect(await dialog.getByRole("switch",{name:"History search",exact:true}).count()).toBe(0);
  await dialog.getByRole("switch",{name:"This Mac",exact:true}).click();
  await dialog.getByRole("switch",{name:"Build machine",exact:true}).click();
  await dialog.getByRole("button",{name:"Build machine · More",exact:true}).click();
  expect(await page.getByRole("menuitemcheckbox",{name:"Codex",exact:true}).getAttribute("aria-checked")).toBe("true");
  await page.getByRole("menuitemcheckbox",{name:"Codex",exact:true}).click();
  await dialog.getByRole("button",{name:"Build machine · More",exact:true}).click();
  expect(await page.getByRole("menuitemcheckbox",{name:"Codex",exact:true}).getAttribute("aria-checked")).toBe("false");
  await page.getByRole("menuitemcheckbox",{name:"Codex",exact:true}).click();
  await dialog.locator(".ui-dialog-body").evaluate((el)=>{el.scrollTop=0;});
  for (const width of [920,1180,1440]) {
    await page.setViewportSize({width,height:620});
    await expectNoHorizontalOverflow(page);
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
    await page.screenshot({path:join(output,`history-sources-${width}.png`),animations:"disabled"});
  }
  await page.setViewportSize({width:920,height:620});
  await dialog.getByRole("button",{name:"Enable search",exact:true}).click();
  try {
    await expect.poll(() => page.evaluate(async () => (await window.agentEnv.conversationHistoryStatus()).running)).toBe(true);
    const search = page.getByRole("searchbox", { name: "Search conversations" });
    await search.fill("needle", { timeout: 1500 });
    await page.getByRole("button", { name: "More", exact: true }).click({ timeout: 1500 });
    await page.getByRole("menuitem", { name: "History sources", exact: true }).click({ timeout: 1500 });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await search.fill("");
  } finally {
    await rm(scanGate, { force: true });
  }
  await expect.poll(async () => (await page.evaluate(()=>window.agentEnv.listConversations({query:"needle"}))).total,{timeout:20000}).toBe(2);
  const openSources = async () => {
    await page.locator(".conversation-list-toolbar").getByRole("button",{name:"More",exact:true}).click();
    await page.getByRole("menuitem",{name:"History sources",exact:true}).click();
    await expect.poll(() => dialog.getByRole("button",{name:"Save",exact:true}).isEnabled()).toBe(true);
  };
  await openSources();
  const pause = dialog.getByRole("button",{name:"Pause",exact:true});
  expect(await pause.innerText()).toBe("");
  await pause.click();
  await dialog.getByRole("button",{name:"Save",exact:true}).click();
  await expect.poll(()=>page.evaluate(async ()=>(await window.agentEnv.conversationHistoryStatus()).config.paused)).toBe(true);
  await page.getByRole("button",{name:"Resume",exact:true}).waitFor();
  await page.screenshot({path:join(output,"history-paused-920.png"),animations:"disabled"});
  await page.getByRole("button",{name:"Resume",exact:true}).click();
  await expect.poll(()=>page.evaluate(async ()=>(await window.agentEnv.conversationHistoryStatus()).config.paused)).toBe(false);
  await page.getByRole("searchbox",{name:"Search conversations"}).fill("needle");
  await page.getByRole("option",{name:/Remote searchable history fixture/}).click();
  await page.getByText("/work/remote/example",{exact:true}).waitFor();
  expect(await page.getByRole("button",{name:"Open original",exact:true}).count()).toBe(0);
  await page.getByRole("button",{name:"History location",exact:true}).click();
  await page.getByRole("button",{name:"Copy history location"}).click();
  const copied = await app.evaluate(({clipboard})=>clipboard.readText());
  expect(copied).toContain("fixture.invalid"); expect(copied).toContain("/work/remote/example");
  await page.getByRole("dialog",{name:"History location",exact:true}).getByRole("button",{name:"Close",exact:true}).click();
  await page.screenshot({path:join(output,"history-remote-result.png"),animations:"disabled"});
  await openSources();
  await expect.poll(() => dialog.getByRole("button",{name:"Save",exact:true}).isEnabled()).toBe(true);
  await page.screenshot({path:join(output,"history-enabled-920.png"),animations:"disabled"});
  await dialog.getByRole("button",{name:"Build machine · More",exact:true}).click();
  await page.getByRole("menuitem",{name:"Details",exact:true}).click();
  await page.setViewportSize({width:920,height:620});
  await expectNoHorizontalOverflow(page);
  expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
  await page.screenshot({path:join(output,"history-details-920.png"),animations:"disabled"});
  await dialog.getByRole("switch",{name:"History search",exact:true}).click();
  await dialog.getByRole("button",{name:"Save",exact:true}).click();
  await page.getByRole("button",{name:"Choose devices",exact:true}).waitFor();
  expect(await page.evaluate(()=>window.agentEnv.searchConversations({query:"needle"}))).toEqual([]);
  expect(await Promise.all(sourceFiles.map((p)=>readFile(p,"utf8")))).toEqual(originals);
  for (const [locale,navLabel,sourcesLabel,searchLabel] of [["zh_CN","对话","选择设备","历史搜索"],["zh_TW","對話","選擇裝置","歷史搜尋"]] as const) {
  await page.evaluate((locale)=>window.agentEnv.updateSettings({locale}),locale);
  await page.reload();
  await page.getByRole("complementary").getByRole("button",{name:navLabel,exact:true}).click();
  await page.getByRole("button",{name:sourcesLabel,exact:true}).first().click({timeout:5000}).catch(async (error) => {
    await page.screenshot({path:join(output,`history-failure-${locale}.png`)});
    throw new Error(`${String(error)}\n${await page.locator("body").innerText()}`);
  });
  const localized = page.getByRole("dialog",{name:searchLabel,exact:true});
  expect(await localized.getByRole("switch",{name:searchLabel,exact:true}).count()).toBe(0);
  for (const width of [920,1180,1440]) {
    await page.setViewportSize({width,height:620});
    await expectNoHorizontalOverflow(page);
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
    await page.screenshot({path:join(output,`history-sources-${locale}-${width}.png`),animations:"disabled"});
  }
  await page.keyboard.press("Escape");
  await expect.poll(()=>localized.count()).toBe(0);
  expect((await page.evaluate(()=>window.agentEnv.conversationHistoryStatus())).config.enabled).toBe(false);
  }
}, 60000);
