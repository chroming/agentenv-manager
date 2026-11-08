import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createBackupStore } from "../../src/main/backupStore";
import { createSkillMutationRecoveryGate } from "../../src/main/skillMutationRecoveryGate";
import { assertWorkspaceRecoveryScope, localMutationScope } from "../../src/main/ipc/mutationScope";
import { createSettingsStore, type SettingsStore } from "../../src/main/settingsStore";
import type { ProfileStore } from "../../src/main/profileStore";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
const fixture = async () => {
  root = await mkdtemp(join(tmpdir(), "aem-mutation-scope-"));
  const paths = createPaths({ appDataRoot: join(root, "data") });
  const store = createBackupStore(paths), first = join(paths.skillsLibraryDir, "first");
  await mkdir(first, { recursive: true });
  const backup = await store.createBackup([first]);
  return { paths, store, first, backup };
};

it("protects only the receipted source-merge paths, not unrelated Profiles or Skills", async () => {
  const { paths, store, first, backup } = await fixture();
  const journal = join(paths.appDataRoot, "skill-source-merge-backups", "pending");
  await mkdir(journal, { recursive: true });
  await writeFile(join(journal, "manifest.json"), JSON.stringify({ formatVersion: 1, operation: "merge-skill-sources", createdAt: new Date().toISOString(), status: "recovery-required", transactionBackupId: backup.id }));
  const gate = createSkillMutationRecoveryGate({ appDataRoot: paths.appDataRoot, backupStore: store,
    skillLibraryStore: { listPendingCleanupRecoveries: async () => [], recoverInterruptedCleanupBackups: async () => ({ recoveredIds: [], recoveryRequiredIds: [] }) } });
  await gate.refresh();
  await expect(gate.run("profiles:save", () => "saved", [join(paths.profilesDir, "other")])).resolves.toBe("saved");
  await expect(gate.run("skills:update-library", () => "updated", [join(paths.skillsLibraryDir, "second")])).resolves.toBe("updated");
  await expect(gate.run("skills:update-library", () => "unsafe", [first])).rejects.toThrow("pending");
  await expect(gate.run("activation:apply", () => "unknown")).rejects.toThrow("pending");
});

it("allows disjoint resources during Sync recovery but rejects overlap including aliases", async () => {
  const { paths, store, first, backup } = await fixture();
  await writeFile(paths.workspaceSyncJournalPath, JSON.stringify({ formatVersion: 2, backupId: backup.id }));
  await expect(assertWorkspaceRecoveryScope(paths, store, "profiles:save", [join(paths.profilesDir, "other")])).resolves.toBeUndefined();
  await expect(assertWorkspaceRecoveryScope(paths, store, "skills:update-library", [first])).rejects.toThrow("recovery");
  if (process.platform !== "win32") {
    const alias = join(root, "alias"); await symlink(first, alias, "dir");
    await expect(assertWorkspaceRecoveryScope(paths, store, "skills:update-library", [alias])).rejects.toThrow("recovery");
  }
});

it("keeps ordinary preferences usable even when a Sync journal is unreadable", async () => {
  const { paths, store } = await fixture();
  await writeFile(paths.workspaceSyncJournalPath, "invalid JSON");
  const current = { locale: "en", skillStorageLocation: "app-data", targetConfigRoots: {} };
  const scope = await localMutationScope("settings:update", [{ ...current, locale: "zh_CN" }], {
    paths, settingsStore: { readSettings: async () => current } as SettingsStore, profileStore: {} as ProfileStore
  });
  await expect(assertWorkspaceRecoveryScope(paths, store, "settings:update", scope)).resolves.toBeUndefined();
  await expect(assertWorkspaceRecoveryScope(paths, store, "profiles:save", [join(paths.profilesDir, "first")])).rejects.toThrow("recovery");
});

it.each([false, true])("guards the Skill update policy's Library ID with a source edit: %s", async (changeSource) => {
  const { paths, store, first, backup } = await fixture();
  await writeFile(paths.workspaceSyncJournalPath, JSON.stringify({ formatVersion: 2, backupId: backup.id }));
  const services = { paths, settingsStore: createSettingsStore(paths), profileStore: {} as ProfileStore };
  const scope = await localMutationScope("skills:set-update-settings", [{
    policy: { id: "first", policy: "tracked" },
    ...(changeSource ? { source: { id: "first", sourceType: "local", source: join(root, "source") } } : {}),
  }], services);
  expect(scope).toEqual([join(first, ".agentenv-skill.json"), paths.skillSourcesPath]);
  await expect(assertWorkspaceRecoveryScope(paths, store, "skills:set-update-settings", scope)).rejects.toThrow("recovery");
});
