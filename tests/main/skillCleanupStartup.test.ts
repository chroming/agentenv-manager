import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSkillCleanupBackupStore } from "../../src/main/skillCleanupBackupStore";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it("does not resolve Agent paths or inspect completed backup payloads during startup recovery", async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-startup-backups-"));
  const paths = createPaths({ appDataRoot: root });
  const targetPathsProvider = vi.fn(() => []);
  const store = createSkillCleanupBackupStore({ paths, targetPathsProvider, resolveLibraryDir: async () => paths.skillsLibraryDir });
  const id = "completed-cleanup";
  const directory = join(paths.backupsDir, "skill-cleanup", id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    formatVersion: 2, id, libraryId: "example", libraryCreated: false,
    createdAt: new Date().toISOString(), status: "complete", expectedPaths: [], entries: [
      { sourcePath: join(paths.skillsLibraryDir, "example"), backupPath: join(directory, "files", "example"), sha256: "invalid" }
    ]
  }));
  expect(await store.recoverInterruptedCleanupBackups()).toEqual({ recoveredIds: [], recoveryRequiredIds: [] });
  expect(await store.listPendingCleanupRecoveries()).toEqual([]);
  expect(targetPathsProvider).not.toHaveBeenCalled();
  await expect(store.readCleanupBackup(id)).rejects.toThrow();
});

it("keeps an invalid unfinished backup pending without allowing recovery writes", async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-startup-pending-"));
  const paths = createPaths({ appDataRoot: root });
  const store = createSkillCleanupBackupStore({ paths, targetPathsProvider: () => [], resolveLibraryDir: async () => paths.skillsLibraryDir });
  const directory = join(paths.backupsDir, "skill-cleanup", "unfinished");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ formatVersion: 2, status: "prepared" }));
  expect(await store.recoverInterruptedCleanupBackups()).toEqual({ recoveredIds: [], recoveryRequiredIds: ["unfinished"] });
  expect(await store.listPendingCleanupRecoveries()).toEqual(["unfinished"]);
});
