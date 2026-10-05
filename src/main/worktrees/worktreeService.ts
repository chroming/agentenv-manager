import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type {
  WorktreeCleanupPreview,
  WorktreeEntry,
  WorktreeInventory,
  WorktreeRecoveryRecord,
  WorktreeRecoveryInventory
} from "../../shared/worktrees";
import { copyPathVerified, hashRequiredPathEntry } from "../filesystemIntegrity";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import type { ProjectStore } from "../projects/projectStore";
import type { GitCommandRunOptions, GitCommandRunner } from "../skillSources/gitCommandRunner";
import { copyWorktreeVerified, fingerprintWorktreeTree, hashWorktreeTree, measureWorktreeTree } from "./worktreeSnapshot";
import { findRepositoryAncestor, repositoryDiscoveryDirectories, repositoryDiscoveryIssue, worktreeDiscoveryCandidates, WORKTREE_SCAN_SKIP_DIRECTORIES } from "./worktreeDiscovery";
import { readWorktreeAnalysis } from "./worktreeAnalysis";

const SettingsSchema = z.object({
  formatVersion: z.literal(1),
  scanRoots: z.array(z.string()),
  kept: z.record(z.string(), z.string())
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
  sourceHash: z.string().length(64).optional(),
  restoreAttemptHash: z.string().length(64).optional(),
  sourceSizeBytes: z.number().int().nonnegative().optional(),
  reclaimedSizeBytes: z.number().int().nonnegative().optional()
}).strict();

const MAX_DIRECTORIES = 5_000;
const INSPECTION_CONCURRENCY = 4;
const SKIP_DIRECTORIES = WORKTREE_SCAN_SKIP_DIRECTORIES;
const ACTIVE_GIT_MARKERS = [
  "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "BISECT_LOG",
  "rebase-merge", "rebase-apply", "sequencer"
];

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

const readGit = (runner: GitCommandRunner, args: string[], options: GitCommandRunOptions) =>
  runner.run(["-c", "core.fsmonitor=false", ...args], {
    ...options, env: { ...options.env, GIT_OPTIONAL_LOCKS: "0" }
  });

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
  inventory(): Promise<WorktreeInventory>;
  addScanRoot(path: string): Promise<void>;
  removeScanRoot(path: string): Promise<void>;
  setKeep(commonDir: string, path: string, reason?: string): Promise<void>;
  preview(commonDir: string, path: string, allowDirty?: boolean): Promise<WorktreeCleanupPreview>;
  remove(preview: WorktreeCleanupPreview): Promise<WorktreeRecoveryRecord>;
  listRecovery(): Promise<WorktreeRecoveryInventory>;
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
  const issuedPreviews = new Map<string, {
    commonDir: string; path: string; fingerprint: string; forceRequired: boolean; issuedAt: number;
  }>();
  const discovered = new Set<string>();
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
    measure = true
  ): Promise<WorktreeEntry> => {
    const path = resolve(registration.path);
    const reasons: string[] = [];
    const changes: string[] = [];
    const ignored: string[] = [];
    let submodules = false;
    let unsafeLocalState = false;
    let headNeedsProtection = false;
    let measurement: Awaited<ReturnType<typeof measureWorktreeTree>>;
    let exists = false;
    try {
      exists = (await lstat(path)).isDirectory();
    } catch (error) {
      if (!isMissingFileError(error)) reasons.push(`Could not inspect path: ${String(error)}`);
    }
    const main = path === resolve(mainPath);
    if (main) reasons.push("Main working tree");
    if (registration.locked) reasons.push(`Git lock: ${registration.locked}`);
    if (registration.prunable) reasons.push(`Git registration: ${registration.prunable}`);
    if (!exists) reasons.push("Directory is unavailable");
    if (exists && !main) {
      try {
        const status = await readGit(runner,
          ["status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=all"],
          { cwd: path, env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: 12_000, maxOutputBytes: 4_000_000, signal }
        );
        for (const record of status.stdout.split("\0").filter(Boolean)) {
          if (record.startsWith("!! ")) ignored.push(record.slice(3));
          else changes.push(record);
        }
        if (changes.length) reasons.push(`${changes.length} changed or untracked paths`);
        if (ignored.length) reasons.push(`${ignored.length} ignored paths`);
        // Gitlinks protect initialized and missing submodules without launching git-submodule.
        const modules = await readGit(runner, ["ls-files", "--stage", "-z"], {
          cwd: path, timeoutMs: 8_000, maxOutputBytes: 4_000_000, signal
        });
        submodules = modules.stdout.split("\0").some((record) => record.startsWith("160000 "));
        if (submodules) reasons.push("Contains submodules");
        const gitDirResult = await readGit(runner, ["rev-parse", "--git-dir"], {
          cwd: path, timeoutMs: 8_000, maxOutputBytes: 32_000, signal
        });
        const gitDir = resolve(path, gitDirResult.stdout.trim());
        if ((await Promise.all(ACTIVE_GIT_MARKERS.map((marker) => pathExists(join(gitDir, marker))))).some(Boolean)) {
          reasons.push("Git operation in progress");
          unsafeLocalState = true;
        }
        if (await hasNestedRepository(path, signal)) {
          reasons.push("Contains a nested repository");
          unsafeLocalState = true;
        }
        if (measure) measurement = await measureWorktreeTree(path, signal);
        const unique = await readGit(runner, ["for-each-ref", "--format=%(refname)", "--contains", registration.head ?? "HEAD"], {
          cwd: path, timeoutMs: 8_000, maxOutputBytes: 1_000_000, signal
        });
        const containing = unique.stdout.trim().split("\n").filter(Boolean);
        if (registration.detached && !containing.length) {
          reasons.push("Detached commit has no branch or tag reference");
          headNeedsProtection = true;
        } else if (!registration.detached && registration.branch &&
                   !containing.some((ref) => ref !== `refs/heads/${registration.branch}`)) {
          reasons.push("Branch tip is not reachable from another ref; confirm the task is finished");
        }
      } catch (error) {
        signal?.throwIfAborted();
        reasons.push(`Git check failed: ${repositoryDiscoveryIssue(path, error)}`);
      }
    }
    const state = keptReason || registration.locked ? "kept"
      : main || !exists || registration.prunable || reasons.some((reason) => reason.startsWith("Git check failed") || reason.startsWith("Could not inspect")) ? "unavailable"
      : reasons.length ? "review" : "candidate";
    const manualReviewAvailable = !main && exists && !registration.locked && !registration.prunable &&
      !submodules && !unsafeLocalState && Boolean(registration.head) &&
      !reasons.some((reason) => reason.startsWith("Git check failed") || reason.startsWith("Could not inspect"));
    const cleanupReviewAvailable = manualReviewAvailable && !headNeedsProtection &&
      !changes.length && !ignored.length && !submodules && Boolean(registration.head) &&
      reasons.every((reason) => reason === "Branch tip is not reachable from another ref; confirm the task is finished");
    return {
      path, repositoryPath: resolve(mainPath), commonDir, head: registration.head,
      branch: registration.branch, main, detached: registration.detached,
      locked: registration.locked, prunable: registration.prunable, exists,
      state, reasons, changes, ignored, submodules,
      sizeBytes: measurement?.sizeBytes, modifiedAt: measurement?.modifiedAt,
      keptReason, cleanupReviewAvailable,
      manualReviewAvailable, headNeedsProtection
    };
  };

  const findEntry = async (commonDir: string, path: string) => {
    if (!isAbsolute(commonDir) || !isAbsolute(path)) throw new Error("Worktree path must be absolute");
    const runner = await git();
    const entries = await readRegistration(runner, commonDir);
    const target = entries.find((entry) => resolve(entry.path) === resolve(path));
    if (!target) throw new Error("This worktree is no longer registered. Refresh the inventory.");
    const settings = await readSettings();
    return inspect(runner, commonDir, target, entries[0].path,
      settings.kept[keepKey(commonDir, resolve(path))], undefined, false);
  };

  return {
    readAnalysis: async (commonDir, path) => {
      if (!discovered.has(discoveredKey(commonDir, path))) throw new Error("Refresh Worktrees before analyzing this directory.");
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
      if (!discovered.has(discoveredKey(commonDir, path))) throw new Error("Refresh Worktrees before changing a keep decision");
      const entry = await findEntry(commonDir, path);
      if (entry.main) throw new Error("The main working tree cannot be marked for cleanup");
      const current = await readSettings();
      const kept = { ...current.kept };
      const key = keepKey(entry.commonDir, entry.path);
      if (reason?.trim()) kept[key] = reason.trim().slice(0, 200);
      else delete kept[key];
      await saveSettings({ ...current, kept });
    },
    inventory: async () => {
      scanController?.abort(new WorktreeScanCancelledError());
      const controller = new AbortController();
      scanController = controller;
      discovered.clear();
      try {
        const settings = await readSettings();
        controller.signal.throwIfAborted();
        const projects = await projectStore.listLocalRootPaths();
        controller.signal.throwIfAborted();
        const issues: string[] = [];
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
        const queues = scanRoots.map((path) => [path]);
        for (const [index, root] of scanRoots.entries()) {
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
        let nextInspection = 0;
        const completed = await Promise.allSettled(Array.from(
          { length: Math.min(INSPECTION_CONCURRENCY, inspections.length) }, async () => {
            while (nextInspection < inspections.length) {
              controller.signal.throwIfAborted();
              const index = nextInspection++;
              const { commonDir, registration, mainPath } = inspections[index];
              const entry = await inspect(runner, commonDir, registration, mainPath,
                settings.kept[keepKey(commonDir, resolve(registration.path))], controller.signal);
              entries[index] = entry;
              found.add(discoveredKey(commonDir, entry.path));
            }
          }
        ));
        for (const result of completed) if (result.status === "rejected") throw result.reason;
        controller.signal.throwIfAborted();
        discovered.clear();
        for (const key of found) discovered.add(key);
        return {
          scanRoots, configuredRoots, builtinRoots: [...new Set(builtinRoots)], entries, issues,
          incomplete: issues.length > 0,
          scannedAt: new Date().toISOString()
        };
      } catch (error) {
        controller.signal.throwIfAborted();
        throw error;
      } finally {
        if (scanController === controller) scanController = undefined;
      }
    },
    cancelScan: () => scanController?.abort(new WorktreeScanCancelledError()),
    preview: async (commonDir, path, allowDirty = false) => {
      if (!discovered.has(discoveredKey(commonDir, path))) throw new Error("Refresh Worktrees before cleanup");
      const entry = await findEntry(commonDir, path);
      if (isWithin(entry.path, recoveryRoot) || isWithin(entry.path, process.cwd())) {
        throw new Error("This worktree contains AgentEnv recovery data or the running application");
      }
      const forceRequired = Boolean(entry.changes.length || entry.ignored.length || entry.headNeedsProtection);
      if ((!entry.cleanupReviewAvailable && !(allowDirty && entry.manualReviewAvailable)) ||
          (forceRequired && !allowDirty) || entry.keptReason || !entry.head) {
        throw new Error(`Review this worktree before cleanup: ${entry.reasons.join("; ") || entry.state}`);
      }
      const fingerprint = await fingerprintWorktreeTree(entry.path);
      entry.sizeBytes = fingerprint.sizeBytes;
      entry.modifiedAt = fingerprint.modifiedAt;
      const contentHash = fingerprint.hash;
      const savedRoots = await projectStore.listLocalRootPaths();
      const savedWorkspace = (await Promise.all(savedRoots.map(async (root) => {
        const canonical = await realpath(root).catch((error) => {
          if (isMissingFileError(error)) return resolve(root);
          throw error;
        });
        return isWithin(entry.path, canonical);
      }))).some(Boolean);
      const previewId = randomUUID();
      issuedPreviews.set(previewId, {
        commonDir, path, fingerprint: contentHash,
        forceRequired: Boolean(entry.changes.length || entry.ignored.length), issuedAt: Date.now()
      });
      return {
        previewId, entry, fingerprint: contentHash, checkedAt: new Date().toISOString(),
        backupRequired: Boolean(entry.changes.length || entry.ignored.length),
        forceRequired: Boolean(entry.changes.length || entry.ignored.length),
        savedWorkspace
      };
    },
    remove: async (preview) => {
      const issued = issuedPreviews.get(preview.previewId);
      issuedPreviews.delete(preview.previewId);
      if (!issued || issued.commonDir !== preview.entry.commonDir || issued.path !== preview.entry.path ||
          issued.fingerprint !== preview.fingerprint || issued.forceRequired !== preview.forceRequired ||
          preview.backupRequired !== issued.forceRequired ||
          Date.now() - issued.issuedAt > 10 * 60_000) {
        throw new Error("Cleanup review expired. Review this worktree again.");
      }
      const fresh = await findEntry(preview.entry.commonDir, preview.entry.path);
      if ((!fresh.cleanupReviewAvailable && !(preview.forceRequired || preview.entry.headNeedsProtection && fresh.manualReviewAvailable)) ||
          !fresh.manualReviewAvailable || fresh.keptReason ||
          Boolean(fresh.changes.length || fresh.ignored.length) !== preview.forceRequired ||
          fresh.headNeedsProtection !== preview.entry.headNeedsProtection ||
          fresh.head !== preview.entry.head ||
          fresh.branch !== preview.entry.branch || fresh.repositoryPath !== preview.entry.repositoryPath) {
        throw new Error("Worktree changed after review. Refresh and review it again.");
      }
      const fingerprint = await fingerprintWorktreeTree(fresh.path);
      if (fingerprint.hash !== preview.fingerprint) {
        throw new Error("Worktree changed after review. Refresh and review it again.");
      }
      const record: WorktreeRecoveryRecord = {
        id: randomUUID(), path: fresh.path, repositoryPath: fresh.repositoryPath,
        head: fresh.head!, branch: fresh.branch, createdAt: new Date().toISOString(),
        status: "prepared", sourceHash: preview.fingerprint, sourceSizeBytes: fingerprint.sizeBytes
      };
      const backup = backupPath(record.id);
      const runner = await git();
      if (issued.forceRequired) {
        await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
        const backupHash = await copyWorktreeVerified(fresh.path, backup);
        if (backupHash !== preview.fingerprint) throw new Error("Worktree changed while backup was created");
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
      }
      record.protectedRef = `refs/agentenv/worktree-recovery/${record.id}`;
      await runner.run(["update-ref", record.protectedRef, record.head], {
        cwd: fresh.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 100_000
      });
      await saveRecovery(record);
      if (await hashWorktreeTree(fresh.path) !== preview.fingerprint) {
        throw new Error("Worktree changed after backup. Refresh and review it again.");
      }
      try {
        await runner.run(["-c", "core.fsmonitor=false", "worktree", "remove", ...(preview.forceRequired ? ["--force"] : []), "--", fresh.path], {
          cwd: fresh.repositoryPath, timeoutMs: 60_000, maxOutputBytes: 1_000_000
        });
      } catch (error) {
        const [registered, stillExists, sameContent] = await Promise.all([
          readRegistration(runner, fresh.commonDir)
            .then((items) => items.some((item) => resolve(item.path) === fresh.path), () => false),
          lstat(fresh.path).then(() => true, () => false),
          hashWorktreeTree(fresh.path).then((hash) => hash === preview.fingerprint, () => false)
        ]);
        if (registered && stillExists && sameContent) {
          await saveRecovery({ ...record, status: "unchanged" });
          await rm(join(recoveryRoot, record.id), { recursive: true, force: true });
          if (record.protectedRef) {
            await runner.run(["update-ref", "-d", record.protectedRef, record.head], {
              cwd: fresh.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 100_000
            });
          }
          throw new Error(`Git could not remove this worktree; the original directory is unchanged. ${error instanceof Error ? error.message : String(error)}`);
        }
        throw new Error(`Worktree removal needs recovery. Open Worktree recovery before retrying. ${error instanceof Error ? error.message : String(error)}`);
      }
      const remaining = await readRegistration(runner, fresh.commonDir);
      if (remaining.some((item) => resolve(item.path) === fresh.path) ||
          await lstat(fresh.path).then(() => true, (error) => !isMissingFileError(error))) {
        throw new Error("Worktree removal needs recovery: verify the directory and Git registration");
      }
      const completed = { ...record, status: "removed" as const, reclaimedSizeBytes: record.backupHash ? 0 : record.sourceSizeBytes };
      await saveRecovery(completed);
      return completed;
    },
    listRecovery: async () => {
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
                         await hashWorktreeTree(record.path) === record.sourceHash) {
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
          records: records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
          issues
        };
      } catch (error) {
        if (isMissingFileError(error)) return { records: [], issues: [] };
        throw error;
      }
    },
    restore: async (id) => {
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
      const runner = await git();
      const registration = await readRegistration(runner, record.repositoryPath);
      const isRegistered = registration.some((item) => resolve(item.path) === record.path);
      const exists = await pathExists(record.path);
      if (exists || isRegistered) {
        if (record.status !== "restoring" || !record.restoreAttemptHash || !exists || !isRegistered ||
            await hashWorktreeTree(record.path) !== record.restoreAttemptHash) {
          throw new Error("The recovery path contains unverified files or Git registration. Nothing was overwritten; inspect it before retrying.");
        }
        const currentHead = await runner.run(["rev-parse", "HEAD"], {
          cwd: record.path, timeoutMs: 8_000, maxOutputBytes: 100_000
        });
        if (currentHead.stdout.trim() !== record.head) {
          throw new Error("The recovery worktree changed commit. Nothing was overwritten; inspect it before retrying.");
        }
      } else {
        record = { ...record, status: "restoring", restoreAttemptHash: undefined };
        await saveRecovery(record);
        try {
          let useBranch = false;
          if (record.branch) {
            const currentBranch = await runner.run(["rev-parse", "--verify", `refs/heads/${record.branch}`], {
              cwd: record.repositoryPath, timeoutMs: 8_000, maxOutputBytes: 100_000
            }).then((result) => result.stdout.trim(), () => undefined);
            useBranch = currentBranch === record.head;
          }
          await runner.run(["worktree", "add", ...(useBranch ? [] : ["--detach"]),
            record.path, useBranch ? record.branch! : record.head], {
            cwd: record.repositoryPath, timeoutMs: 60_000, maxOutputBytes: 1_000_000
          });
          record = { ...record, restoreAttemptHash: await hashWorktreeTree(record.path) };
          await saveRecovery(record);
        } catch (error) {
          if (await pathExists(record.path)) {
            const current = await readRegistration(runner, record.repositoryPath);
            if (current.some((item) => resolve(item.path) === record.path)) {
              record = { ...record, restoreAttemptHash: await hashWorktreeTree(record.path) };
              await saveRecovery(record);
            }
          }
          throw error;
        }
      }
      try {
        if (record.backupHash) {
          for (const file of await readdir(backup)) {
            if (file === ".git") continue;
            await cp(join(backup, file), join(record.path, file), {
              recursive: true, force: true, dereference: false, verbatimSymlinks: true,
              preserveTimestamps: true
            });
          }
        }
        if (record.indexHash) {
          const gitDirOutput = await runner.run(["rev-parse", "--git-dir"], {
            cwd: record.path, timeoutMs: 8_000, maxOutputBytes: 32_000
          });
          await cp(join(recoveryRoot, id, "index"), resolve(record.path, gitDirOutput.stdout.trim(), "index"));
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
      } catch (error) {
        record = { ...record, restoreAttemptHash: await hashWorktreeTree(record.path) };
        await saveRecovery(record);
        throw error;
      }
      const restored = { ...record, status: "restored" as const, restoreAttemptHash: undefined };
      await saveRecovery(restored);
      return restored;
    }
  };
};
