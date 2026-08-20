import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseSkillTags } from "../../shared/skillTags";
import type { SkillSourceRecord } from "../../shared/types";
import type { BackupStore } from "../backupStore";
import { isMissingFileError, pathEntryExists, replacePathAtomically, writeAtomic } from "../fileUtils";
import {
  BackupRecoveryError,
  createBackupMutationClaimer,
  restoreBackupWithSafety,
  selectBackupEntries
} from "../backupRestore";
import { hashSkillContent } from "../skillContentHash";
import { hashPathEntry } from "../filesystemIntegrity";
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
  formatVersion: 1 | 2;
  backupId: string;
  safetyBackupId?: string;
  createdAt: string;
  phase: "applying" | "verifying" | "rollback-required";
  mutationHashes?: Record<string, string | null>;
}

export interface WorkspaceSyncTransaction {
  recover(): Promise<void>;
  isRecoveryRequired(): Promise<boolean>;
  apply(snapshotRoot: string): Promise<{ backupId: string }>;
  restore(backupId: string): Promise<void>;
}

const readJournal = async (path: string): Promise<WorkspaceSyncJournal | undefined> => {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as WorkspaceSyncJournal;
    if (![1, 2].includes(value.formatVersion) || !value.backupId || !value.phase) {
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
  const tags = parseSkillTags(portable.tags);
  return {
    sourceType: portable.sourceType,
    source: portable.source,
    remoteRef: portable.remoteRef,
    remoteRevision: portable.remoteRevision,
    updatePolicy: portable.updatePolicy,
    globallyEnabled: portable.globallyEnabled,
    ...(tags.length > 0 ? { tags } : {}),
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
  const rollback = async (
    backupId: string,
    expectedCurrentHashes?: ReadonlyMap<string, string | undefined>
  ) => {
    const backup = await input.backupStore.readBackup(backupId);
    const selectedBackup = expectedCurrentHashes
      ? selectBackupEntries(backup, expectedCurrentHashes.keys())
      : backup;
    await restoreBackupWithSafety({
      backup: selectedBackup,
      backupStore: input.backupStore,
      safetyProfileName: "Workspace before recovery",
      expectedCurrentHashes
    });
    await rm(input.paths.workspaceSyncJournalPath, { force: true });
  };

  const recover = async () => {
    const journal = await readJournal(input.paths.workspaceSyncJournalPath);
    if (!journal) return;
    const originalBackup = await input.backupStore.readBackup(journal.backupId);
    const receipts = new Map<string, string | undefined>(
      Object.entries(journal.mutationHashes ?? {}).map(([path, hash]) => [
        resolve(path),
        hash ?? undefined
      ])
    );
    const ambiguousPaths: string[] = [];
    for (const entry of originalBackup.entries) {
      const path = resolve(entry.sourcePath);
      const currentHash = await hashPathEntry(path).catch(() => "unreadable");
      if (receipts.has(path)) {
        if (currentHash !== receipts.get(path)) ambiguousPaths.push(path);
      } else if (currentHash !== (entry.missing ? undefined : entry.sha256)) {
        ambiguousPaths.push(path);
      }
    }
    if (ambiguousPaths.length > 0) {
      throw new Error(
        `Workspace recovery stopped because current data cannot be attributed to the interrupted ` +
        `operation: ${ambiguousPaths.join(", ")}. Backup ${journal.backupId} was preserved.`
      );
    }
    if (receipts.size === 0) {
      await rm(input.paths.workspaceSyncJournalPath, { force: true });
      return;
    }
    await rollback(journal.backupId, receipts);
  };

  const restore = async (backupId: string) => {
    const safetyBackup = await input.backupStore.createBackup(
      [input.paths.profilesDir, input.paths.skillsLibraryDir, input.paths.skillSourcesPath],
      { operation: "rollback-safety", profileName: "Workspace before restore" }
    );
    const journal: WorkspaceSyncJournal = {
      formatVersion: 2,
      backupId,
      safetyBackupId: safetyBackup.id,
      createdAt: new Date().toISOString(),
      phase: "rollback-required",
      mutationHashes: {}
    };
    await writeAtomic(input.paths.workspaceSyncJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
    try {
      const backup = await input.backupStore.readBackup(backupId);
      await restoreBackupWithSafety({
        backup,
        backupStore: input.backupStore,
        safetyBackup,
        claimerOptions: {
          missingMessage: (path) =>
            `Workspace restore did not preserve the current path before mutation: ${path}`,
          changedMessage: (path) =>
            `Workspace path changed while Restore was being prepared: ${path}`
        }
      });
      await rm(input.paths.workspaceSyncJournalPath, { force: true });
    } catch (error) {
      if (!(error instanceof BackupRecoveryError)) {
        await rm(input.paths.workspaceSyncJournalPath, { force: true });
        throw new Error(
          `Workspace restore failed; the previous Workspace was restored from safety backup ${safetyBackup.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      throw error;
    }
  };

  const apply = async (snapshotRoot: string) => {
    await validatePortableWorkspace(snapshotRoot);
    const backup = await input.backupStore.createBackup(
      [input.paths.profilesDir, input.paths.skillsLibraryDir, input.paths.skillSourcesPath],
      { operation: "workspace-sync", profileName: "Workspace Sync" }
    );
    const journal: WorkspaceSyncJournal = {
      formatVersion: 2,
      backupId: backup.id,
      createdAt: new Date().toISOString(),
      phase: "applying",
      mutationHashes: {}
    };
    await writeAtomic(input.paths.workspaceSyncJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
    const claimPath = createBackupMutationClaimer(backup, {
      missingMessage: (path) =>
        `Workspace update did not preserve the current path before mutation: ${path}`,
      changedMessage: (path) =>
        `Workspace path changed while Update was being prepared: ${path}`
    });
    const expectedHashes = new Map(
      backup.entries.map((entry) => [
        resolve(entry.sourcePath),
        entry.missing ? undefined : entry.sha256
      ])
    );
    const stagingRoot = join(
      input.paths.workspaceSyncCacheDir,
      `apply-stage-${randomUUID()}`
    );
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

      await claimPath(input.paths.profilesDir);
      await replacePathAtomically(
        input.paths.profilesDir,
        (path) => cp(stagedProfiles, path, { recursive: true }),
        { expectedTargetHash: expectedHashes.get(resolve(input.paths.profilesDir)) }
      );
      await claimPath.recordMutation(input.paths.profilesDir);
      journal.mutationHashes![resolve(input.paths.profilesDir)] =
        claimPath.mutationHashes.get(resolve(input.paths.profilesDir)) ?? null;
      await writeAtomic(input.paths.workspaceSyncJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
      await input.failureInjector?.("profiles");
      await claimPath(input.paths.skillsLibraryDir);
      await replacePathAtomically(
        input.paths.skillsLibraryDir,
        (path) => cp(stagedSkills, path, { recursive: true }),
        { expectedTargetHash: expectedHashes.get(resolve(input.paths.skillsLibraryDir)) }
      );
      await claimPath.recordMutation(input.paths.skillsLibraryDir);
      journal.mutationHashes![resolve(input.paths.skillsLibraryDir)] =
        claimPath.mutationHashes.get(resolve(input.paths.skillsLibraryDir)) ?? null;
      await writeAtomic(input.paths.workspaceSyncJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
      await input.failureInjector?.("skills");
      await claimPath(input.paths.skillSourcesPath);
      await replacePathAtomically(
        input.paths.skillSourcesPath,
        (path) => cp(stagedSources, path),
        { expectedTargetHash: expectedHashes.get(resolve(input.paths.skillSourcesPath)) }
      );
      await claimPath.recordMutation(input.paths.skillSourcesPath);
      journal.mutationHashes![resolve(input.paths.skillSourcesPath)] =
        claimPath.mutationHashes.get(resolve(input.paths.skillSourcesPath)) ?? null;
      await writeAtomic(input.paths.workspaceSyncJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
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
        const unrecordedChanges = await claimPath.findUnrecordedChanges();
        if (unrecordedChanges.length > 0) {
          throw new Error(
            `Workspace update changed paths without a completed write receipt: ` +
            unrecordedChanges.join(", ")
          );
        }
        const touchedBackup = selectBackupEntries(backup, claimPath.mutatedPaths);
        if (touchedBackup.entries.length > 0) {
          await restoreBackupWithSafety({
            backup: touchedBackup,
            backupStore: input.backupStore,
            safetyProfileName: "Workspace after failed update",
            expectedCurrentHashes: claimPath.mutationHashes
          });
        }
        await rm(input.paths.workspaceSyncJournalPath, { force: true });
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
