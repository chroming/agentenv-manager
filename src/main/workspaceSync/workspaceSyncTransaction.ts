import { cp, lstat, mkdir, readFile, readlink, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { BackupManifest } from "../../shared/types";
import type { SkillSourceRecord } from "../../shared/types";
import type { BackupStore } from "../backupStore";
import { isMissingFileError, pathEntryExists, replacePathAtomically, writeAtomic } from "../fileUtils";
import { hashSkillContent } from "../skillContentHash";
import type { SkillMetadataFile } from "../skillLibraryMetadata";
import type { AgentEnvPaths } from "../paths";
import { createSkillSourceRegistry } from "../skillSourceRegistry";
import {
  PortableSkillMetadataSchema,
  PortableSkillSourcesSchema,
  type PortableSkillSource
} from "./portableSchemas";
import { isPortableOnlineLocator } from "./portableLocation";
import { validatePortableWorkspace } from "./portableWorkspaceValidator";

interface WorkspaceSyncJournal {
  formatVersion: 1;
  backupId: string;
  createdAt: string;
  phase: "applying" | "verifying" | "rollback-required";
}

export interface WorkspaceSyncTransaction {
  recover(): Promise<void>;
  isRecoveryRequired(): Promise<boolean>;
  apply(snapshotRoot: string): Promise<{ backupId: string }>;
  restore(backupId: string): Promise<void>;
}

const restoreEntry = async (entry: BackupManifest["entries"][number]) => {
  if (entry.missing) {
    await rm(entry.sourcePath, { recursive: true, force: true });
    return;
  }
  if (!entry.backupPath) throw new Error(`Backup entry is missing its payload: ${entry.sourcePath}`);
  await replacePathAtomically(entry.sourcePath, async (stagingPath) => {
    if (entry.kind === "symlink") {
      await symlink(await readlink(entry.backupPath!), stagingPath);
      return;
    }
    await cp(entry.backupPath!, stagingPath, { recursive: entry.kind === "directory" });
  });
};

const restoreBackup = async (manifest: BackupManifest) => {
  for (const entry of [...manifest.entries].reverse()) await restoreEntry(entry);
};

const readJournal = async (path: string): Promise<WorkspaceSyncJournal | undefined> => {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as WorkspaceSyncJournal;
    if (value.formatVersion !== 1 || !value.backupId || !value.phase) {
      throw new Error("Workspace Sync recovery journal is invalid");
    }
    return value;
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
};

const metadataForLocalStore = async (skillRoot: string, portablePath: string): Promise<SkillMetadataFile> => {
  const portable = PortableSkillMetadataSchema.parse(JSON.parse(await readFile(portablePath, "utf8")));
  return {
    sourceType: portable.sourceType,
    source: portable.source,
    remoteRef: portable.remoteRef,
    remoteRevision: portable.remoteRevision,
    updatePolicy: portable.updatePolicy,
    globallyEnabled: portable.globallyEnabled,
    iconKey: portable.iconKey,
    contentHash: await hashSkillContent(skillRoot),
    upstream: portable.upstream,
    sourceCollection: portable.sourceCollection
  };
};

const sourceRecordForLocalStore = (
  source: PortableSkillSource,
  previous: Map<string, { createdAt: string; updatedAt: string }>
) => {
  const now = new Date().toISOString();
  return {
    ...source,
    createdAt: previous.get(source.id)?.createdAt ?? now,
    updatedAt: previous.get(source.id)?.updatedAt ?? now
  };
};

export const createWorkspaceSyncTransaction = (input: {
  paths: AgentEnvPaths;
  backupStore: BackupStore;
  failureInjector?: (phase: "profiles" | "skills" | "sources" | "verify") => void | Promise<void>;
}): WorkspaceSyncTransaction => {
  const rollback = async (backupId: string) => {
    const backup = await input.backupStore.readBackup(backupId);
    await restoreBackup(backup);
    await rm(input.paths.workspaceSyncJournalPath, { force: true });
  };

  const recover = async () => {
    const journal = await readJournal(input.paths.workspaceSyncJournalPath);
    if (!journal) return;
    await rollback(journal.backupId);
  };

  const restore = async (backupId: string) => {
    const journal: WorkspaceSyncJournal = {
      formatVersion: 1,
      backupId,
      createdAt: new Date().toISOString(),
      phase: "rollback-required"
    };
    await writeAtomic(input.paths.workspaceSyncJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
    await rollback(backupId);
  };

  const apply = async (snapshotRoot: string) => {
    await validatePortableWorkspace(snapshotRoot);
    const backup = await input.backupStore.createBackup(
      [input.paths.profilesDir, input.paths.skillsLibraryDir, input.paths.skillSourcesPath],
      { operation: "workspace-sync", profileName: "Workspace Sync" }
    );
    const journal: WorkspaceSyncJournal = {
      formatVersion: 1,
      backupId: backup.id,
      createdAt: new Date().toISOString(),
      phase: "applying"
    };
    await writeAtomic(input.paths.workspaceSyncJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
    const stagingRoot = join(input.paths.workspaceSyncCacheDir, "apply-stage");
    try {
      await rm(stagingRoot, { recursive: true, force: true });
      const stagedProfiles = join(stagingRoot, "profiles");
      const stagedSkills = join(stagingRoot, "skills-library");
      await cp(join(snapshotRoot, "workspace", "profiles"), stagedProfiles, { recursive: true });
      await mkdir(stagedSkills, { recursive: true });
      const portableSkillsRoot = join(snapshotRoot, "workspace", "skills");
      for (const entry of await import("node:fs/promises").then(({ readdir }) => readdir(portableSkillsRoot, { withFileTypes: true }))) {
        if (!entry.isDirectory()) continue;
        const stagedSkill = join(stagedSkills, entry.name);
        await cp(join(portableSkillsRoot, entry.name, "content"), stagedSkill, { recursive: true });
        const metadata = await metadataForLocalStore(
          stagedSkill,
          join(portableSkillsRoot, entry.name, "metadata.json")
        );
        await writeAtomic(join(stagedSkill, ".agentenv-skill.json"), `${JSON.stringify(metadata, null, 2)}\n`);
      }

      let previousSources = new Map<string, { createdAt: string; updatedAt: string }>();
      let localOnlySources: SkillSourceRecord[] = [];
      const currentSources = await createSkillSourceRegistry(input.paths.skillSourcesPath).list();
      previousSources = new Map(currentSources.map((source) => [source.id, source]));
      localOnlySources = currentSources.filter((source) =>
        !isPortableOnlineLocator(source.repository) || !isPortableOnlineLocator(source.canonicalLink)
      );
      const portableSources = PortableSkillSourcesSchema.parse(
        JSON.parse(await readFile(join(snapshotRoot, "workspace", "skill-sources.json"), "utf8"))
      );
      const stagedSources = join(stagingRoot, "skill-sources.json");
      const mergedSources = new Map<string, SkillSourceRecord>();
      for (const source of localOnlySources) mergedSources.set(source.id, source);
      for (const source of portableSources.sources) {
        mergedSources.set(source.id, sourceRecordForLocalStore(source, previousSources));
      }
      await writeAtomic(stagedSources, `${JSON.stringify({
        formatVersion: 1,
        sources: [...mergedSources.values()].sort((left, right) => left.id.localeCompare(right.id))
      }, null, 2)}\n`);

      await replacePathAtomically(input.paths.profilesDir, (path) => cp(stagedProfiles, path, { recursive: true }));
      await input.failureInjector?.("profiles");
      await replacePathAtomically(input.paths.skillsLibraryDir, (path) => cp(stagedSkills, path, { recursive: true }));
      await input.failureInjector?.("skills");
      await replacePathAtomically(input.paths.skillSourcesPath, (path) => cp(stagedSources, path));
      await input.failureInjector?.("sources");
      journal.phase = "verifying";
      await writeAtomic(input.paths.workspaceSyncJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
      await Promise.all([
        lstat(input.paths.profilesDir),
        lstat(input.paths.skillsLibraryDir),
        lstat(input.paths.skillSourcesPath)
      ]);
      await input.failureInjector?.("verify");
      await rm(input.paths.workspaceSyncJournalPath, { force: true });
      await rm(stagingRoot, { recursive: true, force: true });
      return { backupId: backup.id };
    } catch (error) {
      journal.phase = "rollback-required";
      await writeAtomic(input.paths.workspaceSyncJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
      try {
        await rollback(backup.id);
      } catch (rollbackError) {
        throw new Error(`Workspace update failed and needs recovery: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: error });
      }
      throw error;
    }
  };

  return {
    recover,
    isRecoveryRequired: () => pathEntryExists(input.paths.workspaceSyncJournalPath),
    apply,
    restore
  };
};
