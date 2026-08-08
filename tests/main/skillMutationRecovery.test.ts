import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackupStore } from "../../src/main/backupStore";
import {
  createSkillCleanupBackupStore,
  type SkillCleanupBackupManifest
} from "../../src/main/skillCleanupBackupStore";
import {
  listPendingSkillSourceMerges,
  recoverInterruptedSkillSourceMerges
} from "../../src/main/skillSourceMergeService";
import { hashPathEntry } from "../../src/main/filesystemIntegrity";
import { createPaths } from "../../src/main/paths";
import { createSkillMutationRecoveryGate } from "../../src/main/skillMutationRecoveryGate";
import type { BackupStore } from "../../src/main/backupStore";
import type { SkillLibraryStore } from "../../src/main/skillLibraryStore";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const createCleanupFixture = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-skill-recovery-"));
  const paths = createPaths({ appDataRoot: join(root, "app-data") });
  const libraryDir = paths.skillsLibraryDir;
  const skillDir = join(libraryDir, "reviewer");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), "# Original\n");
  const store = createSkillCleanupBackupStore({
    paths,
    resolveLibraryDir: async () => libraryDir,
    targetPathsProvider: async () => []
  });
  const id = "cleanup-recovery-test";
  const backupDir = join(store.cleanupBackupRoot(), id);
  const manifest: SkillCleanupBackupManifest = {
    formatVersion: 2,
    id,
    libraryId: "reviewer",
    libraryCreated: false,
    createdAt: new Date(0).toISOString(),
    operation: "cleanup",
    status: "prepared",
    expectedPaths: await store.snapshotCleanupPaths([skillDir]),
    entries: []
  };
  await store.copyCleanupEntry(
    manifest.entries,
    skillDir,
    join(backupDir, "locations", "0-reviewer")
  );
  await store.writeCleanupManifest(manifest);
  return { paths, skillDir, store, manifest };
};

describe("Skill mutation recovery", () => {
  it("rolls back a receipted interrupted cleanup", async () => {
    const { skillDir, store, manifest } = await createCleanupFixture();
    const claim = store.createCleanupPathClaimer(manifest);
    await claim(skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "# Mutated\n");
    await claim.recordMutation(skillDir);

    await expect(store.recoverInterruptedCleanupBackups()).resolves.toEqual({
      recoveredIds: [manifest.id],
      recoveryRequiredIds: []
    });
    await expect(readFile(join(skillDir, "SKILL.md"), "utf8")).resolves.toBe("# Original\n");
    const [summary] = await store.listCleanupBackups();
    expect(summary).toMatchObject({ id: manifest.id });
    expect(summary?.recoveryRequired).not.toBe(true);
  });

  it("preserves external changes made after the cleanup receipt", async () => {
    const { skillDir, store, manifest } = await createCleanupFixture();
    const claim = store.createCleanupPathClaimer(manifest);
    await claim(skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "# Mutated\n");
    await claim.recordMutation(skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "# External change\n");

    await expect(store.recoverInterruptedCleanupBackups()).resolves.toEqual({
      recoveredIds: [],
      recoveryRequiredIds: [manifest.id]
    });
    await expect(readFile(join(skillDir, "SKILL.md"), "utf8")).resolves.toBe(
      "# External change\n"
    );
  });

  it("requires recovery when an interrupted cleanup changed a path without a receipt", async () => {
    const { skillDir, store, manifest } = await createCleanupFixture();
    const claim = store.createCleanupPathClaimer(manifest);
    await claim(skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "# Unreceipted change\n");

    await expect(store.recoverInterruptedCleanupBackups()).resolves.toEqual({
      recoveredIds: [],
      recoveryRequiredIds: [manifest.id]
    });
    await expect(readFile(join(skillDir, "SKILL.md"), "utf8")).resolves.toBe(
      "# Unreceipted change\n"
    );
  });

  it("blocks subsequent resource mutations while recovery remains required", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-recovery-gate-"));
    const gate = createSkillMutationRecoveryGate({
      appDataRoot: root,
      backupStore: {} as BackupStore,
      skillLibraryStore: {
        listPendingCleanupRecoveries: async () => ["cleanup-test"],
        recoverInterruptedCleanupBackups: async () => ({
          recoveredIds: [],
          recoveryRequiredIds: ["cleanup-test"]
        })
      } as Pick<
        SkillLibraryStore,
        "listPendingCleanupRecoveries" | "recoverInterruptedCleanupBackups"
      >
    });

    await gate.refresh();
    expect(() => gate.assertMutationAllowed("skills:import-local")).toThrow(
      "cleanup:cleanup-test"
    );
    expect(() => gate.assertMutationAllowed("conversations:list")).not.toThrow();
    expect(() => gate.assertMutationAllowed("skills:rollback-cleanup")).not.toThrow();
  });

  it("recovers a receipted interrupted source merge", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-source-merge-recovery-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data") });
    const registryPath = join(paths.appDataRoot, "skill-sources.json");
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(registryPath, "original\n");
    const backupStore = createBackupStore(paths, { now: () => new Date(0) });
    const backup = await backupStore.createBackup([registryPath]);
    await writeFile(registryPath, "mutated\n");
    const journalDir = join(paths.appDataRoot, "skill-source-merge-backups", "merge-test");
    await mkdir(journalDir, { recursive: true });
    await writeFile(
      join(journalDir, "manifest.json"),
      `${JSON.stringify({
        formatVersion: 1,
        operation: "merge-skill-sources",
        createdAt: new Date(0).toISOString(),
        status: "prepared",
        transactionBackupId: backup.id,
        mutationHashes: [{ path: registryPath, sha256: await hashPathEntry(registryPath) }]
      }, null, 2)}\n`
    );

    await expect(recoverInterruptedSkillSourceMerges(paths.appDataRoot, backupStore))
      .resolves.toEqual({ recoveredIds: ["merge-test"], recoveryRequiredIds: [] });
    await expect(readFile(registryPath, "utf8")).resolves.toBe("original\n");
    await expect(listPendingSkillSourceMerges(paths.appDataRoot)).resolves.toEqual([]);
  });
});
