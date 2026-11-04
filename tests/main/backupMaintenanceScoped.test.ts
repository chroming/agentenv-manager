import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createBackupStore } from "../../src/main/backupStore";
import { createBackupMaintenanceService } from "../../src/main/backupMaintenanceService";
import { writeConversationDeletionPhase } from "../../src/main/conversations/conversationDeletion";

let root = "";
afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); });
const fixture = async () => {
  root = await mkdtemp(join(tmpdir(), "aem-backup-scope-"));
  const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
  const store = createBackupStore(paths);
  const cleanup = { listCleanupBackups: vi.fn().mockResolvedValue([]), previewCleanupBackup: vi.fn(), deleteCleanupBackup: vi.fn() };
  const service = createBackupMaintenanceService(paths, store, cleanup, { readSettings: vi.fn().mockResolvedValue({ backupRetentionDays: 30 }) });
  return { paths, store, service };
};

it("previews exactly one backup without listing and verifying all other backup payloads", async () => {
  const { store, service } = await fixture();
  const backup = await store.createBackup([]);
  vi.spyOn(store, "listBackups").mockRejectedValue(new Error("unrelated payload scan"));
  await expect(service.previewBackup({ id: backup.id, kind: "target-recovery" })).resolves.toMatchObject({ files: [] });
});

it("deletes completed conversation Trash despite an unrelated corrupt Target recovery record", async () => {
  const { paths, store, service } = await fixture();
  const backup = await store.createBackup([], { operation: "conversation-delete", conversation: { conversationId: "test", title: "Fixture", agentId: "codex", sourceKey: "local", roots: [root] } });
  await writeConversationDeletionPhase(paths.backupsDir, backup.id, "deleted");
  await mkdir(paths.targetStatesDir, { recursive: true });
  await writeFile(join(paths.targetStatesDir, "unrelated.json"), "invalid JSON");
  vi.spyOn(store, "listBackupMetadata").mockRejectedValue(new Error("An unrelated backup catalog is unavailable"));
  expect((await service.deleteBackup({ id: backup.id, kind: "conversation-delete" })).deletedCount).toBe(1);
});

it("uses only the selected cleanup metadata instead of verifying all cleanup payloads", async () => {
  const { paths, store } = await fixture();
  const readMetadata = vi.fn().mockResolvedValue([{ id: "selected", libraryId: "review", createdAt: new Date().toISOString(), locationCount: 1 }]);
  const cleanup = { listCleanupBackups: vi.fn().mockRejectedValue(new Error("Unrelated payload unavailable")),
    listCleanupBackupMetadata: readMetadata, previewCleanupBackup: vi.fn(), deleteCleanupBackup: vi.fn() };
  const service = createBackupMaintenanceService(paths, store, cleanup, { readSettings: async () => ({ backupRetentionDays: 30 }) });
  await expect(service.deleteBackup({ id: "selected", kind: "skill-cleanup" })).resolves.toMatchObject({ deletedCount: 1 });
  expect(readMetadata).toHaveBeenCalledWith("selected");
  expect(cleanup.listCleanupBackups).not.toHaveBeenCalled();
});

it("still protects a conversation recovery that has not completed", async () => {
  const { paths, store, service } = await fixture();
  const backup = await store.createBackup([], { operation: "conversation-delete" });
  await writeConversationDeletionPhase(paths.backupsDir, backup.id, "deleting");
  await expect(service.deleteBackup({ id: backup.id, kind: "conversation-delete" })).rejects.toThrow("required for recovery");
  expect(await readFile(join(paths.backupsDir, backup.id, "manifest.json"), "utf8")).toContain(backup.id);
});
