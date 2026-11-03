import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWorktreeRecoveryBackups, previewWorktreeRecoveryBackup } from "../../src/main/worktrees/worktreeRecoveryBackup";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });
const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "aem-recovery-inventory-"));
  const recovery = join(root, "worktree-recovery");
  await mkdir(recovery);
  return recovery;
};
const journal = (id: string, status = "removed") => ({
  id, path: join(root, "original-worktree"), repositoryPath: join(root, "repo"),
  head: "a".repeat(40), createdAt: "2020-01-01T00:00:00.000Z", status,
  backupHash: "b".repeat(64), indexHash: "c".repeat(64),
  protectedRef: `refs/agentenv/worktree-recovery/${id}`,
  sourceSizeBytes: 1_000_000_000
});

describe("read-only worktree recovery backup projection", () => {
  it("requires the operation metadata payload when its hash is recorded and keeps it read-only", async () => {
    const recovery = await setup();
    const id = randomUUID();
    const serialized = JSON.stringify({ ...journal(id), backupHash: undefined, indexHash: undefined, operationHash: "d".repeat(64) });
    await mkdir(join(recovery, id), { recursive: true });
    await writeFile(join(recovery, `${id}.json`), serialized);
    expect((await listWorktreeRecoveryBackups(root))[0]).toMatchObject({ deletable: false, requiredReason: "worktree-recovery-incomplete" });
    await mkdir(join(recovery, id, "operation"));
    await writeFile(join(recovery, id, "operation", "MERGE_HEAD"), "saved operation commit\n");
    expect((await listWorktreeRecoveryBackups(root))[0]).toMatchObject({ deletable: false, requiredReason: "worktree-recovery" });
    expect((await previewWorktreeRecoveryBackup(root, id)).files.map((file) => file.path))
      .toContain(join(recovery, id, "operation", "MERGE_HEAD"));
    expect(await readFile(join(recovery, `${id}.json`), "utf8")).toBe(serialized);
  });

  it("inventories existing journal, files and index bytes without a registration write or source-size estimate", async () => {
    const recovery = await setup();
    const id = randomUUID();
    const serialized = JSON.stringify(journal(id));
    await mkdir(join(recovery, id, "files", "empty"), { recursive: true });
    await writeFile(join(recovery, `${id}.json`), serialized);
    await writeFile(join(recovery, id, "files", "note.txt"), "sole uncommitted content");
    await writeFile(join(recovery, id, "index"), "staged");
    const before = await readdir(recovery);
    const timestamp = (await lstat(join(recovery, `${id}.json`))).mtimeMs;
    const items = await listWorktreeRecoveryBackups(root);
    expect(items).toEqual([expect.objectContaining({
      id, kind: "worktree-recovery", worktreePath: join(root, "original-worktree"),
      sizeBytes: Buffer.byteLength(serialized) + Buffer.byteLength("sole uncommitted content") + 6, sizeIncomplete: false,
      fileCount: 4, cleanupStatus: "required", requiredReason: "worktree-recovery", deletable: false
    })]);
    const preview = await previewWorktreeRecoveryBackup(root, id);
    expect(preview.files).toEqual(expect.arrayContaining([
      { path: join(recovery, `${id}.json`), kind: "file", state: "saved" },
      { path: join(recovery, id, "index"), kind: "file", state: "saved" },
      { path: join(recovery, id, "files", "note.txt"), kind: "file", state: "saved" },
      { path: join(recovery, id, "files", "empty"), kind: "directory", state: "saved" }
    ]));
    expect(preview.truncated).toBe(false);
    expect(await readFile(join(recovery, `${id}.json`), "utf8")).toBe(serialized);
    expect((await lstat(join(recovery, `${id}.json`))).mtimeMs).toBe(timestamp);
    expect(await readdir(recovery)).toEqual(before);
  });

  it.each(["prepared", "restoring", "removed", "restored", "unchanged"])("never makes %s recovery disposable", async (status) => {
    const recovery = await setup();
    const id = randomUUID();
    await writeFile(join(recovery, `${id}.json`), JSON.stringify({ ...journal(id, status), backupHash: undefined, indexHash: undefined }));
    const [item] = await listWorktreeRecoveryBackups(root);
    expect(item).toMatchObject({
      deletable: false, cleanupStatus: "required",
      requiredReason: ["prepared", "restoring"].includes(status) ? "worktree-recovery-incomplete" : "worktree-recovery"
    });
    expect(item.restored).toBe(status === "restored");
  });

  it("keeps corrupt, mismatched, future, missing-payload and orphan records visible without hiding healthy neighbors", async () => {
    const recovery = await setup();
    const ids = Array.from({ length: 6 }, () => randomUUID());
    for (const [index, id] of ids.entries()) {
      await mkdir(join(recovery, id, "files"), { recursive: true });
      await writeFile(join(recovery, id, "files", "note"), "keep");
      if (index === 0) continue;
      const record = index === 1 ? "{broken" : JSON.stringify({
        ...journal(id), indexHash: undefined,
        ...(index === 2 ? { id: randomUUID() } : {}),
        ...(index === 3 ? { status: "unknown-future-phase" } : {})
      });
      await writeFile(join(recovery, `${id}.json`), record);
      if (index === 4) await rm(join(recovery, id), { recursive: true });
    }
    const items = await listWorktreeRecoveryBackups(root);
    expect(items).toHaveLength(6);
    for (const id of ids.slice(0, 5)) expect(items.find((item) => item.id === id)).toMatchObject({ requiredReason: "worktree-recovery-incomplete", deletable: false });
    expect(items.find((item) => item.id === ids[5])).toMatchObject({ requiredReason: "worktree-recovery", deletable: false });
    const orphan = await previewWorktreeRecoveryBackup(root, ids[0]);
    expect(orphan.files.map((file) => file.path)).toContain(join(recovery, ids[0], "files", "note"));
  });

  it("does not follow payload links, journal links, or cycles", async () => {
    if (process.platform === "win32") return;
    const recovery = await setup();
    const id = randomUUID();
    const other = randomUUID();
    await mkdir(join(root, "outside"));
    await writeFile(join(root, "outside", "secret"), "not part of a backup".repeat(500));
    await writeFile(join(root, "outside", "journal.json"), JSON.stringify(journal(other)));
    await mkdir(join(recovery, id, "files"), { recursive: true });
    await writeFile(join(recovery, `${id}.json`), JSON.stringify({ ...journal(id), indexHash: undefined }));
    await symlink(join(root, "outside"), join(recovery, id, "files", "external"));
    await symlink(recovery, join(recovery, id, "files", "cycle"));
    await symlink(join(root, "outside", "journal.json"), join(recovery, `${other}.json`));
    await symlink(join(root, "outside"), join(recovery, other));
    const items = await listWorktreeRecoveryBackups(root);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id === id)?.fileCount).toBe(3);
    expect(items.find((item) => item.id === other)).toMatchObject({ requiredReason: "worktree-recovery-incomplete", worktreePath: undefined, fileCount: 2 });
    const preview = await previewWorktreeRecoveryBackup(root, other);
    expect(preview.files.map((file) => file.path)).toEqual([join(recovery, `${other}.json`), join(recovery, other)]);
    expect(preview.files.some((file) => file.path.includes("secret"))).toBe(false);
    expect(items.reduce((total, item) => total + item.sizeBytes, 0)).toBeLessThan(2_000);
  });

  it("bounds path previews while keeping inventory size complete", async () => {
    const recovery = await setup();
    const id = randomUUID();
    await mkdir(join(recovery, id), { recursive: true });
    for (let i = 0; i < 1_010; i++) await writeFile(join(recovery, id, `file-${i}`), "x");
    const [item] = await listWorktreeRecoveryBackups(root);
    expect(item).toMatchObject({ sizeBytes: 1_010, fileCount: 1_010, sizeIncomplete: false, deletable: false });
    const preview = await previewWorktreeRecoveryBackup(root, id);
    expect(preview).toMatchObject({ truncated: true, sizeIncomplete: false });
    expect(preview.files).toHaveLength(1_000);
  });

  it("never sizes source/repository/ref paths named in a malicious journal", async () => {
    const recovery = await setup();
    const id = randomUUID();
    const outside = join(root, "unrelated-content");
    await mkdir(outside);
    await writeFile(join(outside, "secret"), "not a recovery payload".repeat(100));
    const serialized = JSON.stringify({ ...journal(id), path: outside, repositoryPath: outside,
      protectedRef: "../../unrelated-content", backupHash: undefined, indexHash: undefined,
      backupPath: outside, sourcePath: outside });
    await writeFile(join(recovery, `${id}.json`), serialized);
    const [item] = await listWorktreeRecoveryBackups(root);
    expect(item.sizeBytes).toBe(Buffer.byteLength(serialized));
    const preview = await previewWorktreeRecoveryBackup(root, id);
    expect(preview.files).toEqual([{ path: join(recovery, `${id}.json`), kind: "file", state: "saved" }]);
    expect(await readFile(join(outside, "secret"), "utf8")).toBe("not a recovery payload".repeat(100));
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("reports unreadable copy directories as protected lower-bound sizes", async () => {
    const recovery = await setup();
    const id = randomUUID();
    const locked = join(recovery, id, "files");
    await mkdir(locked, { recursive: true });
    await writeFile(join(locked, "secret"), "keep");
    const serialized = JSON.stringify({ ...journal(id), indexHash: undefined });
    await writeFile(join(recovery, `${id}.json`), serialized);
    await chmod(locked, 0);
    try {
      expect(await listWorktreeRecoveryBackups(root)).toEqual([expect.objectContaining({
        sizeIncomplete: true, sizeBytes: Buffer.byteLength(serialized),
        requiredReason: "worktree-recovery", deletable: false
      })]);
      expect(await previewWorktreeRecoveryBackup(root, id)).toMatchObject({ truncated: true, sizeIncomplete: true });
    } finally { await chmod(locked, 0o700); }
  });

  it("rejects traversal, missing selections and linked recovery roots without changing them", async () => {
    const recovery = await setup();
    await expect(previewWorktreeRecoveryBackup(root, "../escape")).rejects.toThrow();
    await expect(previewWorktreeRecoveryBackup(root, randomUUID())).rejects.toThrow("does not exist");
    await rm(recovery, { recursive: true });
    expect(await listWorktreeRecoveryBackups(root)).toEqual([]);
    if (process.platform === "win32") return;
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), recovery);
    await expect(listWorktreeRecoveryBackups(root)).rejects.toThrow("not a regular directory");
    expect((await lstat(recovery)).isSymbolicLink()).toBe(true);
  });

  it("shares the inventory deadline across valid copies without treating unmeasured bytes as a broken transaction", async () => {
    const recovery = await setup();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) {
      await mkdir(join(recovery, id, "files"), { recursive: true });
      await writeFile(join(recovery, id, "files", "note"), "keep");
      await writeFile(join(recovery, id, "index"), "staged");
      await writeFile(join(recovery, `${id}.json`), JSON.stringify(journal(id)));
    }
    let ticks = 0;
    const items = await listWorktreeRecoveryBackups(root, { now: () => ticks++ === 0 ? 0 : 2_001 });
    expect(items).toHaveLength(3);
    for (const item of items) expect(item).toMatchObject({
      sizeIncomplete: true, sizeBytes: 0, cleanupStatus: "required", deletable: false,
      requiredReason: "worktree-recovery"
    });
    // A preview receives its own budget, independent of a spent inventory scan.
    const preview = await previewWorktreeRecoveryBackup(root, ids[0], { now: () => 0 });
    expect(preview).toMatchObject({ truncated: false, sizeIncomplete: false });
    expect(preview.files).toHaveLength(3);
    ticks = 0;
    expect(await previewWorktreeRecoveryBackup(root, ids[0], { now: () => ticks++ === 0 ? 0 : 2_001 }))
      .toMatchObject({ truncated: true, sizeIncomplete: true, files: [] });
  });
});
