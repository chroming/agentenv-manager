import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createBackupStore } from "./backupStore";
import { createUnifiedDiff } from "./diff";
import {
  pathExists,
  readTextIfExists,
  writeAtomic
} from "./fileUtils";
import type { AgentEnvPaths } from "./paths";
import type { ProfileStore } from "./profileStore";
import {
  createTargetRegistry,
  type TargetRegistry
} from "./targets/registry";
import type {
  ActivationPreview,
  ApplyResult,
  BackupManifest,
  PlannedFileChange,
  RollbackPreview,
  RollbackResult,
  TargetState
} from "../shared/types";

export interface ActivationServiceOptions {
  paths: AgentEnvPaths;
  profileStore: ProfileStore;
  targetRegistry?: TargetRegistry;
  allowRealHomeWrites?: boolean;
}

export interface ActivationService {
  previewProfile(profileId: string): Promise<ActivationPreview>;
  applyProfile(profileId: string, previewId: string): Promise<ApplyResult>;
  previewRollback(backupId: string): Promise<RollbackPreview>;
  rollback(backupId: string): Promise<RollbackResult>;
}

const DEFAULT_TARGET_STATE: TargetState = {
  managedConfigKeys: [],
  managedMcpNames: []
};

const hashText = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const isDirectoryReadError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EISDIR"
  );

const readRollbackTextIfExists = async (path: string) => {
  try {
    return await readTextIfExists(path);
  } catch (error) {
    if (isDirectoryReadError(error)) {
      return "[directory]\n";
    }
    throw error;
  }
};

const appendHistory = async (
  paths: AgentEnvPaths,
  event: Record<string, unknown>
) => {
  await mkdir(paths.appDataRoot, { recursive: true, mode: 0o700 });
  await appendFile(
    paths.activationHistoryPath,
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
    "utf8"
  );
};

const normalizeTargetState = (value: unknown): TargetState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_TARGET_STATE;
  }
  const record = value as Partial<TargetState>;
  return {
    managedConfigKeys: Array.isArray(record.managedConfigKeys)
      ? record.managedConfigKeys.filter((item): item is string => typeof item === "string")
      : [],
    managedMcpNames: Array.isArray(record.managedMcpNames)
      ? record.managedMcpNames.filter((item): item is string => typeof item === "string")
      : []
  };
};

const createRollbackChange = async (
  entry: BackupManifest["entries"][number]
): Promise<PlannedFileChange> => {
  if (entry.kind === "directory") {
    const before = (await pathExists(entry.sourcePath)) ? "[directory]\n" : "";
    const after = entry.missing ? "" : "[directory]\n";

    return {
      path: entry.sourcePath,
      before,
      after,
      diff: createUnifiedDiff(entry.sourcePath, before, after)
    };
  }

  const before = await readRollbackTextIfExists(entry.sourcePath);
  const after = entry.missing ? "" : await readFile(entry.backupPath ?? "", "utf8");

  return {
    path: entry.sourcePath,
    before,
    after,
    diff: createUnifiedDiff(entry.sourcePath, before, after)
  };
};

const restoreBackupEntries = async (backup: BackupManifest) => {
  for (const entry of backup.entries) {
    if (entry.missing) {
      await rm(entry.sourcePath, { recursive: true, force: true });
      continue;
    }

    if (entry.kind === "directory") {
      await rm(entry.sourcePath, { recursive: true, force: true });
      await mkdir(dirname(entry.sourcePath), { recursive: true });
      await cp(entry.backupPath ?? "", entry.sourcePath, { recursive: true });
      continue;
    }

    const content = await readFile(entry.backupPath ?? "", "utf8");
    await writeAtomic(entry.sourcePath, content);
  }
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const validateProfileStructure = (profile: Awaited<ReturnType<ProfileStore["readProfile"]>>) => {
  const errors: string[] = [];

  if (
    profile.manifest.managed.instructions &&
    profile.instructions.trim().length === 0
  ) {
    errors.push("Managed instructions are empty");
  }

  return errors;
};

export const createActivationService = ({
  paths,
  profileStore,
  targetRegistry = createTargetRegistry(),
  allowRealHomeWrites = false
}: ActivationServiceOptions): ActivationService => {
  const backupStore = createBackupStore(paths);
  const previews = new Map<string, ActivationPreview>();

  const statePathFor = (targetId: string) =>
    join(paths.targetStatesDir, `${targetId}.json`);

  const readTargetStateFile = async (targetId: string) => {
    const path = statePathFor(targetId);
    const content = await readTextIfExists(path);
    if (content.trim().length === 0) {
      return { path, content, state: DEFAULT_TARGET_STATE };
    }

    try {
      return {
        path,
        content,
        state: normalizeTargetState(JSON.parse(content))
      };
    } catch {
      return {
        path,
        content,
        state: DEFAULT_TARGET_STATE
      };
    }
  };

  const writeTargetState = async (targetId: string, state: TargetState) => {
    await mkdir(paths.targetStatesDir, { recursive: true, mode: 0o700 });
    await writeAtomic(statePathFor(targetId), `${JSON.stringify(state, null, 2)}\n`);
  };

  const previewProfile = async (profileId: string): Promise<ActivationPreview> => {
    const profile = await profileStore.readProfile(profileId);
    const adapter = targetRegistry.get(profile.manifest.targetId);
    const targetPaths = adapter.createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    const stateFile = await readTargetStateFile(adapter.descriptor.id);
    const targetPreview = await adapter.createPreview({
      profile,
      targetPaths,
      state: stateFile.state
    });
    const profileErrors = validateProfileStructure(profile);
    const assetErrors = await adapter.validateAssets({ profile, targetPaths });
    const preview: ActivationPreview = {
      id: randomUUID(),
      profileId: profile.id,
      targetId: adapter.descriptor.id,
      createdAt: new Date().toISOString(),
      warnings: targetPreview.warnings,
      errors: targetPreview.errors.concat(profileErrors, assetErrors),
      changes: targetPreview.changes,
      liveFingerprints: {
        ...targetPreview.liveFingerprints,
        [stateFile.path]: hashText(stateFile.content)
      },
      targetState: targetPreview.targetState
    };
    previews.set(preview.id, preview);
    return preview;
  };

  const applyProfile = async (
    profileId: string,
    previewId: string
  ): Promise<ApplyResult> => {
    const preview = previews.get(previewId);
    if (!preview || preview.profileId !== profileId) {
      return { ok: false, errors: ["Preview not found for profile"] };
    }
    if (preview.errors.length > 0) {
      return { ok: false, errors: preview.errors };
    }

    const profile = await profileStore.readProfile(profileId);
    const adapter = targetRegistry.get(preview.targetId);
    const targetPaths = adapter.createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    if (
      !allowRealHomeWrites &&
      !adapter.descriptor.realWritesEnabled &&
      resolve(paths.fakeHomeRoot) === resolve(paths.homeDir)
    ) {
      return {
        ok: false,
        errors: [`Real ${adapter.descriptor.name} writes are disabled`]
      };
    }

    for (const [path, fingerprint] of Object.entries(preview.liveFingerprints)) {
      const current = await readTextIfExists(path);
      if (hashText(current) !== fingerprint) {
        return { ok: false, errors: [`Live file changed after preview: ${path}`] };
      }
    }

    const assetErrors = await adapter.validateAssets({ profile, targetPaths });
    if (assetErrors.length > 0) {
      return { ok: false, errors: assetErrors };
    }

    const statePath = statePathFor(preview.targetId);
    const assetBackupPaths = await adapter.getAssetBackupPaths({ profile, targetPaths });
    const backup = await backupStore.createBackup([
      ...preview.changes.map((change) => change.path),
      ...assetBackupPaths,
      statePath
    ]);

    try {
      for (const change of preview.changes) {
        await writeAtomic(change.path, change.after);
      }

      await adapter.applyAssets({ profile, targetPaths });
      await writeTargetState(preview.targetId, preview.targetState);
    } catch (error) {
      try {
        await restoreBackupEntries(backup);
      } catch (restoreError) {
        return {
          ok: false,
          errors: [
            `Failed to apply profile and failed to restore backup ${backup.id}: ${errorMessage(
              error
            )}; restore error: ${errorMessage(restoreError)}`
          ]
        };
      }

      return {
        ok: false,
        errors: [`Failed to apply profile; restored backup: ${errorMessage(error)}`]
      };
    }

    await appendHistory(paths, {
      type: "apply",
      profileId,
      targetId: preview.targetId,
      previewId,
      backupId: backup.id
    });

    return { ok: true, backupId: backup.id };
  };

  const previewRollback = async (backupId: string): Promise<RollbackPreview> => {
    const backup = await backupStore.readBackup(backupId);
    const changes = await Promise.all(backup.entries.map(createRollbackChange));
    return {
      id: backup.id,
      backupId: backup.id,
      createdAt: new Date().toISOString(),
      warnings: [],
      errors: [],
      changes
    };
  };

  const rollback = async (backupId: string): Promise<RollbackResult> => {
    const backup = await backupStore.readBackup(backupId);

    await restoreBackupEntries(backup);

    await appendHistory(paths, {
      type: "rollback",
      backupId
    });

    return { ok: true };
  };

  return {
    previewProfile,
    applyProfile,
    previewRollback,
    rollback
  };
};
