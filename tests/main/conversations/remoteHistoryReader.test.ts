import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { remoteHistoryScript, remoteHistoryRequest } from "../../../src/main/targets/conversations/remoteHistoryReader";
import type { SshTransport } from "../../../src/main/remoteDevices/systemSshTransport";
import type { RemoteDevice } from "../../../src/shared/types";

const processTransport = (environment: NodeJS.ProcessEnv = process.env) => ({ execute: (_device, command, options) => new Promise((resolve, reject) => {
  const child = spawn("/bin/sh", ["-c", command], {env:environment});
  const out: Buffer[] = [], err: Buffer[] = [];
  child.stdout.on("data", (data) => out.push(data));
  child.stderr.on("data", (data) => err.push(data));
  child.on("error", reject);
  child.on("close", (exitCode) => resolve({exitCode:exitCode ?? 1,stdout:Buffer.concat(out),stderr:Buffer.concat(err).toString()}));
  child.stdin.end(options?.input);
}) }) as SshTransport;

let root = "";
afterEach(async () => { if (root) await rm(root,{recursive:true,force:true}); });
const request = async (input: Record<string, unknown>) => {
  const {stdout} = await promisify(execFile)("python3",["-c",remoteHistoryScript,JSON.stringify(input)]);
  return JSON.parse(stdout);
};
it("includes only known Trae legacy history and keeps directory selections scoped", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-trae-remote-"));
  const runtime = join(root, "cli");
  await mkdir(join(runtime, "sessions"), {recursive: true});
  await mkdir(join(root, "sessions"), {recursive: true});
  await mkdir(join(root, "private"), {recursive: true});
  await writeFile(join(runtime, "sessions/rollout-current.jsonl"), "{}\n");
  await writeFile(join(root, "sessions/rollout-old.jsonl"), "{}\n");
  await writeFile(join(root, "private/secret.jsonl"), "{}\n");
  const input = {agentId: "trae-cli", root: runtime, kind: "default", operation: "scan"};
  const result = await request(input);
  expect(result.records).toHaveLength(2);
  expect(result.records.some((r: {path: string}) => r.path.includes("private"))).toBe(false);
  const old = result.records.find((r: {path: string}) => r.path.endsWith("rollout-old.jsonl"));
  expect((await request({...input, operation: "read", path: old.path})).content).toBe("{}\n");
  expect((await request({...input, kind: "directory"})).records).toHaveLength(1);
});
it("keeps valid remote records when a sibling has invalid metadata and normalizes timestamps", async () => {
  const transport = {execute:async()=>({exitCode:0,stderr:"",stdout:Buffer.from(JSON.stringify({records:[
    {path:"/history/a.jsonl",version:"a",updatedAt:"2026-09-01T18:00:00+08:00",title:null},
    {path:"/history/b.jsonl",version:"b",updatedAt:"not a date"}
  ],issues:[]}))})} as SshTransport;
  const result = await remoteHistoryRequest<{records:Array<{updatedAt:string;title?:string}>;issues:string[]}>(transport,{id:"remote",host:"fixture.invalid"} as RemoteDevice,
    {id:"source",deviceId:"remote",agentId:"codex",root:"/history",kind:"directory"},"scan",new AbortController().signal);
  expect(result.records).toEqual([expect.objectContaining({updatedAt:"2026-09-01T10:00:00.000Z",title:undefined})]);
  expect(result.issues).toHaveLength(1);
});

it("reads paged inventories and UTF-8 transcripts across chunk boundaries with the real helper", async () => {
  root = await mkdtemp(join(tmpdir(),"aem-history-pages-"));
  const transport = processTransport();
  const device = {id:"remote",host:"fixture.invalid"} as RemoteDevice;
  const source = {id:"source",deviceId:"remote",agentId:"codex",root,kind:"directory" as const};
  for (let i=0;i<501;i++) await writeFile(join(root,`rollout-${i}.jsonl`),"{}\n");
  const content = "a".repeat(4*1024*1024-1) + "完整记录\n";
  await writeFile(join(root,"rollout-0.jsonl"),content);
  const inventory = await remoteHistoryRequest<{records:Array<any>;issues:string[]}>(transport,device,source,"scan",new AbortController().signal);
  expect(inventory.records).toHaveLength(501);
  expect(inventory.issues).toEqual([]);
  const record = inventory.records.find((r)=>r.path.endsWith("rollout-0.jsonl"));
  const result = await remoteHistoryRequest<{content:string}>(transport,device,source,"read",new AbortController().signal,record);
  expect(result.content).toBe(content);
},30000);

it("only suggests an environment-specific remote home, without scanning it", async () => {
  root = await mkdtemp(join(tmpdir(),"aem-history-roots-"));
  const custom = join(root,"custom");
  await mkdir(join(custom,"sessions"),{recursive:true});
  await writeFile(join(custom,"sessions/rollout-private.jsonl"),"private");
  const result = await remoteHistoryRequest<{records:unknown[];suggestedRoots:string[]}>(processTransport({...process.env,CODEX_HOME:custom}),
    {id:"remote",host:"fixture.invalid"} as RemoteDevice,{id:"s",deviceId:"remote",agentId:"codex",root:join(root,"default"),kind:"default"},"scan",new AbortController().signal);
  expect(result.records).toEqual([]);
  expect(result.suggestedRoots).toEqual([custom]);
});

it("reads a verified prefix while the Agent appends more messages", async () => {
  root = await mkdtemp(join(tmpdir(),"aem-history-append-"));
  const path = join(root,"rollout-live.jsonl");
  const content = "a".repeat(4*1024*1024+10);
  await writeFile(path,content);
  const real = processTransport();
  let calls = 0;
  const transport: SshTransport = {execute:async (device,command,options) => {
    const result = await real.execute(device,command,options);
    if (++calls === 1) await appendFile(path,"\nnext turn");
    return result;
  }};
  const result = await remoteHistoryRequest<{content:string}>(transport,{id:"remote"} as RemoteDevice,
    {id:"s",deviceId:"remote",agentId:"codex",root,kind:"directory"},"read",new AbortController().signal,
    {path,version:"",updatedAt:"2026-09-01T00:00:00Z"});
  expect(result.content).toBe(content);
  expect(calls).toBe(2);
});

it("retries a changing transcript once and discards the previous attempt", async () => {
  const execute = vi.fn()
    .mockResolvedValueOnce({exitCode:1,stderr:"History changed after discovery; refresh again",stdout:Buffer.alloc(0)})
    .mockResolvedValueOnce({exitCode:0,stderr:"",stdout:Buffer.from(JSON.stringify({bytes:Buffer.from("new snapshot").toString("base64"),eof:true,version:"new"}))});
  const result = await remoteHistoryRequest<{content:string}>({execute} as unknown as SshTransport,{id:"remote"} as RemoteDevice,
    {id:"s",deviceId:"remote",agentId:"codex",root:"/history",kind:"directory"},"read",new AbortController().signal,
    {path:"/history/a.jsonl",version:"old",updatedAt:"2026-09-01T00:00:00Z"});
  expect(result.content).toBe("new snapshot");
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1][1]).not.toContain('"expectedVersion":"old"');
});
it("reads full remote-shaped histories, archives and nested roots without writing or following outside links", async () => {
  root = await mkdtemp(join(tmpdir(),"aem-remote-history-"));
  const approved = join(root,"codex");
  await mkdir(join(approved,"sessions/2026/09/12"),{recursive:true});
  await mkdir(join(approved,"archived_sessions"),{recursive:true});
  const path = join(approved,"sessions/2026/09/12/rollout-test.jsonl");
  const content = '{"type":"message","text":"完整的远程记录"}\n';
  await writeFile(path,content);
  await writeFile(join(approved,"archived_sessions/rollout-archive.jsonl"),content);
  await writeFile(join(root,"outside.jsonl"),"outside stays private");
  await symlink(join(root,"outside.jsonl"),join(approved,"sessions/rollout-outside.jsonl"));
  await symlink(join(root,"outside.jsonl"),join(approved,"session_index.jsonl"));
  await symlink(join(approved,"sessions"),join(approved,"sessions/loop"));
  const input = {agentId:"codex",root:approved,kind:"default"};
  const scan = await request({...input,operation:"scan"});
  expect(scan.records).toHaveLength(2); expect(scan.issues.join(" ")).toContain("outside");
  expect(scan.issues.join(" ")).toContain("Native title index leaves approved source");
  const record = scan.records.find((r:any) => r.path === path);
  expect(await request({...input,operation:"read",path,expectedVersion:record.fileVersion})).toEqual({content});
  await writeFile(path,content+"{}\n");
  await expect(request({...input,operation:"read",path,expectedVersion:record.fileVersion})).rejects.toThrow("changed after discovery");
  await expect(request({...input,operation:"read",path:join(root,"outside.jsonl")})).rejects.toThrow("outside the approved source");
});

it("invalidates cached Codex titles without requiring a transcript change", async () => {
  root = await mkdtemp(join(tmpdir(),"aem-remote-title-"));
  const sid = "11111111-1111-4111-8111-111111111111";
  await mkdir(join(root,"sessions"));
  await writeFile(join(root,"sessions",`rollout-${sid}.jsonl`),"{}\n");
  const index = join(root,"session_index.jsonl");
  const input = {agentId:"codex",root,kind:"default",operation:"scan"};
  await writeFile(index,JSON.stringify({id:sid,thread_name:"Original title"}));
  const first = (await request(input)).records[0];
  await writeFile(index,JSON.stringify({id:sid,thread_name:"Renamed title"}));
  const second = (await request(input)).records[0];
  expect(second.title).toBe("Renamed title");
  expect(second.version).not.toBe(first.version);
  expect(second.fileVersion).toBe(first.fileVersion);
});

it("reads committed OpenCode WAL data and child sessions in a read-only transaction", async () => {
  root = await mkdtemp(join(tmpdir(),"aem-remote-sqlite-"));
  const path = join(root,"opencode.db");
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE session(id TEXT,title TEXT,directory TEXT,time_created INTEGER,time_updated INTEGER,parent_id TEXT);
      CREATE TABLE message(id TEXT,session_id TEXT,data TEXT,time_created INTEGER);
      CREATE TABLE part(id TEXT,message_id TEXT,data TEXT,time_created INTEGER);
      INSERT INTO session VALUES('child','Child session','/workspace/demo',1000,2000,'parent');
      INSERT INTO message VALUES('m1','child','{"role":"user"}',1000);
      INSERT INTO part VALUES('p1','m1','{"type":"text","text":"wal sentinel"}',1000);`);
    const input = {agentId:"opencode",root,kind:"default"};
    const result = await request({...input,operation:"scan"});
    expect(result.records).toHaveLength(1);
    const detail = await request({...input,operation:"read",path,sessionId:"child"});
    expect(detail.content).toContain("wal sentinel");
    const insert = db.prepare("INSERT INTO message VALUES(?,?,?,?)");
    for (let i=0;i<260;i++) insert.run(`extra-${i}`,"child",JSON.stringify({role:"assistant"}),2000+i);
    const paged = await remoteHistoryRequest<{content:string}>(processTransport(),{id:"remote"} as RemoteDevice,
      {id:"s",deviceId:"remote",agentId:"opencode",root,kind:"default"},"read",new AbortController().signal,
      {path,sessionId:"child",version:"",updatedAt:"2026-09-01T00:00:00Z"});
    const messages = JSON.parse(paged.content).messages;
    expect(messages).toHaveLength(261);
    expect(messages[0].parts[0].text).toBe("wal sentinel");
    expect(messages[260].info.id).toBe("extra-259");
    expect(db.prepare("SELECT count(*) AS count FROM session").get()).toEqual({count:1});
  } finally { db.close(); }
});
