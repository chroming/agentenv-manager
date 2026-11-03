import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackupMaintenanceService } from "../../src/main/backupMaintenanceService";
import { createBackupStore } from "../../src/main/backupStore";
import { createPaths } from "../../src/main/paths";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("backup maintenance service", () => {
  it.each(["unchanged", "removed", "restored"])("classifies a %s journal with retained hashes and no payload without rewriting recovery data", async (status) => {
    root = await mkdtemp(join(tmpdir(), "agentenv-backup-maintenance-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const id = randomUUID();
    const recovery = join(paths.appDataRoot, "worktree-recovery");
    const original = join(root, "original-worktree");
    await mkdir(recovery, { recursive: true });
    await mkdir(original);
    await writeFile(join(original, "note.txt"), "original uncommitted content remains");
    const journal = join(recovery, `${id}.json`);
    const serialized = JSON.stringify({
      id, path: original, repositoryPath: join(root, "repository"),
      head: "a".repeat(40), createdAt: "2000-01-01T00:00:00.000Z", status,
      backupHash: "b".repeat(64), indexHash: "c".repeat(64),
      sourceHash: "b".repeat(64), sourceSizeBytes: 36,
      protectedRef: `refs/agentenv/worktree-recovery/${id}`
    });
    await writeFile(journal, serialized);
    const timestamp = (await lstat(journal)).mtimeMs;
    const service = createBackupMaintenanceService(paths, createBackupStore(paths), {
      listCleanupBackups: vi.fn().mockResolvedValue([]), previewCleanupBackup: vi.fn(), deleteCleanupBackup: vi.fn()
    }, { readSettings: vi.fn().mockResolvedValue({ backupRetentionDays: 7 }) });
    const inventory = await service.listInventory();
    expect(inventory.items).toEqual([expect.objectContaining({
      id, kind: "worktree-recovery", cleanupStatus: "required", deletable: false,
      requiredReason: status === "unchanged" ? "worktree-recovery" : "worktree-recovery-incomplete",
      sizeBytes: Buffer.byteLength(serialized), sizeIncomplete: false, fileCount: 1
    })]);
    expect(await service.previewBackup({ id, kind: "worktree-recovery" })).toMatchObject({
      files: [{ path: journal, kind: "file", state: "saved" }], truncated: false
    });
    expect(await service.cleanup()).toMatchObject({ deletedCount: 0, freedBytes: 0 });
    await expect(service.deleteBackup({ id, kind: "worktree-recovery" })).rejects.toThrow("whole-transaction");
    expect(await readFile(journal, "utf8")).toBe(serialized);
    expect((await lstat(journal)).mtimeMs).toBe(timestamp);
    expect(await readdir(recovery)).toEqual([`${id}.json`]);
    await expect(lstat(join(recovery, id))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(original, "note.txt"), "utf8")).toBe("original uncommitted content remains");
  });
  it.each(["linked", "not-directory"])("isolates an unsafe %s Worktree recovery root from normal inventory", async (kind) => {
    if (kind === "linked" && process.platform === "win32") return;
    root = await mkdtemp(join(tmpdir(), "agentenv-backup-maintenance-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const backupStore = createBackupStore(paths);
    const ordinary = await backupStore.createBackup([], { operation: "data-import" });
    const recovery = join(paths.appDataRoot, "worktree-recovery");
    if (kind === "linked") {
      await mkdir(join(root, "outside"));
      await writeFile(join(root, "outside", "secret"), "must not inspect this");
      await symlink(join(root, "outside"), recovery);
    } else await writeFile(recovery, "not a directory");
    const service = createBackupMaintenanceService(paths, backupStore, {
      listCleanupBackups: vi.fn().mockResolvedValue([]), previewCleanupBackup: vi.fn(), deleteCleanupBackup: vi.fn()
    }, { readSettings: vi.fn().mockResolvedValue({ backupRetentionDays: 7 }) });
    const inventory = await service.listInventory();
    expect(inventory.items).toEqual([expect.objectContaining({ id: ordinary.id, kind: "target-recovery" })]);
    expect(inventory.issues).toEqual([expect.stringContaining("not a regular directory")]);
    expect(await service.previewBackup({ id: ordinary.id, kind: "target-recovery" })).toMatchObject({ files: [] });
    await expect(service.previewBackup({ id: randomUUID(), kind: "worktree-recovery" })).rejects.toThrow("not a regular directory");
    expect(await backupStore.readBackup(ordinary.id)).toBeTruthy();
  });
  it("includes existing Worktree copies but never deletes them through retention or direct requests", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-backup-maintenance-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const id = randomUUID();
    const recovery = join(paths.appDataRoot, "worktree-recovery");
    const files = join(recovery, id, "files");
    await mkdir(files, { recursive: true });
    await writeFile(join(files, "sole-note"), "not committed anywhere");
    await writeFile(join(recovery, `${id}.json`), JSON.stringify({
      id, path: join(root, "removed"), repositoryPath: join(root, "offline-repo"),
      createdAt: "2000-01-01T00:00:00.000Z", status: "removed", backupHash: "a".repeat(64)
    }));
    const backupStore = createBackupStore(paths);
    const deleteCleanupBackup = vi.fn();
    const service = createBackupMaintenanceService(paths, backupStore, {
      listCleanupBackups: vi.fn().mockResolvedValue([]), previewCleanupBackup: vi.fn(), deleteCleanupBackup
    }, { readSettings: vi.fn().mockResolvedValue({ backupRetentionDays: 7 }) });
    const inventory = await service.listInventory();
    expect(inventory.items).toEqual([expect.objectContaining({
      id, kind: "worktree-recovery", cleanupStatus: "required", deletable: false
    })]);
    expect(inventory.totalBytes).toBeGreaterThan(21);
    expect(inventory.eligibleBytes).toBe(0);
    expect(inventory.eligibleCount).toBe(0);
    await expect(service.previewBackup({ id, kind: "worktree-recovery" })).resolves.toMatchObject({
      files: expect.arrayContaining([{ path: join(files, "sole-note"), kind: "file", state: "saved" }])
    });
    for (const scope of [undefined, "recovery", "deleted"] as const) {
      expect(await service.cleanup(scope)).toMatchObject({ deletedCount: 0, freedBytes: 0, failures: [] });
    }
    await expect(service.deleteBackup({ id, kind: "worktree-recovery" })).rejects.toThrow("whole-transaction");
    await expect(service.deleteBackup({ id, kind: "target-recovery" })).rejects.toThrow("does not exist");
    expect(await readFile(join(files, "sole-note"), "utf8")).toBe("not committed anywhere");
    expect(deleteCleanupBackup).not.toHaveBeenCalled();
  });
  it("protects required Target backups and cleans only expired eligible backups", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-backup-maintenance-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const dates = [
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-06-25T00:00:00.000Z",
      "2026-01-15T00:00:00.000Z",
      "2026-06-28T00:00:00.000Z"
    ];
    let dateIndex = 0;
    const backupStore = createBackupStore(paths, {
      now: () => new Date(dates[dateIndex++] ?? dates.at(-1) ?? "2026-07-01T00:00:00.000Z")
    });
    const instructionsPath = join(root, "home", ".config", "opencode", "AGENTS.md");
    await mkdir(join(root, "home", ".config", "opencode"), { recursive: true });
    await writeFile(instructionsPath, "# Previous instructions\n");
    const baseline = await backupStore.createBackup([instructionsPath], {
      operation: "apply",
      targetId: "opencode",
      profileId: "daily",
      profileName: "Daily"
    });
    const recovery = await backupStore.createBackup([], {
      operation: "apply",
      targetId: "opencode",
      profileId: "daily",
      profileName: "Daily"
    });
    const latestOpenCode = await backupStore.createBackup([], {
      operation: "apply",
      targetId: "opencode",
      profileId: "daily",
      profileName: "Daily"
    });
    const expiredCodex = await backupStore.createBackup([], {
      operation: "apply",
      targetId: "codex",
      profileId: "review",
      profileName: "Review"
    });
    const latestCodex = await backupStore.createBackup([], {
      operation: "apply",
      targetId: "codex",
      profileId: "review",
      profileName: "Review"
    });
    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeFile(join(paths.targetStatesDir, "opencode.json"), JSON.stringify({
      formatVersion: 2,
      managedMcpNames: [],
      activeProfileId: "daily",
      recoveryRequired: {
        operation: "apply",
        error: "Interrupted",
        backupId: recovery.id,
        occurredAt: "2026-02-01T00:00:00.000Z"
      }
    }));

    const cleanupId = "cleanup-old";
    const cleanupDir = join(paths.backupsDir, "skill-cleanup", cleanupId);
    await mkdir(cleanupDir, { recursive: true });
    await writeFile(join(cleanupDir, "payload.txt"), "cleanup payload");
    const restoredCleanupId = "cleanup-restored-1700000000000";
    const restoredCleanupDir = join(paths.backupsDir, "skill-cleanup-restored", restoredCleanupId);
    await mkdir(restoredCleanupDir, { recursive: true });
    await writeFile(join(restoredCleanupDir, "manifest.json"), JSON.stringify({
      id: "cleanup-restored",
      libraryId: "restored-reviewer",
      createdAt: "2026-01-11T00:00:00.000Z",
      operation: "cleanup",
      entries: []
    }));
    const deleteCleanupBackup = vi.fn(async (id: string) => {
      await rm(join(paths.backupsDir, "skill-cleanup", id), { recursive: true, force: true });
    });
    const service = createBackupMaintenanceService(
      paths,
      backupStore,
      {
        listCleanupBackups: vi.fn().mockResolvedValue([{
          id: cleanupId,
          libraryId: "reviewer",
          createdAt: "2026-01-10T00:00:00.000Z",
          locationCount: 1,
          operation: "cleanup"
        }]),
        previewCleanupBackup: vi.fn().mockResolvedValue([
          { path: join(root, "home", ".agents", "skills", "reviewer"), state: "saved" }
        ]),
        deleteCleanupBackup
      },
      { readSettings: vi.fn().mockResolvedValue({ backupRetentionDays: 30 }) },
      { now: () => new Date("2026-07-01T00:00:00.000Z") }
    );

    const inventory = await service.listInventory();
    expect(inventory.items.find((item) => item.id === baseline.id)).toMatchObject({
      cleanupStatus: "required",
      requiredReason: "takeover-baseline",
      deletable: false
    });
    expect(inventory.items.find((item) => item.id === recovery.id)).toMatchObject({
      cleanupStatus: "required",
      requiredReason: "recovery-required",
      deletable: false
    });
    expect(inventory.items.find((item) => item.id === latestOpenCode.id)?.cleanupStatus).toBe("retained");
    expect(inventory.items.find((item) => item.id === expiredCodex.id)?.cleanupStatus).toBe("eligible");
    expect(inventory.items.find((item) => item.id === latestCodex.id)?.cleanupStatus).toBe("retained");
    expect(inventory.items.find((item) => item.id === cleanupId)?.cleanupStatus).toBe("eligible");
    expect(inventory.items.find((item) => item.id === restoredCleanupId)).toMatchObject({
      restored: true,
      cleanupStatus: "eligible"
    });
    await expect(service.previewBackup({
      id: baseline.id,
      kind: "target-recovery"
    })).resolves.toMatchObject({
      files: [{ kind: "file", path: instructionsPath, state: "saved" }]
    });
    await expect(service.previewBackup({
      id: cleanupId,
      kind: "skill-cleanup"
    })).resolves.toMatchObject({
      files: [{ path: join(root, "home", ".agents", "skills", "reviewer"), state: "saved" }]
    });

    const result = await service.cleanup();
    expect(result).toMatchObject({ deletedCount: 3, failures: [] });
    expect(result.deletedItems).toEqual(expect.arrayContaining([
      { id: expiredCodex.id, kind: "target-recovery" },
      { id: cleanupId, kind: "skill-cleanup" },
      { id: restoredCleanupId, kind: "skill-cleanup" }
    ]));
    await expect(backupStore.readBackup(expiredCodex.id)).rejects.toThrow();
    await expect(readFile(join(cleanupDir, "payload.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(join(restoredCleanupDir, "manifest.json"), "utf8")).rejects.toThrow();
    await expect(backupStore.readBackup(baseline.id)).resolves.toBeTruthy();
    expect(deleteCleanupBackup).toHaveBeenCalledWith(cleanupId);
  });

  it("keeps all backups when retention is disabled and blocks manual deletion of required backups", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-backup-maintenance-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const backupStore = createBackupStore(paths, {
      now: () => new Date("2025-01-01T00:00:00.000Z")
    });
    const backup = await backupStore.createBackup([], {
      operation: "apply",
      targetId: "opencode",
      profileId: "daily"
    });
    await symlink(join(paths.backupsDir, backup.id), join(paths.backupsDir, backup.id, "cycle"));
    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeFile(join(paths.targetStatesDir, "opencode.json"), JSON.stringify({
      formatVersion: 2,
      managedMcpNames: [],
      activeProfileId: "daily"
    }));
    const service = createBackupMaintenanceService(
      paths,
      backupStore,
      {
        listCleanupBackups: vi.fn().mockResolvedValue([]),
        previewCleanupBackup: vi.fn().mockResolvedValue([]),
        deleteCleanupBackup: vi.fn()
      },
      { readSettings: vi.fn().mockResolvedValue({ backupRetentionDays: null }) },
      { now: () => new Date("2026-07-01T00:00:00.000Z") }
    );

    await expect(service.deleteBackup({ id: backup.id, kind: "target-recovery" }))
      .rejects.toThrow("required for recovery");
    await expect(service.cleanup()).resolves.toEqual({ deletedCount: 0, freedBytes: 0, failures: [], deletedItems: [] });
  });

  it("fails closed when Target state cannot be read safely", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-backup-maintenance-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const backupStore = createBackupStore(paths, {
      now: () => new Date("2025-01-01T00:00:00.000Z")
    });
    const backup = await backupStore.createBackup([], {
      operation: "apply",
      targetId: "opencode",
      profileId: "daily"
    });
    await mkdir(paths.targetStatesDir, { recursive: true });
    await writeFile(join(paths.targetStatesDir, "opencode.json"), "{not-json");
    const service = createBackupMaintenanceService(
      paths,
      backupStore,
      {
        listCleanupBackups: vi.fn().mockResolvedValue([]),
        previewCleanupBackup: vi.fn().mockResolvedValue([]),
        deleteCleanupBackup: vi.fn()
      },
      { readSettings: vi.fn().mockResolvedValue({ backupRetentionDays: 30 }) }
    );

    await expect(service.listInventory()).rejects.toThrow("Cannot safely evaluate backup protections");
    await expect(service.deleteBackup({ id: backup.id, kind: "target-recovery" }))
      .rejects.toThrow("Cannot safely evaluate backup protections");
    await expect(backupStore.readBackup(backup.id)).resolves.toBeTruthy();
  });

  it("protects cleanup and Workspace safety backups while recovery is pending", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-backup-maintenance-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const dates = [
      "2025-01-01T00:00:00.000Z",
      "2025-01-02T00:00:00.000Z",
      "2025-01-03T00:00:00.000Z"
    ];
    let index = 0;
    const backupStore = createBackupStore(paths, {
      now: () => new Date(dates[index++] ?? dates.at(-1)!)
    });
    const workspaceRequested = await backupStore.createBackup([], { operation: "workspace-sync" });
    const workspaceSafety = await backupStore.createBackup([], { operation: "rollback-safety" });
    const cleanupSafety = await backupStore.createBackup([], { operation: "rollback-safety" });
    const sourceMergeRequested = await backupStore.createBackup([], { operation: "data-import" });
    const sourceMergeSafety = await backupStore.createBackup([], { operation: "rollback-safety" });
    await mkdir(join(paths.backupsDir, "skill-cleanup", "cleanup-pending"), { recursive: true });
    await mkdir(join(paths.workspaceSyncJournalPath, ".."), { recursive: true });
    await writeFile(paths.workspaceSyncJournalPath, JSON.stringify({
      formatVersion: 1,
      backupId: workspaceRequested.id,
      safetyBackupId: workspaceSafety.id,
      phase: "rollback-required"
    }));
    const sourceMergeReport = join(
      paths.appDataRoot,
      "skill-source-merge-backups",
      "skill-source-merge-pending"
    );
    await mkdir(sourceMergeReport, { recursive: true });
    await writeFile(join(sourceMergeReport, "manifest.json"), JSON.stringify({
      status: "recovery-required",
      transactionBackupId: sourceMergeRequested.id,
      safetyBackupId: sourceMergeSafety.id
    }));
    const deleteCleanupBackup = vi.fn();
    const service = createBackupMaintenanceService(
      paths,
      backupStore,
      {
        listCleanupBackups: vi.fn().mockResolvedValue([{
          id: "cleanup-pending",
          libraryId: "reviewer",
          createdAt: "2025-01-01T00:00:00.000Z",
          locationCount: 1,
          operation: "cleanup",
          recoveryRequired: true,
          safetyBackupId: cleanupSafety.id
        }]),
        previewCleanupBackup: vi.fn().mockResolvedValue([]),
        deleteCleanupBackup
      },
      { readSettings: vi.fn().mockResolvedValue({ backupRetentionDays: 1 }) },
      { now: () => new Date("2026-07-01T00:00:00.000Z") }
    );

    const inventory = await service.listInventory();
    for (const id of [
      workspaceRequested.id,
      workspaceSafety.id,
      cleanupSafety.id,
      sourceMergeRequested.id,
      sourceMergeSafety.id
    ]) {
      expect(inventory.items.find((item) => item.id === id)).toMatchObject({
        cleanupStatus: "required",
        deletable: false
      });
    }
    expect(inventory.items.find((item) => item.id === "cleanup-pending")).toMatchObject({
      cleanupStatus: "required",
      requiredReason: "recovery-required",
      deletable: false
    });
    await expect(service.cleanup()).resolves.toEqual({
      deletedCount: 0,
      freedBytes: 0,
      failures: [],
      deletedItems: []
    });
    expect(deleteCleanupBackup).not.toHaveBeenCalled();
  });
});
