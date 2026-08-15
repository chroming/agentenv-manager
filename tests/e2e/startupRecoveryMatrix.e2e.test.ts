import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import {
  assertFilesystemSnapshotEqual,
  snapshotFilesystemTree
} from "../helpers/filesystemSnapshot";

const interruptedOperations = ["apply", "rollback"] as const;
let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

const createEnvironment = async () => {
  const root = await mkdtemp(join(tmpdir(), "agentenv-startup-recovery-matrix-"));
  roots.push(root);
  const paths = createPaths({
    appDataRoot: join(root, "data"),
    homeDir: join(root, "home")
  });
  await mkdir(paths.codexHome, { recursive: true });
  await writeFile(paths.globalAgentsPath, "# User data after interruption\n");
  const profileStore = createProfileStore(paths);
  const settingsStore = createSettingsStore(paths);
  await settingsStore.updateSettings({ enabledTargetIds: ["codex"] });
  await profileStore.saveProfile({
    manifest: {
      id: "recovery-profile",
      name: "Recovery Profile",
      description: "Exercises startup recovery behavior.",
      preferredTargetId: "codex",
      version: 2
    },
    instructions: "# Intended data\n",
    resources: { skills: [], mcpByTarget: {} }
  });
  return { paths, profileStore, settingsStore };
};

describe.each(interruptedOperations)("Interrupted %s startup state", (operation) => {
  it("fails closed and preserves the live Agent tree until recovery", async () => {
    const environment = await createEnvironment();
    await mkdir(environment.paths.targetStatesDir, { recursive: true });
    await writeFile(
      join(environment.paths.targetStatesDir, "codex.json"),
      `${JSON.stringify({
        formatVersion: 3,
        managedMcpNames: [],
        managedResources: [],
        sharedSkillPreparations: [],
        skillReceipts: [],
        recoveryRequired: {
          operation,
          error: `${operation} was interrupted by process exit`,
          backupId: `missing-${operation}-backup`,
          occurredAt: new Date(0).toISOString()
        }
      })}\n`
    );
    const before = await snapshotFilesystemTree(environment.paths.homeDir, {
      includeTimestamps: true
    });
    const service = createActivationService(environment);

    await expect(service.listTargetStates()).resolves.toContainEqual(
      expect.objectContaining({
        targetId: "codex",
        lifecycleStatus: "recovery-required",
        lifecycleReason: expect.stringContaining("interrupted")
      })
    );
    const preview = await service.previewProfile("recovery-profile", "codex");
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: "recovery-required",
      disposition: "block"
    }));
    await expect(service.applyProfile("recovery-profile", preview.id))
      .resolves.toMatchObject({ ok: false, kind: "blocked" });
    assertFilesystemSnapshotEqual(
      before,
      await snapshotFilesystemTree(environment.paths.homeDir, {
        includeTimestamps: true
      }),
      `Agent home while ${operation} recovery is pending`
    );
  });
});

describe("Corrupt Target state at startup", () => {
  it("does not replace invalid state with defaults or touch Agent files", async () => {
    const environment = await createEnvironment();
    await mkdir(environment.paths.targetStatesDir, { recursive: true });
    await writeFile(join(environment.paths.targetStatesDir, "codex.json"), "{ invalid json");
    const before = await snapshotFilesystemTree(environment.paths.homeDir, {
      includeTimestamps: true
    });
    const service = createActivationService(environment);

    await expect(service.listTargetStates()).resolves.toContainEqual(
      expect.objectContaining({
        targetId: "codex",
        lifecycleStatus: "recovery-required"
      })
    );
    await expect(service.previewProfile("recovery-profile", "codex"))
      .rejects.toThrow(/invalid/i);
    assertFilesystemSnapshotEqual(
      before,
      await snapshotFilesystemTree(environment.paths.homeDir, {
        includeTimestamps: true
      }),
      "Agent home with invalid management state"
    );
  });
});
