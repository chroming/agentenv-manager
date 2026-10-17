import { link, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../../src/main/paths";
import { createBackupStore } from "../../../src/main/backupStore";
import { createBackupMaintenanceService } from "../../../src/main/backupMaintenanceService";
import { createConversationDeletion, inspectConversationFiles, readConversationDeletionPhase, writeConversationDeletionPhase } from "../../../src/main/conversations/conversationDeletion";
import { collectConversationDeletionFiles } from "../../../src/main/targets/conversations/conversationDeletionFiles";
import type { AgentConversationContext, AgentConversationCandidate } from "../../../src/main/targets/types";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const setup = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aem-conversation-delete-")));
  roots.push(root);
  const paths = createPaths({ homeDir: join(root, "home"), appDataRoot: join(root, "data") });
  const history = join(paths.homeDir, ".claude", "projects");
  const files = [join(history, "project", "session-1.jsonl"), join(history, "project", "session-1", "subagents", "agent-a.jsonl")];
  for (const path of files) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `original ${path}`, { mode: 0o600 });
    await utimes(path, new Date(0), new Date(0));
  }
  const store = createBackupStore(paths, { now: () => new Date("2026-01-01") });
  const metadata = { conversationId: "c1", title: "Test conversation", agentId: "claude-code", sourceKey: "local-source", roots: [history] };
  const { hashes } = await inspectConversationFiles(files, [history]);
  return { paths, history, files, store, metadata, hashes, deletion: createConversationDeletion(store, paths.backupsDir) };
};

describe("recoverable conversation deletion", () => {
  it("backs up all files, restores exact content and modes, and records completion", async () => {
    const f = await setup();
    const id = await f.deletion.remove(f.metadata, f.hashes);
    for (const path of f.files) await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readConversationDeletionPhase(f.paths.backupsDir, id)).toBe("deleted");
    await f.deletion.restore(id);
    for (const path of f.files) {
      expect(await readFile(path, "utf8")).toBe(`original ${path}`);
      if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    expect(await readConversationDeletionPhase(f.paths.backupsDir, id)).toBe("restored");
    await f.deletion.restore(id);
    expect((await f.store.readBackup(id)).entries).toHaveLength(2);
  });

  it("does not overwrite newly occupied destinations, even with identical content", async () => {
    const f = await setup();
    const id = await f.deletion.remove(f.metadata, f.hashes);
    await writeFile(f.files[0], `original ${f.files[0]}`);
    await expect(f.deletion.restore(id)).rejects.toThrow("overwrite");
    await expect(stat(f.files[1])).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readConversationDeletionPhase(f.paths.backupsDir, id)).toBe("deleted");
  });

  it("rejects a stale backup before deleting originals", async () => {
    const f = await setup();
    await writeFile(f.files[1], "new message");
    await expect(f.deletion.remove(f.metadata, f.hashes)).rejects.toThrow("changed");
    expect(await readFile(f.files[1], "utf8")).toBe("new message");
    expect(await readFile(f.files[0], "utf8")).toBe(`original ${f.files[0]}`);
  });

  it("restores already removed files when a later deletion fails", async () => {
    const f = await setup();
    let calls = 0;
    const deletion = createConversationDeletion(f.store, f.paths.backupsDir, { removeFile: async (path) => {
      if (++calls === 2) throw new Error("injected permission error");
      await unlink(path);
    } });
    await expect(deletion.remove(f.metadata, f.hashes)).rejects.toThrow("removed files were restored");
    for (const path of f.files) expect(await readFile(path, "utf8")).toBe(`original ${path}`);
    expect(await readConversationDeletionPhase(f.paths.backupsDir, (await f.store.listBackups())[0].id)).toBe("restored");
  });

  it("keeps a protected recovery record when another writer prevents rollback", async () => {
    const f = await setup();
    let calls = 0;
    const deletion = createConversationDeletion(f.store, f.paths.backupsDir, { removeFile: async (path) => {
      if (++calls === 2) { await writeFile(f.files[0], "external message"); throw new Error("injected failure"); }
      await unlink(path);
    } });
    await expect(deletion.remove(f.metadata, f.hashes)).rejects.toThrow("automatic recovery could not finish");
    expect(await readFile(f.files[0], "utf8")).toBe("external message");
    const backup = (await f.store.listBackups())[0];
    expect(await readConversationDeletionPhase(f.paths.backupsDir, backup.id)).toBe("deleting");
    expect((await f.store.readBackup(backup.id)).entries).toHaveLength(2);
  });

  it("restores originals when removing cached search entries fails", async () => {
    const f = await setup();
    await expect(f.deletion.remove(f.metadata, f.hashes, () => { throw new Error("index transaction failed"); })).rejects.toThrow("removed files were restored");
    for (const path of f.files) expect(await readFile(path,"utf8")).toBe(`original ${path}`);
    const backup = (await f.store.listBackups())[0];
    expect(await readConversationDeletionPhase(f.paths.backupsDir,backup.id)).toBe("restored");
  });

  it("rejects recent writes, symlinks, hardlinks and redirected parent directories", async () => {
    const f = await setup();
    await utimes(f.files[0], new Date(), new Date());
    await expect(inspectConversationFiles(f.files, [f.history])).rejects.toThrow("recently written");
    const linked = join(f.history, "linked.jsonl");
    await symlink(f.files[1], linked);
    await expect(inspectConversationFiles([linked], [f.history])).rejects.toThrow("regular");
    await unlink(linked); await link(f.files[1], linked);
    await expect(inspectConversationFiles([linked], [f.history])).rejects.toThrow("regular");
    await unlink(linked);
    const dir = join(f.history, "redirect"); await symlink(dirname(f.files[1]), dir);
    await expect(inspectConversationFiles([join(dir, "agent-a.jsonl")], [f.history])).rejects.toThrow("symbolic link");
  });

  it("refuses corrupt payloads before restoring anything", async () => {
    const f = await setup();
    const id = await f.deletion.remove(f.metadata, f.hashes);
    const backup = await f.store.readBackup(id);
    await writeFile(backup.entries[1].backupPath!, "corrupt");
    await expect(f.deletion.restore(id)).rejects.toThrow("integrity");
    await expect(stat(f.files[0])).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers an interrupted deletion from its persisted journal without rewriting surviving files", async () => {
    const f = await setup();
    const backup = await f.store.createBackup(f.files,{operation:"conversation-delete",conversation:f.metadata});
    await writeConversationDeletionPhase(f.paths.backupsDir,backup.id,"deleting");
    await unlink(f.files[0]);
    const survivingTime = (await stat(f.files[1])).mtimeMs;
    await createConversationDeletion(createBackupStore(f.paths),f.paths.backupsDir).restore(backup.id);
    for (const path of f.files) expect(await readFile(path,"utf8")).toBe(`original ${path}`);
    expect((await stat(f.files[1])).mtimeMs).toBe(survivingTime);
    expect(await readConversationDeletionPhase(f.paths.backupsDir,backup.id)).toBe("restored");
  });

  it("separates deletion retention, protects incomplete records, and scopes cleanup", async () => {
    const f = await setup();
    const id = await f.deletion.remove(f.metadata, f.hashes);
    const maintenance = createBackupMaintenanceService(f.paths, f.store, {
      listCleanupBackups: async () => [],
    } as never, { readSettings: async () => ({ backupRetentionDays: null, deletedConversationRetentionDays: 30 }) }, { now: () => new Date("2026-03-01") });
    expect((await maintenance.listInventory()).items.find((i) => i.id === id)?.cleanupStatus).toBe("eligible");
    await maintenance.cleanup("recovery");
    expect((await f.store.listBackups()).length).toBe(1);
    await writeConversationDeletionPhase(f.paths.backupsDir, id, "deleting");
    expect((await maintenance.listInventory()).items[0].deletable).toBe(false);
    await maintenance.cleanup("deleted");
    expect((await f.store.listBackups()).length).toBe(1);
    await writeConversationDeletionPhase(f.paths.backupsDir, id, "deleted");
    expect((await maintenance.cleanup("deleted")).deletedCount).toBe(1);
  });

  it("collects Claude sidecars and subagents, without unrelated sessions or project files", async () => {
    const f = await setup();
    const configDir = dirname(f.history);
    const todo = join(configDir, "todos", "session-1-agent-a.json");
    await mkdir(dirname(todo), { recursive: true }); await writeFile(todo, "{}");
    const unrelated = join(dirname(f.files[0]), "other.jsonl"); await writeFile(unrelated, "keep");
    const candidate = { recordId: "session-1", source: { locator: f.files[0] } } as AgentConversationCandidate;
    const result = await collectConversationDeletionFiles("claude-code", { targetPaths: { configDir } } as AgentConversationContext, candidate, [candidate]);
    expect(result.files).toEqual([...f.files, todo].sort());
    await expect(collectConversationDeletionFiles("opencode", { targetPaths: { configDir } } as AgentConversationContext, candidate, [candidate])).rejects.toThrow("not supported");
  });

  it("collects Codex compressed copies and artifacts without other session files", async () => {
    const f = await setup();
    const configDir = join(f.paths.homeDir, ".codex");
    const file = join(configDir,"sessions","rollout-session-1.jsonl");
    const compressed = `${file}.gz`;
    const artifact = file.replace(/\.jsonl$/, ".artifacts/output.txt");
    for (const path of [file,compressed,artifact,join(configDir,"sessions","other.jsonl")]) {
      await mkdir(dirname(path),{recursive:true}); await writeFile(path,"fixture");
    }
    const candidates = [file,compressed].map((locator) => ({recordId:"session-1",source:{locator}})) as AgentConversationCandidate[];
    const result = await collectConversationDeletionFiles("codex",{targetPaths:{configDir}} as AgentConversationContext,candidates[0],candidates);
    expect(result.files).toEqual([file,compressed,artifact].sort());
  });

  it("accepts Pi's fallback session directory when its configured runtime is absent", async () => {
    const f = await setup();
    const configDir = join(f.paths.homeDir,".pi","agent");
    const file = join(configDir,"sessions","project","session-1.jsonl");
    await mkdir(dirname(file),{recursive:true}); await writeFile(file,"fixture");
    const candidate = {recordId:"session-1",source:{locator:file}} as AgentConversationCandidate;
    expect((await collectConversationDeletionFiles("pi",{targetPaths:{configDir,runtimeDir:join(f.paths.homeDir,"unavailable")}} as AgentConversationContext,candidate,[candidate])).files).toEqual([file]);
  });
});
