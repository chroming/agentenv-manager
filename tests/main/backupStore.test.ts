import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
});
