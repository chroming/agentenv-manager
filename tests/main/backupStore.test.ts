import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackupStore } from "../../src/main/backupStore";
import { createPaths } from "../../src/main/paths";

let root = "";

const makePaths = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-backup-"));
  const codexHome = join(root, ".codex");
  const userSkillsDir = join(root, ".agents", "skills");
  await mkdir(codexHome, { recursive: true });
  await mkdir(userSkillsDir, { recursive: true });
  return createPaths({ appDataRoot: root, codexHome, userSkillsDir });
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("backup store", () => {
  it("creates a backup manifest with sha256 entries", async () => {
    const paths = await makePaths();
    await writeFile(paths.globalAgentsPath, "# Agent\n");
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });

    const manifest = await store.createBackup([paths.globalAgentsPath]);

    expect(manifest.id).toBe("2026-06-30T00-00-00-000Z");
    expect(manifest.entries[0]).toMatchObject({
      sourcePath: paths.globalAgentsPath,
      missing: false
    });
    expect(manifest.entries[0]?.sha256).toHaveLength(64);
    await expect(readFile(manifest.entries[0]?.backupPath ?? "", "utf8")).resolves.toBe(
      "# Agent\n"
    );
  });

  it("records missing files instead of crashing", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });

    const manifest = await store.createBackup([paths.codexConfigPath]);

    expect(manifest.entries[0]).toMatchObject({
      sourcePath: paths.codexConfigPath,
      missing: true
    });
    expect(manifest.entries[0]?.backupPath).toBeUndefined();
  });

  it("creates the backup root with owner-only permissions where supported", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });

    await store.createBackup([]);
    const mode = (await stat(paths.backupsDir)).mode & 0o777;

    expect(mode).toBe(0o700);
  });

  it("keeps backups unique when multiple operations share the same timestamp", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });

    const first = await store.createBackup([]);
    const second = await store.createBackup([]);

    expect(first.id).toBe("2026-06-30T00-00-00-000Z");
    expect(second.id).toBe("2026-06-30T00-00-00-000Z-1");
    await expect(store.listBackups()).resolves.toHaveLength(2);
  });

  it("ignores non-activation backup namespaces", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    await store.createBackup([]);
    await mkdir(join(paths.backupsDir, "skill-cleanup", "cleanup-1"), { recursive: true });

    await expect(store.listBackups()).resolves.toEqual([
      {
        id: "2026-06-30T00-00-00-000Z",
        createdAt: "2026-06-30T00:00:00.000Z",
        fileCount: 0
      }
    ]);
  });

  it("rejects a tampered manifest that expands rollback outside a safe id", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const manifest = await store.createBackup([], {
      profileId: "daily-coding",
      targetId: "opencode"
    });
    const manifestPath = join(paths.backupsDir, manifest.id, "manifest.json");
    const tampered = JSON.parse(await readFile(manifestPath, "utf8"));
    tampered.profileId = "../../outside";
    await writeFile(manifestPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    await expect(store.readBackup(manifest.id)).rejects.toThrow();
  });

  it("rejects a backup file replaced by a symbolic link", async () => {
    const paths = await makePaths();
    const source = paths.globalAgentsPath;
    const unrelated = join(root, "unrelated.txt");
    await writeFile(source, "# Agent\n", "utf8");
    await writeFile(unrelated, "do not restore me\n", "utf8");
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const manifest = await store.createBackup([source]);
    const backupPath = manifest.entries[0]?.backupPath ?? "";
    await rm(backupPath);
    await symlink(unrelated, backupPath);

    await expect(store.readBackup(manifest.id)).rejects.toThrow(
      "backup content does not match its manifest"
    );
  });

  it("deletes only the validated backup directory", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const manifest = await store.createBackup([]);

    await store.deleteBackup(manifest.id);

    await expect(store.listBackups()).resolves.toEqual([]);
    await expect(store.deleteBackup("../../outside")).rejects.toThrow();
  });
});
