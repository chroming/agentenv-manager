import {
  appendFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createActivationPreview,
  hashText
} from "./activationPlanner";
import { createBackupStore } from "./backupStore";
import { createUnifiedDiff } from "./diff";
import type { AgentEnvPaths } from "./paths";
import type { ProfileStore } from "./profileStore";
import type {
  ActivationPreview,
  ApplyResult,
  BackupManifest,
  PlannedFileChange,
  RollbackPreview,
  RollbackResult
} from "../shared/types";

export interface ActivationServiceOptions {
  paths: AgentEnvPaths;
  profileStore: ProfileStore;
  allowRealHomeWrites?: boolean;
}

export interface ActivationService {
  previewProfile(profileId: string): Promise<ActivationPreview>;
  applyProfile(profileId: string, previewId: string): Promise<ApplyResult>;
  previewRollback(backupId: string): Promise<RollbackPreview>;
  rollback(backupId: string): Promise<RollbackResult>;
}

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const readTextIfExists = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return "";
    }
    throw error;
  }
};

const writeAtomic = async (targetPath: string, content: string) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.agentenv-tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, targetPath);
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

const createRollbackChange = async (
  entry: BackupManifest["entries"][number]
): Promise<PlannedFileChange> => {
  const before = await readTextIfExists(entry.sourcePath);
  const after = entry.missing
    ? ""
    : await readFile(entry.backupPath ?? "", "utf8");

  return {
    path: entry.sourcePath,
    before,
    after,
    diff: createUnifiedDiff(entry.sourcePath, before, after)
  };
};

const markerPathFor = (targetDir: string) =>
  join(targetDir, ".agentenv-owner.json");

const isAgentEnvOwnedSkillDir = async (targetDir: string) => {
  try {
    await readFile(markerPathFor(targetDir), "utf8");
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

export const createActivationService = ({
  paths,
  profileStore,
  allowRealHomeWrites = false
}: ActivationServiceOptions): ActivationService => {
  const backupStore = createBackupStore(paths);
  const previews = new Map<string, ActivationPreview>();

  const previewProfile = async (profileId: string): Promise<ActivationPreview> => {
    const profile = await profileStore.readProfile(profileId);
    const preview = await createActivationPreview({ paths, profile });
    previews.set(preview.id, preview);
    return preview;
  };

  const findSkillCopyErrors = async (profileId: string): Promise<string[]> => {
    const profile = await profileStore.readProfile(profileId);
    const errors: string[] = [];

    for (const ownedSkill of profile.skillsPolicy.ownedSkillDirs) {
      const targetDir = join(paths.userSkillsDir, ownedSkill.targetName);
      if ((await pathExists(targetDir)) && !(await isAgentEnvOwnedSkillDir(targetDir))) {
        errors.push(
          `Skill target already exists and is not AgentEnv-owned: ${targetDir}`
        );
      }
    }

    return errors;
  };

  const copyOwnedSkills = async (profileId: string) => {
    const profile = await profileStore.readProfile(profileId);
    const profileDir = profile.profileDir ?? join(paths.profilesDir, profile.id);

    for (const ownedSkill of profile.skillsPolicy.ownedSkillDirs) {
      const sourceDir = join(profileDir, ownedSkill.source);
      const targetDir = join(paths.userSkillsDir, ownedSkill.targetName);

      if (await isAgentEnvOwnedSkillDir(targetDir)) {
        await rm(targetDir, { recursive: true, force: true });
      }

      await mkdir(dirname(targetDir), { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true });
      await writeFile(
        markerPathFor(targetDir),
        `${JSON.stringify({ profileId, source: ownedSkill.source }, null, 2)}\n`,
        "utf8"
      );
    }
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

    const realCodexHome = resolve(homedir(), ".codex");
    const realSkillsDir = resolve(homedir(), ".agents", "skills");
    if (
      !allowRealHomeWrites &&
      (resolve(paths.codexHome) === realCodexHome ||
        resolve(paths.userSkillsDir) === realSkillsDir)
    ) {
      return { ok: false, errors: ["Real Codex writes are disabled"] };
    }

    for (const [path, fingerprint] of Object.entries(preview.liveFingerprints)) {
      const current = await readTextIfExists(path);
      if (hashText(current) !== fingerprint) {
        return { ok: false, errors: [`Live file changed after preview: ${path}`] };
      }
    }

    const skillErrors = await findSkillCopyErrors(profileId);
    if (skillErrors.length > 0) {
      return { ok: false, errors: skillErrors };
    }

    const backup = await backupStore.createBackup(
      preview.changes.map((change) => change.path)
    );

    for (const change of preview.changes) {
      await writeAtomic(change.path, change.after);
    }

    await copyOwnedSkills(profileId);
    await appendHistory(paths, {
      type: "apply",
      profileId,
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

    for (const entry of backup.entries) {
      if (entry.missing) {
        await rm(entry.sourcePath, { force: true });
      } else {
        const content = await readFile(entry.backupPath ?? "", "utf8");
        await writeAtomic(entry.sourcePath, content);
      }
    }

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
