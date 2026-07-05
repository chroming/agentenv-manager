import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDataBackup,
  inspectDataBackup,
  restoreDataBackup
} from "../../src/main/dataBackupService";
import { createPaths } from "../../src/main/paths";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("AgentEnv data backup service", () => {
  it("backs up and restores the complete application data directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const paths = createPaths({ appDataRoot: join(root, "active-data") });
    const backupRoot = join(root, "exports");
    await mkdir(join(paths.profilesDir, "daily-coding"), { recursive: true });
    await mkdir(backupRoot, { recursive: true });
    await writeFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "# Original\n");
    await writeFile(paths.mcpLibraryPath, "[]\n");

    const backup = await createDataBackup(paths, backupRoot);
    const preview = await inspectDataBackup(backup.path);
    expect(preview.formatVersion).toBe(1);
    expect(preview.topLevelItemCount).toBe(2);

    await writeFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "# Changed\n");
    await writeFile(join(paths.appDataRoot, "temporary.json"), "{}\n");
    const result = await restoreDataBackup(paths, backup.path);

    await expect(
      readFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "utf8")
    ).resolves.toBe("# Original\n");
    await expect(readFile(paths.mcpLibraryPath, "utf8")).resolves.toBe("[]\n");
    await expect(readFile(join(paths.appDataRoot, "temporary.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(inspectDataBackup(result.safetyBackupPath)).resolves.toMatchObject({
      formatVersion: 1
    });
  });

  it("rejects exports inside the active AgentEnv data directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const paths = createPaths({ appDataRoot: join(root, "active-data") });
    await mkdir(paths.appDataRoot, { recursive: true });

    await expect(createDataBackup(paths, paths.appDataRoot)).rejects.toThrow(
      "outside the active data directory"
    );
  });

  it("rejects folders without a supported AgentEnv backup manifest", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const invalid = join(root, "invalid");
    await mkdir(invalid, { recursive: true });
    await writeFile(join(invalid, "agentenv-backup.json"), '{"formatVersion":99}\n');

    await expect(inspectDataBackup(invalid)).rejects.toThrow(
      "Unsupported or invalid AgentEnv backup"
    );
  });

  it("rejects restore packages containing symbolic links", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const backup = join(root, "backup");
    await mkdir(join(backup, "data"), { recursive: true });
    await writeFile(
      join(backup, "agentenv-backup.json"),
      '{"formatVersion":1,"createdAt":"2026-07-12T00:00:00.000Z"}\n'
    );
    await symlink(root, join(backup, "data", "escape"));

    await expect(inspectDataBackup(backup)).rejects.toThrow("cannot contain symbolic links");
  });
});
