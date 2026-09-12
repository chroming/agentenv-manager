import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { remoteHistoryScript, remoteHistoryRequest } from "../../../src/main/targets/conversations/remoteHistoryReader";
import type { SshTransport } from "../../../src/main/remoteDevices/systemSshTransport";
import type { RemoteDevice } from "../../../src/shared/types";

let root = "";
afterEach(async () => { if (root) await rm(root,{recursive:true,force:true}); });
const request = async (input: Record<string, unknown>) => {
  const {stdout} = await promisify(execFile)("python3",["-c",remoteHistoryScript,JSON.stringify(input)]);
  return JSON.parse(stdout);
};
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
    expect(db.prepare("SELECT count(*) AS count FROM session").get()).toEqual({count:1});
  } finally { db.close(); }
});
