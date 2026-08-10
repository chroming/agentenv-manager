import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type {
  BackupManifest,
  RepositorySkillScanResult,
  ProjectSkillScanResult,
  SkillLibraryEntry,
  SkillSourceGroupView,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult,
  SkillSourceRecord,
  SkillSourceScope
} from "../shared/types";
import { sourceSubpathFor } from "../shared/skillSourceGrouping";
import { writeAtomic } from "./fileUtils";
import type { SkillMetadataFile } from "./skillLibraryMetadata";
import type { SkillSourceService } from "./skillSourceService";
import { createLocalSkillSourceScope, createSkillSourceScope } from "./skillSourceScope";
import type { SkillSourceRegistry } from "./skillSourceRegistry";
import { validateSkillSourceMerge } from "./skillSourceMerge";
import type { GitCliSkillSource } from "./skillSources/contract";
import { scanProjectSkillRoots } from "./projectSkillDiscovery";
import type { BackupStore } from "./backupStore";
import {
  BackupRecoveryError,
  createBackupMutationClaimer,
  restoreBackupWithSafety,
  selectBackupEntries
} from "./backupRestore";
import { hashPathEntry, syncPathTree } from "./filesystemIntegrity";

interface PendingSkillSourceMerge {
  preview: SkillSourceMergePreview;
  result: RepositorySkillScanResult | ProjectSkillScanResult;
  affectedSourceIds: string[];
  affectedSkillIds: string[];
  sourceRegistrySnapshot: SkillSourceRecord[];
  createdAt: number;
}

interface SkillSourceMergeServiceOptions {
  appDataRoot: string;
  backupStore: BackupStore;
  repositorySource?: GitCliSkillSource;
  sourceObservationsDir: string;
  sourceRegistryPath: string;
  sourceRegistry: SkillSourceRegistry;
  sourceService: SkillSourceService;
  listSkills(): Promise<SkillLibraryEntry[]>;
  listSourceGroups(): Promise<SkillSourceGroupView[]>;
  now?: () => Date;
}

const PREVIEW_TTL_MS = 30 * 60 * 1000;

type SkillSourceMergeJournalStatus =
  | "prepared"
  | "complete"
  | "rolled-back"
  | "recovery-required";

interface SkillSourceMergeJournal {
  formatVersion: 1;
  operation: "merge-skill-sources";
  createdAt: string;
  status: SkillSourceMergeJournalStatus;
  transactionBackupId: string;
  safetyBackupId?: string;
  recoveryError?: string;
  mutationHashes?: Array<{ path: string; sha256?: string }>;
  preview?: SkillSourceMergePreview;
  sourceRegistry?: SkillSourceRecord[];
}

type SkillSourceMergeManifest =
  | { kind: "journal"; journal: SkillSourceMergeJournal }
  | { kind: "legacy-archive" };

export interface SkillSourceMergeRecoveryResult {
  recoveredIds: string[];
  recoveryRequiredIds: string[];
}

const sourceMergeBackupRoot = (appDataRoot: string) =>
  join(appDataRoot, "skill-source-merge-backups");

const sourceMergeJournalPath = (backupPath: string) => join(backupPath, "manifest.json");

const writeSourceMergeJournal = async (
  backupPath: string,
  journal: SkillSourceMergeJournal
) => {
  await writeAtomic(
    sourceMergeJournalPath(backupPath),
    `${JSON.stringify(journal, null, 2)}\n`
  );
  await syncPathTree(backupPath);
};

const readSourceMergeManifest = async (backupPath: string): Promise<SkillSourceMergeManifest> => {
  const parsed = JSON.parse(await readFile(sourceMergeJournalPath(backupPath), "utf8")) as
    Partial<SkillSourceMergeJournal> & Record<string, unknown>;
  const hasBaseIdentity =
    parsed.formatVersion === 1 &&
    parsed.operation === "merge-skill-sources" &&
    typeof parsed.createdAt === "string";
  if (
    hasBaseIdentity &&
    parsed.status === undefined &&
    parsed.transactionBackupId === undefined &&
    parsed.preview !== null &&
    typeof parsed.preview === "object" &&
    !Array.isArray(parsed.preview) &&
    Array.isArray(parsed.sourceRegistry)
  ) {
    return { kind: "legacy-archive" };
  }
  if (
    !hasBaseIdentity ||
    typeof parsed.transactionBackupId !== "string" ||
    !["prepared", "complete", "rolled-back", "recovery-required"].includes(
      String(parsed.status)
    ) ||
    (parsed.mutationHashes !== undefined && !Array.isArray(parsed.mutationHashes))
  ) {
    throw new Error("Invalid Skill source merge recovery journal");
  }
  for (const receipt of parsed.mutationHashes ?? []) {
    if (
      !receipt ||
      typeof receipt.path !== "string" ||
      (receipt.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(receipt.sha256))
    ) {
      throw new Error("Invalid Skill source merge mutation receipt");
    }
  }
  return { kind: "journal", journal: parsed as SkillSourceMergeJournal };
};

const changedBackupPaths = async (backup: BackupManifest) => {
  const changed: string[] = [];
  for (const entry of backup.entries) {
    const expected = entry.missing ? undefined : entry.sha256;
    if (await hashPathEntry(entry.sourcePath).catch(() => "unreadable") !== expected) {
      changed.push(resolve(entry.sourcePath));
    }
  }
  return changed;
};

export const listPendingSkillSourceMerges = async (
  appDataRoot: string
): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(sourceMergeBackupRoot(appDataRoot), { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const pending: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const backupPath = join(sourceMergeBackupRoot(appDataRoot), entry.name);
    try {
      const manifest = await readSourceMergeManifest(backupPath);
      if (manifest.kind === "legacy-archive") continue;
      const { journal } = manifest;
      if (journal.status === "prepared" || journal.status === "recovery-required") {
        pending.push(entry.name);
      }
    } catch {
      pending.push(entry.name);
    }
  }
  return pending.sort();
};

export const recoverInterruptedSkillSourceMerges = async (
  appDataRoot: string,
  backupStore: BackupStore
): Promise<SkillSourceMergeRecoveryResult> => {
  let entries;
  try {
    entries = await readdir(sourceMergeBackupRoot(appDataRoot), { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { recoveredIds: [], recoveryRequiredIds: [] };
    }
    throw error;
  }
  const recoveredIds: string[] = [];
  const recoveryRequiredIds: string[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const backupPath = join(sourceMergeBackupRoot(appDataRoot), entry.name);
    let journal: SkillSourceMergeJournal;
    try {
      const manifest = await readSourceMergeManifest(backupPath);
      if (manifest.kind === "legacy-archive") continue;
      journal = manifest.journal;
    } catch {
      recoveryRequiredIds.push(entry.name);
      continue;
    }
    if (journal.status === "recovery-required") {
      recoveryRequiredIds.push(entry.name);
      continue;
    }
    if (journal.status !== "prepared") continue;

    try {
      const backup = await backupStore.readBackup(journal.transactionBackupId);
      const backupPaths = new Set(backup.entries.map((item) => resolve(item.sourcePath)));
      const mutationHashes = new Map(
        (journal.mutationHashes ?? []).map((item) => [resolve(item.path), item.sha256])
      );
      if ([...mutationHashes.keys()].some((path) => !backupPaths.has(path))) {
        throw new Error("Skill source merge journal contains a path outside its backup");
      }
      const changedPaths = await changedBackupPaths(backup);
      const ambiguousPaths: string[] = [];
      for (const path of changedPaths) {
        const currentHash = await hashPathEntry(path).catch(() => "unreadable");
        if (!mutationHashes.has(path) || currentHash !== mutationHashes.get(path)) {
          ambiguousPaths.push(path);
        }
      }
      if (ambiguousPaths.length > 0) {
        throw new Error(
          `Interrupted Skill source merge has unverified filesystem changes: ${ambiguousPaths.join(", ")}`
        );
      }
      if (changedPaths.length > 0) {
        await restoreBackupWithSafety({
          backup: selectBackupEntries(backup, changedPaths),
          backupStore,
          continueOnError: true,
          restoreSafetyOnFailure: false,
          safetyProfileName: "Skill sources before interrupted merge recovery",
          expectedCurrentHashes: new Map(
            changedPaths.map((path) => [path, mutationHashes.get(path)])
          )
        });
      }
      journal.status = "rolled-back";
      await writeSourceMergeJournal(backupPath, journal);
      recoveredIds.push(entry.name);
    } catch (error) {
      journal.status = "recovery-required";
      journal.recoveryError = error instanceof Error ? error.message : String(error);
      await writeSourceMergeJournal(backupPath, journal).catch(() => undefined);
      recoveryRequiredIds.push(entry.name);
    }
  }
  return { recoveredIds, recoveryRequiredIds };
};

const scopeKey = (
  source: Pick<
    SkillSourceScope,
    "repository" | "ref" | "directory" | "indexManifestPath"
  >
) =>
  `${source.repository}\0${source.ref}\0${source.directory}\0${source.indexManifestPath ?? ""}`;

export const createSkillSourceMergeService = (options: SkillSourceMergeServiceOptions) => {
  const pendingMerges = new Map<string, PendingSkillSourceMerge>();
  const now = options.now ?? (() => new Date());

  const preview = async (
    input: SkillSourceMergePreviewInput
  ): Promise<SkillSourceMergePreview> => {
    const sourceIds = [...new Set(input.sourceIds.filter(Boolean))];
    const groups = await options.listSourceGroups();
    const selected = sourceIds.map((sourceId) => groups.find((group) => group.sourceId === sourceId));
    if (selected.some((group) => !group)) {
      throw new Error("One or more selected Skill sources no longer exist");
    }
    const sources = selected as SkillSourceGroupView[];
    const requestedRootPath = input.rootPath && sources.every(
      (source) => (source.sourceKind ?? source.kind) === "local"
    )
      ? await realpath(input.rootPath).catch(() => input.rootPath)
      : input.rootPath;
    const mergeScope = validateSkillSourceMerge(sources, input.directory, requestedRootPath);
    const result = mergeScope.kind === "local"
      ? await scanProjectSkillRoots([mergeScope.repository], await options.listSkills())
      : await (async () => {
          if (!options.repositorySource) {
            throw new Error("System Git is unavailable. Install Git and retry the source merge.");
          }
          return options.repositorySource.scan({
            repository: mergeScope.repository,
            ref: mergeScope.ref,
            directory: mergeScope.directory,
            transport: "system-git"
          });
        })();
    const mergedSource = mergeScope.kind === "local"
      ? createLocalSkillSourceScope(mergeScope.repository)
      : (result as RepositorySkillScanResult).sourceScope ?? createSkillSourceScope(
          { ...mergeScope, transport: "system-git" },
          result as RepositorySkillScanResult
        );
    const existingTarget = groups.find((group) =>
      scopeKey(group) === scopeKey(mergedSource) && !sourceIds.includes(group.sourceId)
    );
    const automaticCheckSources = [...sources, ...(existingTarget ? [existingTarget] : [])];
    const affectedSourceIds = [...sourceIds, ...(existingTarget ? [existingTarget.sourceId] : [])];
    const affectedSkills = (await options.listSkills()).filter((skill) =>
      skill.sourceCollection && affectedSourceIds.includes(
        skill.sourceCollection.sourceId ?? skill.sourceCollection.canonicalLink
      )
    );
    const blockers: string[] = [];
    if (result.truncated) blockers.push("The merged source scan was incomplete");
    if ("issues" in result && result.issues.length > 0) {
      blockers.push(...result.issues.map((issue) => issue.message));
    }
    const paths = new Map<string, string[]>();
    for (const skill of affectedSkills) {
      const collection = skill.sourceCollection!;
      const candidateDirectory = mergeScope.kind === "local"
        ? resolve(collection.repository, collection.sourceSubpath)
        : [collection.directory, collection.sourceSubpath].filter(Boolean).join("/");
      try {
        const sourceSubpath = mergeScope.kind === "local"
          ? relative(mergedSource.repository, candidateDirectory).split("\\").join("/")
          : sourceSubpathFor(mergedSource.directory, candidateDirectory);
        if (sourceSubpath === ".." || sourceSubpath.startsWith("../")) {
          throw new Error(`Skill path is outside its source scope: ${candidateDirectory}`);
        }
        paths.set(sourceSubpath, [...(paths.get(sourceSubpath) ?? []), skill.name]);
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error));
      }
    }
    for (const [path, names] of paths) {
      if (names.length > 1) {
        blockers.push(`${names.length} Library Skills would use the same source path: ${path || "."}`);
      }
    }
    const warnings = [
      ...(mergeScope.kind === "repository" && !mergedSource.directory
        ? ["The merged source scans the whole repository"]
        : []),
      ...(existingTarget ? ["The selected sources will merge into an existing source group"] : []),
      ...(new Set(automaticCheckSources.map((source) => source.automaticChecks !== false)).size > 1
        ? ["Automatic checks will be turned off because the selected sources use different settings"]
        : [])
    ];
    const automaticChecks = automaticCheckSources.every(
      (source) => source.automaticChecks !== false
    );
    const mergePreview: SkillSourceMergePreview = {
      id: randomUUID(),
      sourceIds,
      sources,
      mergedSource,
      automaticChecks,
      affectedSkillCount: affectedSkills.length,
      discoveredSkillCount: result.candidates.length,
      mergesIntoExistingSource: Boolean(existingTarget),
      warnings,
      blockers: [...new Set(blockers)]
    };
    pendingMerges.set(mergePreview.id, {
      preview: mergePreview,
      result,
      affectedSourceIds,
      affectedSkillIds: affectedSkills.map((skill) => skill.id),
      sourceRegistrySnapshot: await options.sourceRegistry.list(),
      createdAt: now().getTime()
    });
    return mergePreview;
  };

  const merge = async (previewId: string): Promise<SkillSourceMergeResult> => {
    const pending = pendingMerges.get(previewId);
    if (!pending || now().getTime() - pending.createdAt > PREVIEW_TTL_MS) {
      pendingMerges.delete(previewId);
      throw new Error("Skill source merge preview expired. Review the merge again.");
    }
    if (pending.preview.blockers.length > 0) {
      throw new Error("Resolve the blocking source merge issues before continuing");
    }
    const affectedSkills = (await options.listSkills()).filter((skill) =>
      pending.affectedSkillIds.includes(skill.id)
    );
    if (affectedSkills.length !== pending.affectedSkillIds.length || affectedSkills.some((skill) =>
      !skill.sourceCollection || !pending.affectedSourceIds.includes(
        skill.sourceCollection.sourceId ?? skill.sourceCollection.canonicalLink
      ))) {
      throw new Error("Skill source membership changed after preview. Review the merge again.");
    }
    const metadataPaths = affectedSkills.map((skill) =>
      join(skill.path, ".agentenv-skill.json")
    );
    const transactionBackup = await options.backupStore.createBackup(
      [
        options.sourceRegistryPath,
        options.sourceObservationsDir,
        ...metadataPaths
      ],
      {
        operation: "data-import",
        profileName: "Skill source merge"
      }
    );
    const claimPath = createBackupMutationClaimer(transactionBackup, {
      changedMessage: (path) =>
        `Skill source data changed after merge preview: ${path}`
    });

    const stamp = now().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(
      options.appDataRoot,
      "skill-source-merge-backups",
      `skill-source-merge-${stamp}-${previewId.slice(0, 8)}`
    );
    const snapshots = new Map<string, string>();
    const mergedIgnoredSubpaths = new Set<string>();
    for (const record of pending.sourceRegistrySnapshot.filter((source) =>
      pending.affectedSourceIds.includes(source.id)
    )) {
      for (const ignoredSubpath of record.ignoredSubpaths ?? []) {
        const candidateDirectory = pending.preview.mergedSource.kind === "local"
          ? resolve(record.repository, ignoredSubpath)
          : [record.directory, ignoredSubpath].filter(Boolean).join("/");
        const mergedSubpath = pending.preview.mergedSource.kind === "local"
          ? relative(
              pending.preview.mergedSource.repository,
              candidateDirectory
            ).split("\\").join("/")
          : sourceSubpathFor(
              pending.preview.mergedSource.directory,
              candidateDirectory
            );
        if (mergedSubpath === ".." || mergedSubpath.startsWith("../")) {
          throw new Error(`Ignored Skill path is outside the merged source: ${candidateDirectory}`);
        }
        mergedIgnoredSubpaths.add(mergedSubpath);
      }
    }
    await mkdir(backupPath, { recursive: true });
    for (const skill of affectedSkills) {
      const metadataPath = join(skill.path, ".agentenv-skill.json");
      const content = await readFile(metadataPath, "utf8");
      snapshots.set(metadataPath, content);
      await writeAtomic(join(backupPath, `${skill.id}.agentenv-skill.json`), content);
    }
    const backupManifest: SkillSourceMergeJournal = {
      formatVersion: 1,
      operation: "merge-skill-sources",
      createdAt: now().toISOString(),
      status: "prepared",
      transactionBackupId: transactionBackup.id,
      preview: pending.preview,
      sourceRegistry: pending.sourceRegistrySnapshot
    };
    await writeSourceMergeJournal(backupPath, backupManifest);

    const recordMutation = async (...paths: string[]) => {
      await claimPath.recordMutation(...paths);
      backupManifest.mutationHashes = [...claimPath.mutationHashes.entries()]
        .map(([path, sha256]) => ({ path, sha256 }))
        .sort((left, right) => left.path.localeCompare(right.path));
      await writeSourceMergeJournal(backupPath, backupManifest);
    };

    try {
      await claimPath(options.sourceRegistryPath);
      const [mergedRecord] = await options.sourceRegistry.ensure([pending.preview.mergedSource]);
      await recordMutation(options.sourceRegistryPath);
      await options.sourceRegistry.setAutomaticChecks(
        mergedRecord!.id,
        pending.preview.automaticChecks
      );
      await recordMutation(options.sourceRegistryPath);
      for (const ignoredSubpath of mergedIgnoredSubpaths) {
        await options.sourceRegistry.setIgnoredSubpath(
          mergedRecord!.id,
          ignoredSubpath,
          true
        );
        await recordMutation(options.sourceRegistryPath);
      }
      for (const skill of affectedSkills) {
        const collection = skill.sourceCollection!;
        const localSource = pending.preview.mergedSource.kind === "local";
        const candidateDirectory = localSource
          ? resolve(collection.repository, collection.sourceSubpath)
          : [collection.directory, collection.sourceSubpath].filter(Boolean).join("/");
        const metadataPath = join(skill.path, ".agentenv-skill.json");
        await claimPath(metadataPath);
        const metadata = JSON.parse(snapshots.get(metadataPath)!) as SkillMetadataFile;
        metadata.sourceCollection = {
          ...pending.preview.mergedSource,
          sourceId: mergedRecord!.id,
          sourceSubpath: localSource
            ? relative(pending.preview.mergedSource.repository, candidateDirectory).split("\\").join("/")
            : sourceSubpathFor(
                pending.preview.mergedSource.directory,
                candidateDirectory
              )
        };
        metadata.updatedAt = now().toISOString();
        await writeAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
        await recordMutation(metadataPath);
      }
      const records = await options.sourceRegistry.list();
      await options.sourceRegistry.replace(records.filter((record) =>
        !pending.affectedSourceIds.includes(record.id) || record.id === mergedRecord!.id
      ));
      await recordMutation(options.sourceRegistryPath);
      await claimPath(options.sourceObservationsDir);
      if (pending.preview.mergedSource.kind === "local") {
        await options.sourceService.recordLocalScan(
          pending.preview.mergedSource,
          pending.result as ProjectSkillScanResult
        );
      } else {
        await options.sourceService.recordRepositoryScan(
          pending.preview.mergedSource,
          pending.result as RepositorySkillScanResult
        );
      }
      await recordMutation(options.sourceObservationsDir);
      const group = (await options.listSourceGroups()).find((candidate) =>
        candidate.sourceId === mergedRecord!.id
      );
      if (!group || group.candidates.some((candidate) => candidate.state === "conflict")) {
        throw new Error("Merged Skill source could not be verified");
      }
      backupManifest.status = "complete";
      await writeSourceMergeJournal(backupPath, backupManifest);
      pendingMerges.delete(previewId);
      return {
        source: group,
        mergedSourceCount: pending.affectedSourceIds.length,
        affectedSkillCount: affectedSkills.length,
        backupPath
      };
    } catch (error) {
      const failures: string[] = [];
      let recoverySafetyBackupId: string | undefined;
      try {
        const unrecordedChanges = await claimPath.findUnrecordedChanges();
        if (unrecordedChanges.length > 0) {
          throw new Error(
            `Automatic source recovery stopped because paths changed without a completed ` +
            `write receipt: ${unrecordedChanges.join(", ")}`
          );
        }
        const rollbackBackup = selectBackupEntries(
          transactionBackup,
          claimPath.mutatedPaths
        );
        if (rollbackBackup.entries.length > 0) {
          await restoreBackupWithSafety({
            backup: rollbackBackup,
            backupStore: options.backupStore,
            continueOnError: true,
            restoreSafetyOnFailure: false,
            safetyProfileName: "Skill sources before merge recovery",
            expectedCurrentHashes: claimPath.mutationHashes
          });
        }
      } catch (restoreError) {
        if (restoreError instanceof BackupRecoveryError) {
          recoverySafetyBackupId = restoreError.safetyBackupId;
        }
        failures.push(
          `Skill source recovery: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
        );
      }
      if (failures.length > 0) {
        backupManifest.status = "recovery-required";
        backupManifest.safetyBackupId = recoverySafetyBackupId;
        backupManifest.recoveryError = failures.join("; ");
        await writeSourceMergeJournal(backupPath, backupManifest).catch(() => undefined);
        throw new Error(
          `Skill source merge failed and recovery is incomplete. Original metadata remains in ${backupPath}. ${failures.join("; ")}`,
          { cause: error }
        );
      }
      backupManifest.status = "rolled-back";
      await writeSourceMergeJournal(backupPath, backupManifest);
      throw error;
    }
  };

  return { preview, merge };
};
