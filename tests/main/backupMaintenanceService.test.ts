import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
    await expect(service.cleanup()).resolves.toEqual({ deletedCount: 0, freedBytes: 0, failures: [] });
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
});
