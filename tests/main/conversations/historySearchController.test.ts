import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaths } from "../../../src/main/paths";
import { createTargetRegistry } from "../../../src/main/targets/registry";
import { createCodexTargetAdapter } from "../../../src/main/targets/codexTarget";
import { createTraeCliTargetAdapter } from "../../../src/main/targets/integrations/trae-cli";
import { DatabaseSync } from "node:sqlite";
import { createHistorySearchController } from "../../../src/main/conversations/historySearchController";
import { createConversationIndexStore } from "../../../src/main/conversations/conversationIndexStore";
import type { SettingsStore } from "../../../src/main/settingsStore";
import type { RemoteDeviceStore } from "../../../src/main/remoteDevices/remoteDeviceStore";
import type { SshTransport } from "../../../src/main/remoteDevices/systemSshTransport";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanups.reverse()) await fn(); cleanups.length = 0; });
const transcript = [
  { type: "session_meta", payload: { id: "same-session", cwd: "/work/example" } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{type:"input_text",text:"Find the unique history needle"}] } },
  { type: "response_item", payload: { type: "function_call", name: "exec", arguments: "tool-only-sentinel" } }
].map((v) => JSON.stringify(v)).join("\n");
const setup = async (transport?: SshTransport, configText?: string, trae = false) => {
  const root = await mkdtemp(join(tmpdir(), "aem-history-opt-in-"));
  cleanups.push(() => rm(root, { recursive:true, force:true }));
  const paths = createPaths({homeDir:join(root,"home"), appDataRoot:join(root,"data"), conversationIndexPath:join(root,"cache/index.sqlite")});
  await mkdir(join(paths.homeDir,".codex/sessions"),{recursive:true});
  const file = join(paths.homeDir,".codex/sessions/rollout-test.jsonl");
  await writeFile(file, transcript);
  const index = await createConversationIndexStore(paths.conversationIndexPath);
  if (configText) {
    await mkdir(paths.appDataRoot,{recursive:true});
    await writeFile(join(paths.appDataRoot,"conversation-search.json"),configText);
    await writeFile(join(root,"cache/conversation-coverage.json"),"null");
  }
  cleanups.push(async () => index.close());
  const adapter = trae ? createTraeCliTargetAdapter() : createCodexTargetAdapter();
  const discover = vi.spyOn(adapter.conversations!,"discover");
  const settings = {readSettings: async () => ({ enabledTargetIds:[] })} as unknown as SettingsStore;
  const controller = await createHistorySearchController({paths, index, settings, registry:createTargetRegistry([adapter]), transport,
    devices:{list: async () => [{id:"remote",name:"Build machine",host:"example.invalid"}]} as unknown as RemoteDeviceStore});
  cleanups.push(async () => controller.dispose());
  return {controller,index,paths,file,discover};
};

describe("explicit history search permissions", () => {
  it("indexes known Trae legacy history, reparses outdated cache and retains searchable text on partial reads", async () => {
    const {controller,index,paths} = await setup(undefined, undefined, true);
    const legacy = join(paths.homeDir, ".trae/sessions");
    await mkdir(legacy, {recursive: true});
    const path = join(legacy, "rollout-legacy.jsonl");
    await writeFile(path, transcript);
    const {deviceName,agentName,...source} = (await controller.status()).availableSources.find((s) => s.deviceId === "local")!;
    await controller.configure({version:1,enabled:true,paused:false,sources:[source]});
    expect((await controller.refresh()).indexed).toBe(1);
    expect((await controller.refresh()).unchanged).toBe(1);
    const db = new DatabaseSync(paths.conversationIndexPath);
    try { db.exec("UPDATE conversations SET source_version = 'obsolete:' || source_version"); }
    finally { db.close(); }
    expect((await controller.refresh()).indexed).toBe(1);
    await writeFile(path, JSON.stringify({type:"future_record", payload:{}}));
    await controller.refresh();
    expect((await controller.status()).sources[0]).toMatchObject({phase:"partial"});
    expect((await controller.status()).sources[0].issues.join(" ")).toContain("open the original conversation");
    expect(await index.search({query:"unique history needle",historySourceIds:controller.allowedIds()})).toHaveLength(1);
  });
  it("persists partial record diagnostics across unchanged refreshes and clears them only after repair", async () => {
    const {controller,index,file,paths} = await setup();
    const {deviceName,agentName,...source} = (await controller.status()).availableSources.find((s) => s.deviceId === "local")!;
    await writeFile(file, transcript + "\n{broken\n");
    await controller.configure({version:1,enabled:true,paused:false,sources:[source]});
    await controller.refresh();
    expect((await controller.status()).sources[0]).toMatchObject({phase:"partial", indexed:1});
    const saved = JSON.parse(await readFile(join(paths.conversationIndexPath, "../conversation-coverage.json"),"utf8"));
    expect(Object.values(saved)[0]).toHaveProperty("recordIssues");
    const repeat = await controller.refresh();
    expect(repeat.unchanged).toBe(1);
    expect((await controller.status()).sources[0]?.issues.join(" ")).toContain("unreadable records");
    const reopened = await createHistorySearchController({paths,index,
      registry:createTargetRegistry([createCodexTargetAdapter()]),
      settings:{readSettings:async()=>({enabledTargetIds:[]})} as unknown as SettingsStore});
    try {
      expect((await reopened.refresh()).unchanged).toBe(1);
      expect((await reopened.status()).sources[0]?.issues.join(" ")).toContain("unreadable records");
    } finally { reopened.dispose(); }
    expect(await index.search({query:"unique history needle",historySourceIds:controller.allowedIds()})).toHaveLength(1);
    await writeFile(file, transcript);
    await controller.refresh();
    expect((await controller.status()).sources[0]).toMatchObject({phase:"ready",issues:[]});
  });

  it("offers remote custom roots without indexing them until explicitly added", async () => {
    const execute = vi.fn(async () => ({exitCode:0,stderr:"",stdout:Buffer.from(JSON.stringify({records:[],issues:[],suggestedRoots:["/custom/codex"]}))}));
    const {controller} = await setup({execute} as unknown as SshTransport);
    const {deviceName,agentName,...source} = (await controller.status()).availableSources.find((s) => s.deviceId === "remote")!;
    await controller.configure({version:1,enabled:true,paused:false,sources:[source]});
    await controller.refresh();
    const status = await controller.status();
    expect(status.availableSources.some((s) => s.root === "/custom/codex")).toBe(true);
    expect(status.config.sources).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps local indexing responsive while another device is waiting", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {release=resolve;});
    const execute = vi.fn(async () => { await gate; return {exitCode:0,stderr:"",stdout:Buffer.from('{"records":[],"issues":[]}')}; });
    const {controller,index} = await setup({execute} as unknown as SshTransport);
    const sources = (await controller.status()).availableSources.map(({deviceName,agentName,...s})=>s).reverse();
    await controller.configure({version:1,enabled:true,paused:false,sources});
    const run = controller.refresh();
    try { await vi.waitFor(async () => expect((await index.list()).total).toBe(1)); }
    finally { release(); await run; }
  });

  it("does not warn for an unused default history root, but preserves cached records if it disappears", async () => {
    const {controller,index,paths} = await setup();
    const {deviceName,agentName,...source} = (await controller.status()).availableSources.find((source) => source.deviceId === "local")!;
    await rm(join(paths.homeDir,".codex"),{recursive:true,force:true});
    await controller.configure({version:1,enabled:true,paused:false,sources:[source]});
    await controller.refresh();
    expect((await controller.status()).sources[0]).toMatchObject({phase:"ready",discovered:0,issues:[]});
    await mkdir(join(paths.homeDir,".codex/sessions"),{recursive:true});
    await writeFile(join(paths.homeDir,".codex/sessions/example.jsonl"),transcript);
    await controller.refresh();
    const id = (await controller.status()).config.sources[0]!.id;
    expect(index.hasSourceRecords(id)).toBe(true);
    await rm(join(paths.homeDir,".codex"),{recursive:true,force:true});
    await controller.refresh();
    expect((await controller.status()).sources[0]?.phase).not.toBe("ready");
    expect(index.hasSourceRecords(id)).toBe(true);
  });
  it("fails closed on invalid settings and lets the user repair consent without losing histories", async () => {
    const {controller,discover,file} = await setup(undefined,"{broken");
    await controller.refresh();
    expect(discover).not.toHaveBeenCalled();
    const status = await controller.status();
    expect(status).toMatchObject({needsConsent:true,config:{enabled:false}});
    expect(status.settingsIssue).toContain("Select and save");
    const {deviceName,agentName,...source} = status.availableSources[0]!;
    await controller.configure({version:1,enabled:true,paused:false,sources:[source]});
    await controller.refresh();
    expect((await controller.status()).settingsIssue).toBeUndefined();
    expect(await readFile(file,"utf8")).toBe(transcript);
  });
  it("does not discover before consent, indexes disabled Agents after opt-in, and clears only cache", async () => {
    const {controller,index,file,discover} = await setup();
    await controller.refresh(); expect(discover).not.toHaveBeenCalled();
    const status = await controller.status(); expect(status.needsConsent).toBe(true);
    const source = status.availableSources.find((s) => s.deviceId === "local")!;
    const {deviceName: _deviceName,agentName: _agentName,...selected} = source;
    await controller.configure({version:1,enabled:true,paused:false,sources:[selected]});
    await controller.refresh(); expect(discover).toHaveBeenCalledTimes(1);
    expect((await index.list({historySourceIds:controller.allowedIds()})).total).toBe(1);
    expect(await index.search({query:"tool-only-sentinel",historySourceIds:controller.allowedIds()})).toEqual([]);
    expect(await index.search({query:"tool-only-sentinel",includeTools:true,historySourceIds:controller.allowedIds()})).toHaveLength(1);
    await controller.configure({version:1,enabled:false,paused:false,sources:[selected]});
    expect((await index.list()).total).toBe(0);
    expect(await readFile(file,"utf8")).toBe(transcript);
    await controller.refresh(); expect(discover).toHaveBeenCalledTimes(1);
  });

  it("separates remote identities, searches offline cache and excludes non-approved facets", async () => {
    let offline = false;
    const execute = vi.fn(async (_device, command: string) => {
      if (offline) throw new Error("SSH host unavailable");
      const scan = command.includes('"operation":"scan"');
      return {exitCode:0,stderr:"",stdout:Buffer.from(JSON.stringify(scan ? {records:[{path:"/home/test/.codex/sessions/rollout-test.jsonl",version:"v1",updatedAt:"2026-09-12T01:00:00Z",size:200}],issues:[]} : {content:transcript}))};
    });
    const {controller,index} = await setup({execute} as unknown as SshTransport);
    const sources = (await controller.status()).availableSources.map(({deviceName,agentName,...s}) => s);
    await controller.configure({version:1,enabled:true,paused:false,sources}); await controller.refresh();
    const result = await index.list({historySourceIds:controller.allowedIds()});
    expect(result.items).toHaveLength(2); expect(new Set(result.items.map((s) => s.id)).size).toBe(2);
    offline = true; await controller.refresh();
    expect((await controller.status()).sources.some((s) => s.phase === "unavailable")).toBe(true);
    expect((await index.list({historySourceIds:controller.allowedIds()})).total).toBe(2);
    await controller.configure({version:1,enabled:true,paused:true,sources:[sources[0]!]},false);
    const calls = execute.mock.calls.length; await controller.refresh(); expect(execute).toHaveBeenCalledTimes(calls);
    const empty = await index.list({historySourceIds:[]});
    expect(empty).toMatchObject({total:0,workspacePaths:[],agentCounts:{}});
  });

  it("cancels in-flight collection before disabling and prevents late cache writes", async () => {
    let release: (()=>void) | undefined;
    const gate = new Promise<void>((resolve) => {release=resolve;});
    const execute = vi.fn(async () => { await gate; return {exitCode:0,stderr:"",stdout:Buffer.from('{"records":[],"issues":[]}')}; });
    const {controller,index} = await setup({execute} as unknown as SshTransport);
    const sources = (await controller.status()).availableSources.filter((s) => s.deviceId === "remote").map(({deviceName,agentName,...s})=>s);
    await controller.configure({version:1,enabled:true,paused:false,sources});
    const refresh = controller.refresh().catch(() => undefined);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const stopping = controller.configure({version:1,enabled:false,paused:false,sources});
    release!(); await refresh; await stopping;
    expect((await index.list()).total).toBe(0); expect(controller.allowedIds()).toEqual([]);
  });
});
