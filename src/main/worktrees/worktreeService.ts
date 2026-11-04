import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type {
  WorktreeCleanupPreview,
  WorktreeCleanupRequest, WorktreeCleanupPreparation, WorktreeOperationPhase, WorktreeFileProgress,
  WorktreeEntry,
  WorktreeInventory,
  WorktreeRecoveryRecord,
  WorktreeRecoveryInventory
} from "../../shared/worktrees";
import type { WorktreeDisposalMode } from "../../shared/worktrees";
import { createWorktreeDisposal } from "./worktreeDisposal";
import { copyPathVerified, hashRequiredPathEntry } from "../filesystemIntegrity";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import type { ProjectStore } from "../projects/projectStore";
import type { GitCommandRunner } from "../skillSources/gitCommandRunner";
import { copyWorktreeVerified, fingerprintWorktreeTree, hashWorktreeTree, measureWorktreeTree } from "./worktreeSnapshot";
import { findRepositoryAncestor, repositoryDiscoveryDirectories, repositoryDiscoveryIssue, worktreeDiscoveryCandidates, WORKTREE_SCAN_SKIP_DIRECTORIES } from "./worktreeDiscovery";
import { readWorktreeAnalysis } from "./worktreeAnalysis";
import { createWorktreeInventoryCache } from "./worktreeInventoryCache";
import { createWorktreeMeasurements } from "./worktreeMeasurements";
import {
  ACTIVE_WORKTREE_LOCKS, PAUSED_WORKTREE_MARKERS, assertNoWorktreeWriter, readIntegration, readMainGitState, readRepositoryRefs, readWorktreeGitState,
  reviewFingerprint, withIntegrationEvidence, readWorktreeGit as readGit
} from "./worktreeGitState";
import type { WorktreeIntegration } from "../../shared/worktrees";
import { assertLinkedGitDirectory, assertRestoreRegistration, backupOperationMetadata, copyRecoveryPathExclusive, operationMetadataHash, operationRecoveryObjects, pinRestoreRegistration, readLinkedRegistrationIdentity, recoveryGitStateHash, worktreeAdminIdentities } from "./worktreeOperationRecovery";

const SettingsSchema = z.object({
  formatVersion: z.literal(1),
  scanRoots: z.array(z.string()),
  kept: z.record(z.string(), z.string()),
  keptRepositories: z.record(z.string(), z.string()).default({}),
  integrationRefs: z.record(z.string(), z.string()).default({})
}).strict();
const RecoverySchema = z.object({
  id: z.string().uuid(),
  path: z.string(),
  repositoryPath: z.string(),
  head: z.string().regex(/^[0-9a-f]{40,64}$/),
  branch: z.string().optional(),
  createdAt: z.string(),
  status: z.enum(["prepared", "removed", "restoring", "restored", "unchanged"]),
  protectedRef: z.string().optional(),
  backupHash: z.string().length(64).optional(),
  indexHash: z.string().length(64).optional(),
  operationHash: z.string().length(64).optional(),
  protectedRefs: z.array(z.object({ ref: z.string(), object: z.string().regex(/^[0-9a-f]{40,64}$/) }).strict()).optional(),
  unavailableOperationObjects: z.array(z.object({ field: z.string(), object: z.string().regex(/^[0-9a-f]{40,64}$/) }).strict()).optional(),
  restoreAttemptGitHash: z.string().length(64).optional(),
  restoreRegistration: z.object({
    gitDir: z.string(), commonDir: z.string(), adminDevice: z.string(), adminInode: z.string(),
    worktreeDevice: z.string(), worktreeInode: z.string(), linkDevice: z.string(), linkInode: z.string(),
    gitFileHash: z.string().length(64), backlinkHash: z.string().length(64), commonLinkHash: z.string().length(64)
  }).strict().optional(),
  legacyCheckoutMigration: z.boolean().optional(),
  gitStatusHash: z.string().length(64).optional(),
  sourceGitFingerprint: z.string().length(64).optional(),
  sourceHash: z.string().length(64).optional(),
  restoreAttemptHash: z.string().length(64).optional(),
  sourceSizeBytes: z.number().int().nonnegative().optional(),
  reclaimedSizeBytes: z.number().int().nonnegative().optional(),
  verificationWarnings: z.array(z.string()).optional()
}).strict();

const MAX_DIRECTORIES = 5_000;
const INSPECTION_CONCURRENCY = 4;
const SKIP_DIRECTORIES = WORKTREE_SCAN_SKIP_DIRECTORIES;
const INTEGRATION_REVIEW_REASONS = new Set([
  "Integration target is unavailable; confirm the task is finished",
  "Branch work is not confirmed in the integration target; confirm the task is finished",
  "Integration target is this Worktree's own branch; confirm the task is finished"
]);

const pathExists = async (path: string) => lstat(path).then(() => true, (error) => {
  if (isMissingFileError(error)) return false;
  throw error;
});

const hasNestedRepository = async (root: string, signal?: AbortSignal): Promise<boolean> => {
  const queue = [root];
  let inspected = 0;
  while (queue.length) {
    signal?.throwIfAborted();
    if (++inspected > MAX_DIRECTORIES) throw new Error("Nested repository check reached its directory limit");
    const current = queue.shift()!;
    for (const child of await readdir(current, { withFileTypes: true })) {
      if (child.name === ".git") {
        if (current !== root) return true;
        continue;
      }
      if (child.isDirectory() && !SKIP_DIRECTORIES.has(child.name)) {
        queue.push(join(current, child.name));
      }
    }
  }
  return false;
};

type GitWorktree = Pick<WorktreeEntry, "path" | "head" | "branch" | "detached" | "locked" | "prunable">;

export const parseWorktreeList = (output: string): GitWorktree[] => output
  .split("\0\0")
  .filter(Boolean)
  .map((block) => {
    const fields = block.split("\0");
    const pathField = fields.find((field) => field.startsWith("worktree "));
    if (!pathField) throw new Error("Git returned a worktree without a path");
    const value = (prefix: string) => fields.find((field) => field.startsWith(prefix))?.slice(prefix.length);
    return {
      path: pathField.slice("worktree ".length),
      head: value("HEAD "),
      branch: value("branch ")?.replace(/^refs\/heads\//, ""),
      detached: fields.includes("detached"),
      locked: fields.includes("locked") ? "Locked" : value("locked "),
      prunable: fields.includes("prunable") ? "Missing" : value("prunable ")
    };
  });

const keepKey = (commonDir: string, path: string) =>
  createHash("sha256").update(commonDir).update("\0").update(path).digest("hex");

const isWithin = (root: string, path: string) => {
  const difference = relative(root, path);
  return !difference || (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
};

export class WorktreeScanCancelledError extends Error {
  constructor() {
    super("Worktree scan cancelled");
    this.name = "WorktreeScanCancelledError";
  }
}

export interface WorktreeService {
  dispose(): Promise<void>;
  onInventoryChanged(listener: (inventory: WorktreeInventory) => void): () => void;
  cachedInventory(): Promise<{ inventory?: WorktreeInventory; fresh: boolean; scanning: boolean }>;
  inventory(mode?: "background"): Promise<WorktreeInventory>;
  addScanRoot(path: string): Promise<void>;
  removeScanRoot(path: string): Promise<void>;
  setKeep(commonDir: string, path: string, reason?: string): Promise<void>;
  setRepositoryKeep(commonDir: string, reason?: string): Promise<void>;
  setIntegrationRef(commonDir: string, ref?: string): Promise<void>;
  preview(commonDir: string, path: string, allowDirty?: boolean, mode?: WorktreeDisposalMode): Promise<WorktreeCleanupPreview>;
  previewTrashDeletion(id: string): Promise<WorktreeCleanupPreview>;
  previewBatch(items: WorktreeCleanupRequest[], progress?: (completed: number, path: string, result?: WorktreeCleanupPreparation) => void): Promise<WorktreeCleanupPreparation[]>;
  remove(preview: WorktreeCleanupPreview, progress?: (phase: WorktreeOperationPhase, fileProgress?: WorktreeFileProgress) => void): Promise<WorktreeRecoveryRecord>;
  listRecovery(scope?: "trash" | "all"): Promise<WorktreeRecoveryInventory>;
  restore(id: string): Promise<WorktreeRecoveryRecord>;
  cancelScan(): void;
  readAnalysis(commonDir: string, path: string): Promise<Awaited<ReturnType<typeof readWorktreeAnalysis>>>;
}

export const createWorktreeService = ({
  appDataRoot,
  homeDir = homedir(),
  projectStore,
  resolveRunner
}: {
  appDataRoot: string;
  homeDir?: string;
  projectStore: ProjectStore;
  resolveRunner(): Promise<GitCommandRunner | undefined>;
}): WorktreeService => {
  const settingsPath = join(appDataRoot, "worktree-locations.json");
  const recoveryRoot = join(appDataRoot, "worktree-recovery");
  let scanController: AbortController | undefined;
  let scanPromise: Promise<WorktreeInventory> | undefined;
  let scanMode: "background" | undefined;
  let disposed = false;
  const inventoryCache = createWorktreeInventoryCache(join(appDataRoot, "worktree-inventory-cache.json"));
  let lastDiscoveryAt = 0;
  const measurements = new Map<string, { at: number; value: Awaited<ReturnType<typeof measureWorktreeTree>> }>();
  const inventoryListeners = new Set<(inventory: WorktreeInventory) => void>();
  const notifyInventory = (inventory: WorktreeInventory) => {
    for (const listener of inventoryListeners) { try { listener(inventory); } catch { /* An observer cannot fail a local operation. */ } }
  };
  const measurementQueue = createWorktreeMeasurements(measurements, async (inventory, current) => {
    if (!current()) return;
    await inventoryCache.enrich(inventory);
    if (current()) notifyInventory(inventory);
  });
  const issuedPreviews = new Map<string, {
    commonDir: string; path: string; fingerprint: string; forceRequired: boolean; issuedAt: number;
    reviewHash: string;
    backupRequired: boolean;
    manualAuthorized: boolean;
  }>();
  const discovered = new Set<string>();
  const disposalEntries = new Map<string, WorktreeEntry>();
  const discoveredKey = (commonDir: string, path: string) => `${commonDir}\0${path}`;
  const builtinCandidates = worktreeDiscoveryCandidates(homeDir);

  const readSettings = async () => {
    try {
      return SettingsSchema.parse(JSON.parse(await readFile(settingsPath, "utf8")));
    } catch (error) {
      if (isMissingFileError(error)) return SettingsSchema.parse({ formatVersion: 1, scanRoots: [], kept: {} });
      throw error;
    }
  };
  const saveSettings = async (data: z.infer<typeof SettingsSchema>) =>
    writeAtomic(settingsPath, `${JSON.stringify(SettingsSchema.parse(data), null, 2)}\n`);
  const recoveryPath = (id: string) => join(recoveryRoot, `${id}.json`);
  const backupPath = (id: string) => join(recoveryRoot, id, "files");
  const readRecovery = async (id: string) => RecoverySchema.parse(
    JSON.parse(await readFile(recoveryPath(z.string().uuid().parse(id)), "utf8"))
  );
  const saveRecovery = async (record: WorktreeRecoveryRecord) => {
    await mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
    await writeAtomic(recoveryPath(record.id), `${JSON.stringify(RecoverySchema.parse(record), null, 2)}\n`);
  };
  const git = async () => {
    const runner = await resolveRunner();
    if (!runner) throw new Error("System Git is unavailable");
    return runner;
  };
  const readRegistration = async (runner: GitCommandRunner, commonDir: string, signal?: AbortSignal) => {
    const raw = await readGit(runner, ["worktree", "list", "--porcelain", "-z"], {
      cwd: commonDir, timeoutMs: 8_000, maxOutputBytes: 2_000_000, signal
    });
    const entries = parseWorktreeList(raw.stdout);
    const first = entries[0];
    // Git can report an absorbed submodule's admin directory as its main tree.
    if (first && resolve(first.path) === resolve(commonDir) &&
        !raw.stdout.split("\0\0")[0].split("\0").includes("bare")) {
      const main = await readGit(runner, ["rev-parse", "--show-toplevel"], {
        cwd: commonDir, env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: 8_000, maxOutputBytes: 32_000, signal
      });
      first.path = await realpath(main.stdout.trim());
    }
    return entries;
  };
  const inspect = async (
    runner: GitCommandRunner,
    commonDir: string,
    registration: GitWorktree,
    mainPath: string,
    keptReason?: string,
    signal?: AbortSignal,
    base?: WorktreeIntegration,
    repositoryKeptReason?: string,
    lightweight = false
  ): Promise<WorktreeEntry> => {
    keptReason ??= repositoryKeptReason;
    const path = resolve(registration.path);
    const reasons: string[] = [];
    const reasonDetails: NonNullable<WorktreeEntry["reasonDetails"]> = [];
    const addReason = (raw: string, message = raw, values?: Record<string, string | number>, detail?: string) => {
      reasons.push(raw);
      reasonDetails.push({ message, values, detail });
    };
    const changes: string[] = [];
    const ignored: string[] = [];
    let submodules = false;
    let unsafeLocalState = false;
    let headNeedsProtection = false;
    let localContentUncertain = false;
    const pausedOperations: string[] = [];
    let integration = base;
    let exists = false;
    try {
      exists = (await lstat(path)).isDirectory();
    } catch (error) {
      if (!isMissingFileError(error)) addReason(`Could not inspect path: ${String(error)}`, "Could not inspect path", undefined, String(error));
    }
    const main = path === resolve(mainPath);
    if (main) addReason("Main working tree");
    if (registration.locked) addReason(`Git lock: ${registration.locked}`, "Git lock", undefined, registration.locked);
    if (registration.prunable) addReason(`Git registration: ${registration.prunable}`, "Git registration needs review", undefined, registration.prunable);
    if (!exists) addReason("Directory is unavailable");
    if (exists && !main) {
      try {
        const status = await readGit(runner,
          ["status", "--porcelain=v1", "-z", "--ignored=matching", lightweight ? "--untracked-files=normal" : "--untracked-files=all"],
          { cwd: path, env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: 12_000, maxOutputBytes: 4_000_000, signal }
        );
        for (const record of status.stdout.split("\0").filter(Boolean)) {
          if (record.startsWith("!! ")) ignored.push(record.slice(3));
          else changes.push(record);
        }
        if (changes.length) addReason(`${changes.length} changed or untracked paths`, "{{count}} changed or untracked paths", { count: changes.length });
        if (changes.some((record) => /^(?:DD|AU|UD|UA|DU|AA|UU) /.test(record))) {
          addReason("Unresolved Git conflicts");
        }
        if (ignored.length) addReason(`${ignored.length} ignored paths`, "{{count}} ignored paths", { count: ignored.length });
        // Gitlinks protect initialized and missing submodules without launching git-submodule.
        const modules = await readGit(runner, ["ls-files", "--stage", "-z"], {
          cwd: path, timeoutMs: 8_000, maxOutputBytes: 4_000_000, signal
        });
        submodules = modules.stdout.split("\0").some((record) => record.startsWith("160000 "));
        if (submodules) addReason("Contains submodules");
        const flags = await readGit(runner, ["ls-files", "-v", "-z"], {
          cwd: path, timeoutMs: 8_000, maxOutputBytes: 4_000_000, signal
        });
        localContentUncertain = flags.stdout.split("\0").some((record) => /^[a-zS] /.test(record));
        if (localContentUncertain) addReason("Index flags can hide local changes; recovery backup required");
        const gitDirResult = await readGit(runner, ["rev-parse", "--git-dir"], {
          cwd: path, timeoutMs: 8_000, maxOutputBytes: 32_000, signal
        });
        const gitDir = resolve(path, gitDirResult.stdout.trim());
        if ((await Promise.all(ACTIVE_WORKTREE_LOCKS.map((marker) => pathExists(join(gitDir, marker))))).some(Boolean)) {
          addReason("Git operation in progress: active writer lock");
          unsafeLocalState = true;
        }
        for (const marker of PAUSED_WORKTREE_MARKERS) if (await pathExists(join(gitDir, marker))) pausedOperations.push(marker);
        if (pausedOperations.length) addReason("Paused Git operation; manual recovery backup required");
        const reportedNested = lightweight && (await Promise.all([...changes.map((record) => record.slice(3)), ...ignored]
          .filter((name) => name.endsWith("/"))
          .map((name) => pathExists(join(path, name, ".git"))))).some(Boolean);
        if (reportedNested || !lightweight && await hasNestedRepository(path, signal)) {
          addReason("Contains a nested repository");
          unsafeLocalState = true;
        }
        if (registration.detached) {
          const unique = await readGit(runner, ["for-each-ref", "--format=%(refname)", "--contains", registration.head ?? "HEAD"], {
            cwd: path, timeoutMs: 8_000, maxOutputBytes: 1_000_000, signal
          });
          if (!unique.stdout.trim()) {
            addReason("Detached commit has no branch or tag reference");
            headNeedsProtection = true;
          }
        }
        integration = await withIntegrationEvidence(runner, path, base ?? await readIntegration(runner, commonDir), registration.head, signal);
        if (!integration.head) addReason("Integration target is unavailable; confirm the task is finished");
        else if (integration.ref === `refs/heads/${registration.branch}`) addReason("Integration target is this Worktree's own branch; confirm the task is finished");
        else if (!integration.merged) addReason("Branch work is not confirmed in the integration target; confirm the task is finished");
      } catch (error) {
        signal?.throwIfAborted();
        addReason(`Git check failed: ${repositoryDiscoveryIssue(path, error)}`, "Git check failed", undefined, repositoryDiscoveryIssue(path, error));
      }
    }
    const state = keptReason || registration.locked ? "kept"
      : main || !exists || registration.prunable || reasons.some((reason) => reason.startsWith("Git check failed") || reason.startsWith("Could not inspect")) ? "unavailable"
      : reasons.length ? "review" : "candidate";
    const manualReviewAvailable = !main && exists && !registration.locked && !registration.prunable &&
      !submodules && !unsafeLocalState && Boolean(registration.head) &&
      !reasons.some((reason) => reason.startsWith("Git check failed") || reason.startsWith("Could not inspect"));
    const cleanupReviewAvailable = manualReviewAvailable && !headNeedsProtection && !localContentUncertain &&
      !changes.length && !ignored.length && !submodules && Boolean(registration.head) &&
      reasons.every((reason) => INTEGRATION_REVIEW_REASONS.has(reason));
    return {
      path, repositoryPath: resolve(mainPath), commonDir, head: registration.head,
      branch: registration.branch, main, detached: registration.detached,
      locked: registration.locked, prunable: registration.prunable, exists,
      state, reasons, reasonDetails, changes, ignored, submodules,
      keptReason, repositoryKeptReason, cleanupReviewAvailable,
      manualReviewAvailable, headNeedsProtection, integration, pausedOperations, localContentUncertain
    };
  };

  const readRepository = async (commonDir: string) => {
    if (!isAbsolute(commonDir)) throw new Error("Worktree path must be absolute");
    const runner = await git();
    const entries = await readRegistration(runner, commonDir);
    const settings = await readSettings();
    const integration = await readIntegration(runner, commonDir, settings.integrationRefs[commonDir]);
    return { runner, entries, settings, integration };
  };
  const findEntry = async (commonDir: string, path: string, context?: Awaited<ReturnType<typeof readRepository>>, lightweight = false) => {
    if (!isAbsolute(commonDir) || !isAbsolute(path)) throw new Error("Worktree path must be absolute");
    const { runner, entries, settings, integration } = context ?? await readRepository(commonDir);
    const target = entries.find((entry) => resolve(entry.path) === resolve(path));
    if (!target) throw new Error("This worktree is no longer registered. Refresh the inventory.");
    return inspect(runner, commonDir, target, entries[0].path,
      settings.kept[keepKey(commonDir, resolve(path))], undefined, integration, settings.keptRepositories[commonDir], lightweight);
  };

  const isKnownCandidate = async (commonDir: string, path?: string) => {
    if (path ? discovered.has(discoveredKey(commonDir, path)) : [...discovered].some((key) => key.startsWith(`${commonDir}\0`))) return true;
    const { inventory } = await inventoryCache.read();
    // A cached row supplies identity only. Every action independently rereads live Git state.
    return Boolean(inventory?.entries.some((entry) => entry.commonDir === commonDir && (path === undefined || entry.path === path)));
  };

  const containsSavedWorkspace = async (path: string, roots: string[]) => (await Promise.all(roots.map(async (root) => {
    const canonical = await realpath(root).catch((error) => { if (isMissingFileError(error)) return resolve(root); throw error; });
    return isWithin(path, canonical);
  }))).some(Boolean);

  const disposal = createWorktreeDisposal({ appDataRoot,
    lookup: async (commonDir, path) => {
      const cachedInventory = (await inventoryCache.read()).inventory;
      for (const entry of cachedInventory?.entries ?? []) disposalEntries.set(discoveredKey(entry.commonDir, entry.path), entry);
      const cached = disposalEntries.get(discoveredKey(commonDir, path));
      if (!cached || cached.main || isWithin(path, commonDir) || isWithin(path, cached.repositoryPath) ||
        isWithin(path, appDataRoot) || isWithin(path, process.cwd())) throw new Error("This directory is not a removable linked Worktree");
      return { ...cached, path: resolve(path), commonDir: await realpath(commonDir),
        main: false, exists: true, state: "review",
        manualReviewAvailable: true, cleanupReviewAvailable: false, headNeedsProtection: false };
    },
    resolveHead: async (path) => (await readGit(await git(), ["rev-parse", "--verify", "HEAD"], { cwd: path, timeoutMs: 2_000, maxOutputBytes: 32_000 })).stdout,
    branchAvailable: async (commonDir, branch, head) => {
      const runner = await git();
      const entries = await readRegistration(runner, commonDir);
      if (entries.some((entry) => entry.branch === branch)) return false;
      const current = await readGit(runner, ["rev-parse", "--verify", `refs/heads/${branch}`], { cwd: commonDir, timeoutMs: 8_000, maxOutputBytes: 32_000 });
      return current.stdout.trim() === head;
    }
  });

  const preview = async (commonDir: string, path: string, allowDirty = false, context?: Awaited<ReturnType<typeof readRepository>>, savedRoots?: string[]): Promise<WorktreeCleanupPreview> => {
    if (!await isKnownCandidate(commonDir, path)) throw new Error("Refresh Worktrees before cleanup");
    const cached = (await inventoryCache.read()).inventory?.entries.find((item) => item.commonDir === commonDir && item.path === path);
    if (cached?.reasons.includes("Contains a nested repository")) {
      throw new Error("Review this worktree before cleanup: Contains a nested repository. Refresh after resolving it.");
    }
    const entry = await findEntry(commonDir, path, context, true);
    if (isWithin(entry.path, recoveryRoot) || isWithin(entry.path, process.cwd())) throw new Error("This worktree contains AgentEnv recovery data or the running application");
    const forceRequired = Boolean(entry.changes.length || entry.ignored.length || entry.pausedOperations?.length);
    const backupRequired = forceRequired || Boolean(entry.localContentUncertain);
    const needsManual = forceRequired || entry.headNeedsProtection;
    if ((!entry.cleanupReviewAvailable && !(allowDirty && entry.manualReviewAvailable)) || (needsManual && !allowDirty) || entry.keptReason || !entry.head) {
      throw new Error(`Review this worktree before cleanup: ${entry.reasons.join("; ") || entry.state}`);
    }
    const measurement = measurements.get(entry.path)?.value;
    entry.sizeBytes = measurement?.sizeBytes;
    entry.modifiedAt = measurement?.modifiedAt;
    entry.measurementPending = !measurement;
    const gitState = await readWorktreeGitState(context?.runner ?? await git(), entry.path);
    await assertLinkedGitDirectory(entry.commonDir, entry.path, gitState.gitDir);
    if (gitState.head !== entry.head) throw new Error("Worktree changed after review. Refresh and review it again.");
    const roots = savedRoots ?? await projectStore.listLocalRootPaths();
    const savedWorkspace = await containsSavedWorkspace(entry.path, roots);
    const previewId = randomUUID();
    const fingerprint = reviewFingerprint(entry, gitState.fingerprint);
    issuedPreviews.set(previewId, { commonDir, path, fingerprint,
      forceRequired, backupRequired, manualAuthorized: allowDirty, issuedAt: Date.now(), reviewHash: fingerprint });
    return { previewId, entry, fingerprint, fingerprintScope: "git-and-selected-paths", checkedAt: new Date().toISOString(),
      backupRequired, forceRequired,
      savedWorkspace, gitFingerprint: gitState.fingerprint };
  };

  const service: WorktreeService = {
    dispose: async () => {
      disposed = true;
      measurementQueue.cancel();
      scanController?.abort(new WorktreeScanCancelledError());
      await scanPromise?.catch(() => undefined);
      await measurementQueue.drain();
    },
    onInventoryChanged: (listener) => { inventoryListeners.add(listener); return () => { inventoryListeners.delete(listener); }; },
    cachedInventory: async () => ({ ...await inventoryCache.read(), scanning: Boolean(scanPromise) }),
    setIntegrationRef: async (commonDir, ref) => {
      if (!await isKnownCandidate(commonDir)) throw new Error("Refresh Worktrees before choosing an integration target");
      const integration = await readIntegration(await git(), commonDir);
      if (ref && !integration.choices.includes(ref)) throw new Error("Integration target is unavailable. Refresh Worktrees.");
      const current = await readSettings();
      const integrationRefs = { ...current.integrationRefs };
      if (ref) integrationRefs[commonDir] = ref;
      else delete integrationRefs[commonDir];
      await saveSettings({ ...current, integrationRefs });
    },
    readAnalysis: async (commonDir, path) => {
      if (!discovered.has(discoveredKey(commonDir, path))) {
        const { inventory } = await inventoryCache.read();
        // Cached rows identify a read-only request, never authorize cleanup or supply AI evidence.
        if (!inventory?.entries.some((entry) => entry.commonDir === commonDir && entry.path === path)) {
          throw new Error("Refresh Worktrees before analyzing this directory.");
        }
      }
      const entry = await findEntry(commonDir, path);
      if (entry.main || !entry.exists || !entry.head) throw new Error("This linked Worktree is unavailable for analysis. Refresh the inventory.");
      return readWorktreeAnalysis(entry, await git());
    },
    addScanRoot: async (path) => {
      if (!isAbsolute(path)) throw new Error("Scan location must be absolute");
      const canonical = await realpath(path);
      if (!(await stat(canonical)).isDirectory()) throw new Error("Scan location must be a directory");
      const current = await readSettings();
      if (!current.scanRoots.includes(canonical)) {
        await saveSettings({ ...current, scanRoots: [...current.scanRoots, canonical] });
      }
    },
    removeScanRoot: async (path) => {
      const current = await readSettings();
      const target = await realpath(path).catch(() => resolve(path));
      const canonical = await Promise.all(current.scanRoots.map((root) => realpath(root).catch(() => resolve(root))));
      await saveSettings({ ...current, scanRoots: current.scanRoots.filter((root, index) => root !== path && canonical[index] !== target) });
    },
    setKeep: async (commonDir, path, reason) => {
      if (!await isKnownCandidate(commonDir, path)) throw new Error("Refresh Worktrees before changing a keep decision");
      const entry = await findEntry(commonDir, path);
      if (entry.main) throw new Error("The main working tree cannot be marked for cleanup");
      const current = await readSettings();
      const kept = { ...current.kept };
      const key = keepKey(entry.commonDir, entry.path);
      if (reason?.trim()) kept[key] = reason.trim().slice(0, 200);
      else delete kept[key];
      await saveSettings({ ...current, kept });
    },
    setRepositoryKeep: async (commonDir, reason) => {
      if (!await isKnownCandidate(commonDir)) throw new Error("Refresh Worktrees before changing a keep decision");
      await readRegistration(await git(), commonDir);
      const current = await readSettings();
      const keptRepositories = { ...current.keptRepositories };
      if (reason?.trim()) keptRepositories[commonDir] = reason.trim().slice(0, 200);
      else delete keptRepositories[commonDir];
      await saveSettings({ ...current, keptRepositories });
    },
    inventory: async (mode) => {
      scanController?.abort(new WorktreeScanCancelledError());
      const controller = new AbortController();
      scanController = controller;
      try {
        const settings = await readSettings();
        controller.signal.throwIfAborted();
        const projects = await projectStore.listLocalRootPaths();
        controller.signal.throwIfAborted();
        const issues: string[] = [];
        const trashedPaths = (await disposal.list()).paths;
        const builtinRoots: string[] = [];
        const canonicalHome = await realpath(homeDir).catch(() => resolve(homeDir));
        for (const candidate of builtinCandidates) {
          controller.signal.throwIfAborted();
          try {
            if ((await stat(candidate)).isDirectory()) {
              const canonical = await realpath(candidate);
              if (isWithin(canonical, canonicalHome)) {
                issues.push(`${candidate}: This automatic location resolves to Home or its parent. Add a narrower location.`);
              } else builtinRoots.push(canonical);
            }
          } catch (error) {
            if (!isMissingFileError(error)) issues.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        const canonicalRoots = async (roots: string[]) => [...new Set(await Promise.all(
          roots.map((root) => realpath(root).catch((error) => {
            if (!isMissingFileError(error)) issues.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
            return resolve(root);
          }))
        ))];
        const configuredRoots = await canonicalRoots(settings.scanRoots);
        const scanRoots = await canonicalRoots([...configuredRoots, ...builtinRoots, ...projects]);
        const previous = (await inventoryCache.read()).inventory;
        const reuseRepositories = mode === "background" && previous && !previous.incomplete &&
          Date.now() - lastDiscoveryAt < 30 * 60_000 &&
          JSON.stringify([...scanRoots].sort()) === JSON.stringify([...previous.scanRoots].sort());
        const canonicalDataRoot = await realpath(appDataRoot).catch((error) => {
          if (isMissingFileError(error)) return resolve(appDataRoot);
          throw error;
        });
        controller.signal.throwIfAborted();
        const entries: WorktreeEntry[] = [];
        const inspections: Array<{ commonDir: string; registration: GitWorktree; mainPath: string }> = [];
        const found = new Set<string>();
        const visited = new Set<string>();
        const repositories = new Set<string>();
        let count = 0;
        const runner = await git();
        controller.signal.throwIfAborted();
        const queues = scanRoots.map((path) => reuseRepositories ? [] as string[] : [path]);
        if (reuseRepositories) {
          for (const commonDir of new Set(previous.entries.map((entry) => entry.commonDir))) {
            controller.signal.throwIfAborted();
            try {
              const registered = await readRegistration(runner, commonDir, controller.signal);
              repositories.add(commonDir);
              for (const registration of registered) if (!trashedPaths.has(resolve(registration.path))) inspections.push({ commonDir, registration, mainPath: registered[0].path });
            } catch (error) {
              controller.signal.throwIfAborted();
              issues.push(repositoryDiscoveryIssue(commonDir, error));
            }
          }
        }
        for (const [index, root] of (reuseRepositories ? [] : scanRoots).entries()) {
          controller.signal.throwIfAborted();
          try {
            const rootPath = await findRepositoryAncestor(root, controller.signal);
            if (rootPath && resolve(rootPath) !== resolve(root)) {
              const canonical = await realpath(rootPath);
              if (isWithin(canonical, canonicalHome) && !scanRoots.includes(canonical)) {
                issues.push(`${root}: The repository root is Home or its parent. Add the repository explicitly to include it.`);
              } else queues[index].push(canonical);
            }
          } catch (error) {
            controller.signal.throwIfAborted();
            issues.push(repositoryDiscoveryIssue(root, error));
          }
        }
        let cursor = 0;
        // Advance each location in turn, preserving breadth-first order within it.
        while (queues.some((queue) => queue.length)) {
          controller.signal.throwIfAborted();
          const queue = queues[cursor++ % queues.length];
          if (!queue.length) continue;
          const current = queue.shift()!;
          try {
            const canonical = await realpath(current);
            if (isWithin(canonicalDataRoot, canonical) || visited.has(canonical)) continue;
            if (++count > MAX_DIRECTORIES) {
              issues.push(`${scanRoots[(cursor - 1) % queues.length]}: Repository discovery reached the directory limit at ${current}. Add a narrower scan location. Registered Worktrees from discovered repositories are already included.`);
              break;
            }
            visited.add(canonical);
            const directory = await readdir(canonical, { withFileTypes: true });
            if (directory.some((entry) => entry.name === ".git")) {
              try {
                const result = await readGit(runner, ["rev-parse", "--git-common-dir"], {
                  cwd: canonical, timeoutMs: 8_000, maxOutputBytes: 32_000, signal: controller.signal
                });
                const commonDir = await realpath(resolve(canonical, result.stdout.trim()));
                if (!repositories.has(commonDir)) {
                  const registered = await readRegistration(runner, commonDir, controller.signal);
                  repositories.add(commonDir);
                  for (const registration of registered) {
                    if (trashedPaths.has(resolve(registration.path))) continue;
                    controller.signal.throwIfAborted();
                    inspections.push({ commonDir, registration, mainPath: registered[0].path });
                  }
                }
                const nested = await repositoryDiscoveryDirectories(runner, canonical, controller.signal);
                issues.push(...nested.issues);
                queue.push(...nested.paths);
                continue;
              } catch (error) {
                controller.signal.throwIfAborted();
                issues.push(repositoryDiscoveryIssue(current, error));
              }
            }
            for (const child of directory) {
              if (child.isDirectory() && !SKIP_DIRECTORIES.has(child.name)) {
                queue.push(join(canonical, child.name));
              }
            }
          } catch (error) {
            controller.signal.throwIfAborted();
            issues.push(`${current}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        controller.signal.throwIfAborted();
        const integrationByRepo = new Map<string, WorktreeIntegration>();
        const repoQueue = [...repositories];
        let nextRepository = 0;
        const targetReads = await Promise.allSettled(Array.from({ length: Math.min(INSPECTION_CONCURRENCY, repoQueue.length) }, async () => {
          while (nextRepository < repoQueue.length) {
            controller.signal.throwIfAborted();
            const commonDir = repoQueue[nextRepository++];
            try {
              integrationByRepo.set(commonDir, await readIntegration(runner, commonDir, settings.integrationRefs[commonDir], controller.signal));
            } catch (error) {
              controller.signal.throwIfAborted();
              issues.push(repositoryDiscoveryIssue(commonDir, error));
              integrationByRepo.set(commonDir, { explicit: Boolean(settings.integrationRefs[commonDir]), choices: [] });
            }
          }
        }));
        for (const result of targetReads) if (result.status === "rejected") throw result.reason;
        let nextInspection = 0;
        const completed = await Promise.allSettled(Array.from(
          { length: Math.min(INSPECTION_CONCURRENCY, inspections.length) }, async () => {
            while (nextInspection < inspections.length) {
              controller.signal.throwIfAborted();
              const index = nextInspection++;
              const { commonDir, registration, mainPath } = inspections[index];
              const entry = await inspect(runner, commonDir, registration, mainPath,
                settings.kept[keepKey(commonDir, resolve(registration.path))], controller.signal, integrationByRepo.get(commonDir), settings.keptRepositories[commonDir]);
              entries[index] = entry;
              found.add(discoveredKey(commonDir, entry.path));
            }
          }
        ));
        for (const result of completed) if (result.status === "rejected") throw result.reason;
        controller.signal.throwIfAborted();
        discovered.clear();
        for (const key of found) discovered.add(key);
        // An unreadable repository is not evidence that its worktrees were removed.
        // Retained rows are display-only and never enter `discovered` authorization.
        if (issues.length && previous && JSON.stringify([...scanRoots].sort()) === JSON.stringify([...previous.scanRoots].sort())) {
          for (const entry of previous.entries) {
            if (!trashedPaths.has(entry.path) && !repositories.has(entry.commonDir) && !found.has(discoveredKey(entry.commonDir, entry.path))) {
              entries.push({ ...entry, state: "unavailable", cleanupReviewAvailable: false,
                manualReviewAvailable: false,
                reasonDetails: [...(entry.reasonDetails ?? entry.reasons.map((message) => ({ message }))), { message: "Could not refresh this repository; showing the last known state." }],
                reasons: [...new Set([...entry.reasons, "Could not refresh this repository; showing the last known state."])] });
            }
          }
        }
        const visiblePaths = new Set(entries.map((entry) => entry.path));
        for (const path of measurements.keys()) if (!visiblePaths.has(path)) measurements.delete(path);
        if (!reuseRepositories) lastDiscoveryAt = Date.now();
        return measurementQueue.prepare({
          scanRoots, configuredRoots, builtinRoots: [...new Set(builtinRoots)], entries, issues,
          incomplete: issues.length > 0,
          scannedAt: new Date().toISOString()
        }, mode === "background");
      } catch (error) {
        controller.signal.throwIfAborted();
        throw error;
      } finally {
        if (scanController === controller) scanController = undefined;
      }
    },
    cancelScan: () => scanController?.abort(new WorktreeScanCancelledError()),
    preview: async (commonDir, path, allowDirty, mode) => {
      if (!mode) return preview(commonDir, path, allowDirty);
      if (!await isKnownCandidate(commonDir, path)) throw new Error("Refresh Worktrees before cleanup");
      return { ...await disposal.preview(commonDir, path, mode), savedWorkspace: await containsSavedWorkspace(path, await projectStore.listLocalRootPaths()) };
    },
    previewTrashDeletion: disposal.previewTrash,
    previewBatch: async (items, progress) => {
      if (items.length > 1000) throw new Error("Too many Worktrees selected");
      const contexts = new Map<string, ReturnType<typeof readRepository>>();
      const savedRoots = await projectStore.listLocalRootPaths();
      const results: WorktreeCleanupPreparation[] = new Array(items.length);
      let cursor = 0, completed = 0;
      await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
        while (cursor < items.length) {
          const index = cursor++, item = items[index];
          try {
            if (!await isKnownCandidate(item.commonDir, item.path)) throw new Error("Refresh Worktrees before cleanup");
            if (item.mode) {
              results[index] = { path: item.path, preview: { ...await disposal.preview(item.commonDir, item.path, item.mode), savedWorkspace: await containsSavedWorkspace(item.path, savedRoots) } };
              ++completed;
              try { await progress?.(completed, item.path, structuredClone(results[index])); } catch { /* Feedback is best effort. */ }
              continue;
            }
            let context = contexts.get(item.commonDir);
            if (!context) { context = readRepository(item.commonDir); contexts.set(item.commonDir, context); }
            results[index] = { path: item.path, preview: await preview(item.commonDir, item.path, item.allowDirty, await context, savedRoots) };
          } catch (cause) { results[index] = { path: item.path, error: cause instanceof Error ? cause.message : String(cause) }; }
          ++completed;
          try { Promise.resolve(progress?.(completed, item.path, structuredClone(results[index]))).catch(() => undefined); }
          catch { /* Feedback is best effort. */ }
        }
      }));
      return results;
    },
    remove: async (preview, progress) => {
      const report = (phase: WorktreeOperationPhase, fileProgress?: WorktreeFileProgress) => {
        try { Promise.resolve(progress?.(phase, fileProgress)).catch(() => undefined); }
        catch { /* Feedback is best effort. */ }
      };
      if (preview.mode) return disposal.remove(preview, report);
      report("preparing");
      const issued = issuedPreviews.get(preview.previewId);
      issuedPreviews.delete(preview.previewId);
      if (!issued || issued.commonDir !== preview.entry.commonDir || issued.path !== preview.entry.path ||
          issued.fingerprint !== preview.fingerprint || issued.forceRequired !== preview.forceRequired ||
          preview.fingerprintScope !== "git-and-selected-paths" ||
          !preview.gitFingerprint || reviewFingerprint(preview.entry, preview.gitFingerprint) !== issued.reviewHash ||
          preview.backupRequired !== issued.backupRequired ||
          Date.now() - issued.issuedAt > 10 * 60_000) {
        throw new Error("Cleanup review expired. Review this worktree again.");
      }
      const fresh = await findEntry(preview.entry.commonDir, preview.entry.path);
      const gitState = await readWorktreeGitState(await git(), fresh.path);
      await assertLinkedGitDirectory(fresh.commonDir, fresh.path, gitState.gitDir);
      if (reviewFingerprint(fresh, gitState.fingerprint) !== issued.reviewHash) {
        throw new Error("Worktree changed after review. Refresh and review it again.");
      }
      if ((!fresh.cleanupReviewAvailable && !(issued.manualAuthorized && fresh.manualReviewAvailable)) ||
          !fresh.manualReviewAvailable || fresh.keptReason ||
          Boolean(fresh.changes.length || fresh.ignored.length || fresh.pausedOperations?.length) !== preview.forceRequired ||
          Boolean(fresh.localContentUncertain) !== Boolean(preview.entry.localContentUncertain) ||
          fresh.headNeedsProtection !== preview.entry.headNeedsProtection ||
          fresh.head !== preview.entry.head ||
          fresh.branch !== preview.entry.branch || fresh.repositoryPath !== preview.entry.repositoryPath) {
        throw new Error("Worktree changed after review. Refresh and review it again.");
      }
      const fingerprint = await fingerprintWorktreeTree(fresh.path, { progress: progress ? (value) => report("preparing", value) : undefined });
      // The preview authorized Git state and bounded path signatures, not whole
      // content equality. This exact snapshot includes the newest folder bytes.
      const record: WorktreeRecoveryRecord = {
        id: randomUUID(), path: fresh.path, repositoryPath: fresh.repositoryPath,
        head: fresh.head!, branch: fresh.branch, createdAt: new Date().toISOString(),
        status: "prepared", sourceHash: fingerprint.hash, sourceSizeBytes: fingerprint.sizeBytes,
        sourceGitFingerprint: gitState.fingerprint
      };
      const backup = backupPath(record.id);
      const runner = await git();
      if (issued.backupRequired) {
        report("backing-up");
        await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
        const backupHash = await copyWorktreeVerified(fresh.path, backup, fingerprint.hash,
          progress ? (value) => report("backing-up", value) : undefined);
        if (backupHash !== fingerprint.hash) throw new Error("Worktree changed while backup was created");
        record.backupHash = backupHash;
        const gitDirOutput = await runner.run(["rev-parse", "--git-dir"], {
          cwd: fresh.path, timeoutMs: 8_000, maxOutputBytes: 32_000
        });
        const indexPath = resolve(fresh.path, gitDirOutput.stdout.trim(), "index");
        if (await pathExists(indexPath)) {
          record.indexHash = await copyPathVerified(indexPath, join(recoveryRoot, record.id, "index"), {
            recursive: false
          });
        }
        if ((record.indexHash ?? null) !== gitState.index) throw new Error("Worktree changed while its staged-state backup was created");
        record.operationHash = await backupOperationMetadata(gitState.gitDir, join(recoveryRoot, record.id, "operation"));
        record.gitStatusHash = createHash("sha256").update(gitState.status).digest("hex");
      }
      const mainBefore = await readMainGitState(runner, fresh.repositoryPath);
      const refsBefore = await readRepositoryRefs(runner, fresh.repositoryPath);
      record.protectedRef = `refs/agentenv/worktree-recovery/${record.id}`;
      await runner.run(["update-ref", record.protectedRef, record.head], {
        cwd: fresh.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 100_000
      });
      record.protectedRefs = [];
      const recoveryObjects = issued.backupRequired
        ? await operationRecoveryObjects(runner, fresh.path, join(recoveryRoot, record.id, "operation"), record.head,
          (reference) => (record.unavailableOperationObjects ??= []).push(reference)) : [];
      for (const [index, object] of recoveryObjects.entries()) {
        const ref = `refs/agentenv/worktree-recovery/${record.id}-objects/${index}`;
        await runner.run(["update-ref", ref, object], { cwd: fresh.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 100_000 });
        const verified = await runner.run(["rev-parse", "--verify", ref], { cwd: fresh.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 32_000 });
        if (verified.stdout.trim() !== object) throw new Error("Git recovery reference could not be verified; nothing was removed");
        record.protectedRefs.push({ ref, object });
      }
      if ((await runner.run(["rev-parse", "--verify", record.protectedRef], {
        cwd: fresh.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 32_000
      })).stdout.trim() !== record.head) throw new Error("Git recovery reference could not be verified; nothing was removed");
      await saveRecovery(record);
      report("removing");
      if (await hashWorktreeTree(fresh.path, { step: "verifying-source",
        progress: progress ? (value) => report("removing", value) : undefined }) !== fingerprint.hash) {
        throw new Error("Worktree changed after backup. Refresh and review it again.");
      }
      const finalEntry = await findEntry(fresh.commonDir, fresh.path);
      const finalGitState = await readWorktreeGitState(runner, fresh.path);
      if (!finalEntry.manualReviewAvailable || finalEntry.keptReason ||
          (record.operationHash && record.operationHash !== await operationMetadataHash(finalGitState.gitDir)) ||
          reviewFingerprint({ ...finalEntry, headNeedsProtection: fresh.headNeedsProtection }, finalGitState.fingerprint) !== issued.reviewHash) {
        throw new Error("Worktree changed after backup. Refresh and review it again.");
      }
      try {
        await assertNoWorktreeWriter(finalGitState.gitDir);
        await runner.run(["-c", "core.fsmonitor=false", "worktree", "remove", ...(preview.forceRequired ? ["--force"] : []), "--", fresh.path], {
          cwd: fresh.repositoryPath, timeoutMs: 60_000, maxOutputBytes: 1_000_000
        });
      } catch (error) {
        const [registered, stillExists, sameContent] = await Promise.all([
          readRegistration(runner, fresh.commonDir)
            .then((items) => items.some((item) => resolve(item.path) === fresh.path), () => false),
          lstat(fresh.path).then(() => true, () => false),
          hashWorktreeTree(fresh.path).then((hash) => hash === fingerprint.hash, () => false)
        ]);
        const sameGit = registered && stillExists && await readWorktreeGitState(runner, fresh.path)
          .then(async (state) => state.fingerprint === finalGitState.fingerprint &&
            (!record.operationHash || await operationMetadataHash(state.gitDir) === record.operationHash), () => false);
        if (registered && stillExists && sameContent && sameGit) {
          await saveRecovery({ ...record, status: "unchanged" });
          await rm(join(recoveryRoot, record.id), { recursive: true, force: true });
          if (record.protectedRef) {
            await runner.run(["update-ref", "-d", record.protectedRef, record.head], {
              cwd: fresh.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 100_000
            });
          }
          for (const { ref, object } of record.protectedRefs ?? []) {
            await runner.run(["update-ref", "-d", ref, object], { cwd: fresh.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 100_000 });
          }
          throw new Error(`Git could not remove this worktree; the original directory is unchanged. ${error instanceof Error ? error.message : String(error)}`);
        }
        throw new Error(`Worktree removal needs recovery. Open Worktree recovery before retrying. ${error instanceof Error ? error.message : String(error)}`);
      }
      const remaining = await readRegistration(runner, fresh.commonDir);
      report("verifying");
      if (remaining.some((item) => resolve(item.path) === fresh.path) ||
          await lstat(fresh.path).then(() => true, (error) => !isMissingFileError(error))) {
        throw new Error("Worktree removal needs recovery: verify the directory and Git registration");
      }
      const verificationWarnings: string[] = [];
      try {
        if ((await readMainGitState(runner, fresh.repositoryPath)).fingerprint !== mainBefore.fingerprint ||
            await readRepositoryRefs(runner, fresh.repositoryPath) !== refsBefore) {
          verificationWarnings.push("Worktree removed, but the main Git status or branch references changed during cleanup. Review this repository before continuing; the recovery point is retained.");
        }
        const stale = await readGit(runner, ["worktree", "prune", "--dry-run", "--verbose"], { cwd: fresh.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 100_000 });
        if ((stale.stdout + stale.stderr).trim()) verificationWarnings.push("Git reports stale Worktree registrations. Review them separately; no registrations were pruned.");
      } catch {
        verificationWarnings.push("Worktree removed, but repository verification could not finish. Review this repository before continuing; the recovery point is retained.");
      }
      const completed = { ...record, status: "removed" as const, reclaimedSizeBytes: record.backupHash ? 0 : record.sourceSizeBytes,
        ...(verificationWarnings.length ? { verificationWarnings } : {}) };
      await saveRecovery(completed);
      return completed;
    },
    listRecovery: async (scope) => {
      const trash = await disposal.list();
      if (scope === "trash") return { records: trash.records, issues: trash.issues };
      try {
        const files = (await readdir(recoveryRoot)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name));
        const results = await Promise.allSettled(files.map((name) => readRecovery(name.slice(0, -5))));
        const issues: string[] = [];
        const records: WorktreeRecoveryRecord[] = [];
        for (const [index, result] of results.entries()) {
          if (result.status === "rejected") {
            issues.push(`${files[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
            continue;
          }
          let record = result.value;
          if (record.status === "prepared") {
            try {
              const runner = await git();
              const registration = await readRegistration(runner, record.repositoryPath);
              const registered = registration.some((item) => resolve(item.path) === record.path);
              const exists = await pathExists(record.path);
              if (!registered && !exists) {
                record = { ...record, status: "removed", reclaimedSizeBytes: record.backupHash ? 0 : record.sourceSizeBytes };
                await saveRecovery(record);
              } else if (registered && exists && record.sourceHash &&
                         await hashWorktreeTree(record.path) === record.sourceHash &&
                         (!record.sourceGitFingerprint || (await readWorktreeGitState(runner, record.path)).fingerprint === record.sourceGitFingerprint)) {
                record = { ...record, status: "unchanged" };
                await saveRecovery(record);
              }
            } catch (error) {
              issues.push(`${record.path}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          records.push(record);
        }
        return {
          records: [...trash.records, ...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
          issues: [...trash.issues, ...issues]
        };
      } catch (error) {
        if (isMissingFileError(error)) return { records: trash.records, issues: trash.issues };
        throw error;
      }
    },
    restore: async (id) => {
      if (await disposal.owns(id)) return disposal.restore(id);
      let record = await readRecovery(id);
      if (record.status === "restored") return record;
      if (record.status === "unchanged") throw new Error("This worktree was not removed; the original directory is still present");
      if (record.status === "prepared") throw new Error("Cleanup is incomplete. Check the original directory and Git registration before restoring.");
      const backup = backupPath(record.id);
      if (record.backupHash && await hashWorktreeTree(backup) !== record.backupHash) {
        throw new Error("Worktree recovery copy failed its integrity check");
      }
      if (record.indexHash &&
          await hashRequiredPathEntry(join(recoveryRoot, id, "index")) !== record.indexHash) {
        throw new Error("Worktree staged-state recovery copy failed its integrity check");
      }
      const operation = join(recoveryRoot, id, "operation");
      if (record.operationHash && await operationMetadataHash(operation) !== record.operationHash) {
        throw new Error("Worktree operation-state recovery copy failed its integrity check");
      }
      const runner = await git();
      const registration = await readRegistration(runner, record.repositoryPath);
      if (resolve(registration[0].path) === resolve(record.path) || resolve(record.repositoryPath) === resolve(record.path)) {
        throw new Error("Recovery cannot overwrite the main working tree");
      }
      let isRegistered = registration.some((item) => resolve(item.path) === record.path);
      let exists = await pathExists(record.path);
      const commonDir = resolve(record.repositoryPath, (await readGit(runner, ["rev-parse", "--git-common-dir"], {
        cwd: record.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 32_000
      })).stdout.trim());
      const readRestoreGitDir = async () => {
        if (!record.restoreRegistration) throw new Error("Recovery Git registration identity is unverified; nothing was overwritten");
        await assertRestoreRegistration(record.restoreRegistration, commonDir, record.path);
        return record.restoreRegistration.gitDir;
      };
      const checkpoint = async () => {
        const gitDir = await readRestoreGitDir();
        record = { ...record, restoreAttemptHash: await hashWorktreeTree(record.path),
          restoreAttemptGitHash: await recoveryGitStateHash(gitDir) };
        await readRestoreGitDir();
        await saveRecovery(record);
      };
      if (exists && isRegistered && record.status === "restoring" &&
          (!record.restoreRegistration || record.legacyCheckoutMigration)) {
        if (!record.restoreAttemptHash || await hashWorktreeTree(record.path) !== record.restoreAttemptHash) {
          throw new Error("Legacy recovery checkout changed; nothing was overwritten");
        }
        const state = await readWorktreeGitState(runner, record.path);
        const flags = await readGit(runner, ["ls-files", "-v", "-z"], {
          cwd: record.path, timeoutMs: 8_000, maxOutputBytes: 4_000_000
        });
        if (state.head !== record.head || state.status || flags.stdout.split("\0").some((line) => /^[a-zS] /.test(line))) {
          throw new Error("Legacy recovery checkout or index contains unverified changes; nothing was overwritten");
        }
        for (const name of await readdir(state.gitDir)) {
          if (["HEAD", "index", "gitdir", "commondir", "logs"].includes(name)) continue;
          if (name === "refs" && (await lstat(join(state.gitDir, name))).isDirectory() &&
              (await readdir(join(state.gitDir, name))).length === 0) continue;
          if (name === "ORIG_HEAD" && (await readFile(join(state.gitDir, name), "utf8")).trim() === record.head) continue;
          throw new Error(`Legacy recovery Git metadata contains unverified changes (${name}); nothing was overwritten`);
        }
        if (!record.restoreRegistration) record = { ...record,
          restoreRegistration: await readLinkedRegistrationIdentity(commonDir, record.path, state.gitDir) };
        const gitDir = await readRestoreGitDir();
        if (record.restoreAttemptGitHash && await recoveryGitStateHash(gitDir) !== record.restoreAttemptGitHash) {
          throw new Error("Legacy recovery Git state changed; nothing was overwritten");
        }
        // Preserve the entire verified legacy checkout and admin directory before
        // replacing the pristine placeholder via Git, never by overwriting it.
        const legacyRoot = join(recoveryRoot, id, "legacy-checkout");
        await mkdir(legacyRoot, { recursive: true, mode: 0o700 });
        const adminHash = await hashRequiredPathEntry(gitDir);
        await copyRecoveryPathExclusive(record.path, join(legacyRoot, "files"));
        await copyRecoveryPathExclusive(gitDir, join(legacyRoot, "git"));
        if (await hashWorktreeTree(record.path) !== record.restoreAttemptHash ||
            await hashWorktreeTree(join(legacyRoot, "files")) !== record.restoreAttemptHash ||
            await hashRequiredPathEntry(gitDir) !== adminHash ||
            await hashRequiredPathEntry(join(legacyRoot, "git")) !== adminHash) {
          throw new Error("Legacy recovery checkout changed during migration; nothing was removed");
        }
        await checkpoint();
        record = { ...record, legacyCheckoutMigration: true };
        await saveRecovery(record);
        await assertNoWorktreeWriter(await readRestoreGitDir());
        await runner.run(["-c", "core.fsmonitor=false", "worktree", "remove", "--", record.path], {
          cwd: record.repositoryPath, timeoutMs: 60_000, maxOutputBytes: 1_000_000
        });
        if (await pathExists(record.path) || (await readRegistration(runner, record.repositoryPath))
          .some((item) => resolve(item.path) === record.path)) {
          throw new Error("Legacy recovery migration is incomplete; preserved checkout remains available");
        }
        exists = false;
        isRegistered = false;
      }
      if (exists || isRegistered) {
        if (record.status !== "restoring" || !record.restoreAttemptHash || !exists || !isRegistered ||
            await hashWorktreeTree(record.path) !== record.restoreAttemptHash) {
          throw new Error("The recovery path contains unverified files or Git registration. Nothing was overwritten; inspect it before retrying.");
        }
        if (record.restoreAttemptGitHash &&
            await recoveryGitStateHash(await readRestoreGitDir()) !== record.restoreAttemptGitHash) {
          throw new Error("The recovery Git state contains unverified files. Nothing was overwritten; inspect it before retrying.");
        }
        await assertNoWorktreeWriter(await readRestoreGitDir());
        const currentHead = await runner.run(["rev-parse", "HEAD"], {
          cwd: record.path, timeoutMs: 8_000, maxOutputBytes: 100_000
        });
        if (currentHead.stdout.trim() !== record.head) {
          throw new Error("The recovery worktree changed commit. Nothing was overwritten; inspect it before retrying.");
        }
      } else {
        record = { ...record, status: "restoring", restoreAttemptHash: undefined, restoreAttemptGitHash: undefined,
          restoreRegistration: undefined, legacyCheckoutMigration: undefined };
        await saveRecovery(record);
        const adminBefore = await worktreeAdminIdentities(commonDir);
        try {
          let useBranch = false;
          if (record.branch) {
            const currentBranch = await runner.run(["rev-parse", "--verify", `refs/heads/${record.branch}`], {
              cwd: record.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 100_000
            }).then((result) => result.stdout.trim(), () => undefined);
            useBranch = currentBranch === record.head;
          }
          await runner.run(["worktree", "add", ...(record.backupHash ? ["--no-checkout"] : []), ...(useBranch ? [] : ["--detach"]),
            record.path, useBranch ? record.branch! : record.head], {
            cwd: record.repositoryPath, timeoutMs: 60_000, maxOutputBytes: 1_000_000
          });
          record = { ...record, restoreRegistration: await pinRestoreRegistration(commonDir, record.path, adminBefore) };
          await checkpoint();
        } catch (error) {
          if (await pathExists(record.path)) {
            const current = await readRegistration(runner, record.repositoryPath);
            if (current.some((item) => resolve(item.path) === record.path)) {
              // An interrupted no-checkout add owns only its .git link, never
              // adopt arbitrary files another writer put in the new directory.
              if (!record.backupHash || (await readdir(record.path)).every((name) => name === ".git")) {
                if (!record.restoreRegistration) record = { ...record,
                  restoreRegistration: await pinRestoreRegistration(commonDir, record.path, adminBefore) };
                await checkpoint();
              }
            }
          }
          throw error;
        }
      }
      try {
        if (record.backupHash) {
          await assertNoWorktreeWriter(await readRestoreGitDir());
          for (const file of await readdir(backup)) {
            if (file === ".git") continue;
            await copyRecoveryPathExclusive(join(backup, file), join(record.path, file));
          }
          if (await hashWorktreeTree(record.path, { omitGitFile: true }) !== await hashWorktreeTree(backup, { omitGitFile: true }) ||
              record.restoreAttemptGitHash !== await recoveryGitStateHash(await readRestoreGitDir())) {
            throw new Error("The recovery path contains unverified files or Git state. Nothing was overwritten.");
          }
          await checkpoint();
        }
        if (record.indexHash) {
          const gitDirOutput = await runner.run(["rev-parse", "--git-dir"], {
            cwd: record.path, timeoutMs: 8_000, maxOutputBytes: 32_000
          });
          const gitDir = await readRestoreGitDir();
          if (await realpath(resolve(record.path, gitDirOutput.stdout.trim())) !== gitDir) {
            throw new Error("Recovery Git registration identity changed; nothing was overwritten");
          }
          await assertNoWorktreeWriter(gitDir);
          await copyRecoveryPathExclusive(join(recoveryRoot, id, "index"), join(gitDir, "index"));
          await checkpoint();
        }
        if (record.operationHash) {
          const gitDir = await readRestoreGitDir();
          await assertNoWorktreeWriter(gitDir);
          for (const name of await readdir(operation)) {
            await readRestoreGitDir();
            await copyRecoveryPathExclusive(join(operation, name), join(gitDir, name));
          }
          if (await operationMetadataHash(gitDir) !== record.operationHash) {
            throw new Error("Restored Git operation state does not match the recovery point");
          }
          await checkpoint();
        }
        if (record.backupHash) {
          if (await hashWorktreeTree(record.path, { omitGitFile: true }) !==
              await hashWorktreeTree(backup, { omitGitFile: true })) {
            throw new Error("Restored files need review. The recovery copy remains available.");
          }
        } else {
          const restoredHead = await runner.run(["rev-parse", "HEAD"], {
            cwd: record.path, timeoutMs: 8_000, maxOutputBytes: 100_000
          });
          if (restoredHead.stdout.trim() !== record.head) {
            throw new Error("Restored Git commit does not match the recovery point");
          }
        }
        const restoredState = await readWorktreeGitState(runner, record.path);
        await readRestoreGitDir();
        if (restoredState.head !== record.head || (record.indexHash && restoredState.index !== record.indexHash) ||
            (record.gitStatusHash && createHash("sha256").update(restoredState.status).digest("hex") !== record.gitStatusHash)) {
          throw new Error("Restored Git state does not match the recovery point");
        }
      } catch (error) {
        // Only completed phases advance the journal (bounded full-tree passes).
        // A crash inside a copy phase may require manual recovery; all payloads
        // stay protected, and unjournaled partial files are never overwritten.
        throw error;
      }
      const restored = { ...record, status: "restored" as const, restoreAttemptHash: undefined, restoreAttemptGitHash: undefined };
      await saveRecovery(restored);
      return restored;
    }
  };
  const scan = service.inventory;
  service.inventory = (mode) => {
    if (disposed) return Promise.reject(new WorktreeScanCancelledError());
    if (scanPromise) {
      if (!mode && scanMode === "background") return scanPromise.then(() => service.inventory());
      return scanPromise;
    }
    scanMode = mode;
    measurementQueue.cancel();
    inventoryCache.markStale();
    scanPromise = (async () => {
      try {
        const result = await scan(mode);
        await inventoryCache.save(result);
        if (!disposed) measurementQueue.start(result);
        return result;
      } finally { scanPromise = undefined; }
    })();
    return scanPromise;
  };
  const guard = <A extends unknown[], R>(operation: (...args: A) => Promise<R>, keepDisplay = false) => async (...args: A) => {
    measurementQueue.cancel();
    service.cancelScan();
    await scanPromise?.catch(() => undefined);
    await inventoryCache.invalidate(keepDisplay);
    if (keepDisplay) {
      const cached = await inventoryCache.read();
      if (cached.inventory) notifyInventory(cached.inventory);
    }
    if (!keepDisplay) {
      measurements.clear();
      lastDiscoveryAt = 0;
    }
    return operation(...args);
  };
  service.addScanRoot = guard(service.addScanRoot);
  service.removeScanRoot = guard(service.removeScanRoot);
  service.setKeep = guard(service.setKeep, true);
  service.setRepositoryKeep = guard(service.setRepositoryKeep, true);
  service.setIntegrationRef = guard(service.setIntegrationRef, true);
  service.remove = guard(service.remove);
  service.restore = guard(service.restore);
  return service;
};
