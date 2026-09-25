import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
import type { GitCommandRunner } from "../skillSources/gitCommandRunner";
import { copyWorktreeVerified, hashWorktreeTree, measureWorktreeTree } from "./worktreeSnapshot";

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
  status: z.enum(["prepared", "removed", "restored", "unchanged"]),
  protectedRef: z.string().optional(),
  backupHash: z.string().length(64).optional(),
  indexHash: z.string().length(64).optional()
}).strict();

const MAX_DIRECTORIES = 5_000;
const MAX_DEPTH = 7;
const SKIP_DIRECTORIES = new Set([
  ".git", ".cache", ".config", ".venv", "node_modules", "vendor", "dist", "build", "target"
]);
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
}

export const createWorktreeService = ({
  appDataRoot,
  projectStore,
  resolveRunner
}: {
  appDataRoot: string;
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
    const raw = await runner.run(["worktree", "list", "--porcelain", "-z"], {
      cwd: commonDir, timeoutMs: 8_000, maxOutputBytes: 2_000_000, signal
    });
    return parseWorktreeList(raw.stdout);
  };
  const inspect = async (
    runner: GitCommandRunner,
    commonDir: string,
    registration: GitWorktree,
    mainPath: string,
    keptReason?: string,
    signal?: AbortSignal
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
        const status = await runner.run(
          ["status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=all"],
          { cwd: path, timeoutMs: 12_000, maxOutputBytes: 4_000_000, signal }
        );
        for (const record of status.stdout.split("\0").filter(Boolean)) {
          if (record.startsWith("!! ")) ignored.push(record.slice(3));
          else changes.push(record);
        }
        if (changes.length) reasons.push(`${changes.length} changed or untracked paths`);
        if (ignored.length) reasons.push(`${ignored.length} ignored paths`);
        const modules = await runner.run(["submodule", "status", "--recursive"], {
          cwd: path, timeoutMs: 12_000, maxOutputBytes: 1_000_000, signal
        });
        submodules = Boolean(modules.stdout.trim());
        if (submodules) reasons.push("Contains submodules");
        const gitDirResult = await runner.run(["rev-parse", "--git-dir"], {
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
        measurement = await measureWorktreeTree(path, signal);
        const unique = await runner.run(["for-each-ref", "--format=%(refname)", "--contains", registration.head ?? "HEAD"], {
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
        reasons.push(`Git check failed: ${error instanceof Error ? error.message : String(error)}`);
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
      settings.kept[keepKey(commonDir, resolve(path))]);
  };

  return {
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
      await saveSettings({ ...current, scanRoots: current.scanRoots.filter((root) => root !== path) });
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
      scanController?.abort();
      const controller = new AbortController();
      scanController = controller;
      discovered.clear();
      const settings = await readSettings();
      const projects = await projectStore.listLocalRootPaths();
      const scanRoots = [...new Set([
        ...settings.scanRoots,
        ...projects
      ])];
      const issues: string[] = [];
      const entries: WorktreeEntry[] = [];
      const found = new Set<string>();
      const visited = new Set<string>();
      const repositories = new Set<string>();
      let count = 0;
      const runner = await git();
      for (const root of scanRoots) {
        const queue = [{ path: root, depth: 0 }];
        try {
          const repository = await runner.run(["rev-parse", "--show-toplevel"], {
            cwd: root, timeoutMs: 5_000, maxOutputBytes: 32_000, signal: controller.signal
          });
          const rootPath = repository.stdout.trim();
          if (rootPath && resolve(rootPath) !== resolve(root)) {
            queue.unshift({ path: rootPath, depth: 0 });
          }
        } catch {
          // A scan location can contain repositories without being one itself.
        }
        while (queue.length) {
          if (controller.signal.aborted) throw new Error("Worktree scan cancelled");
          if (++count > MAX_DIRECTORIES) {
            issues.push("Scan reached the directory limit. Add a narrower location to see more worktrees.");
            break;
          }
          const current = queue.shift()!;
          let canonical: string;
          try {
            canonical = await realpath(current.path);
            if (isWithin(resolve(appDataRoot), canonical)) continue;
            if (visited.has(canonical)) continue;
            visited.add(canonical);
            const directory = await readdir(canonical, { withFileTypes: true });
            if (directory.some((entry) => entry.name === ".git")) {
              const result = await runner.run(["rev-parse", "--git-common-dir"], {
                cwd: canonical, timeoutMs: 8_000, maxOutputBytes: 32_000, signal: controller.signal
              });
              const commonDir = resolve(canonical, result.stdout.trim());
              if (!repositories.has(commonDir)) {
                repositories.add(commonDir);
                const registered = await readRegistration(runner, commonDir, controller.signal);
                for (const registration of registered) {
                  controller.signal.throwIfAborted();
                  const entry = await inspect(runner, commonDir, registration, registered[0].path,
                    settings.kept[keepKey(commonDir, resolve(registration.path))], controller.signal);
                  entries.push(entry);
                  found.add(discoveredKey(commonDir, entry.path));
                }
              }
            }
            if (current.depth >= MAX_DEPTH) continue;
            for (const child of directory) {
              if (child.isDirectory() && !SKIP_DIRECTORIES.has(child.name)) {
                queue.push({ path: join(canonical, child.name), depth: current.depth + 1 });
              }
            }
          } catch (error) {
            if (controller.signal.aborted) throw new Error("Worktree scan cancelled");
            issues.push(`${current.path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      if (scanController === controller) scanController = undefined;
      discovered.clear();
      for (const key of found) discovered.add(key);
      return {
        scanRoots, configuredRoots: settings.scanRoots, entries, issues, incomplete: issues.length > 0,
        scannedAt: new Date().toISOString()
      };
    },
    cancelScan: () => scanController?.abort(),
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
      const contentHash = await hashWorktreeTree(entry.path);
      const previewId = randomUUID();
      issuedPreviews.set(previewId, {
        commonDir, path, fingerprint: contentHash,
        forceRequired: Boolean(entry.changes.length || entry.ignored.length), issuedAt: Date.now()
      });
      return {
        previewId, entry, fingerprint: contentHash, checkedAt: new Date().toISOString(),
        backupRequired: Boolean(entry.changes.length || entry.ignored.length),
        forceRequired: Boolean(entry.changes.length || entry.ignored.length)
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
          fresh.branch !== preview.entry.branch || fresh.repositoryPath !== preview.entry.repositoryPath ||
          await hashWorktreeTree(fresh.path) !== preview.fingerprint) {
        throw new Error("Worktree changed after review. Refresh and review it again.");
      }
      const record: WorktreeRecoveryRecord = {
        id: randomUUID(), path: fresh.path, repositoryPath: fresh.repositoryPath,
        head: fresh.head!, branch: fresh.branch, createdAt: new Date().toISOString(),
        status: "prepared"
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
        await runner.run(["worktree", "remove", ...(preview.forceRequired ? ["--force"] : []), "--", fresh.path], {
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
      const completed = { ...record, status: "removed" as const };
      await saveRecovery(completed);
      return completed;
    },
    listRecovery: async () => {
      try {
        const files = (await readdir(recoveryRoot)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name));
        const results = await Promise.allSettled(files.map((name) => readRecovery(name.slice(0, -5))));
        return {
          records: results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
          issues: results.flatMap((result, index) => result.status === "rejected"
            ? [`${files[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
            : [])
        };
      } catch (error) {
        if (isMissingFileError(error)) return { records: [], issues: [] };
        throw error;
      }
    },
    restore: async (id) => {
      const record = await readRecovery(id);
      if (record.status === "restored") return record;
      if (record.status === "unchanged") throw new Error("This worktree was not removed; the original directory is still present");
      if (await lstat(record.path).then(() => true, (error) => !isMissingFileError(error))) {
        throw new Error("The original path is occupied. Recovery will not overwrite it.");
      }
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
      if (registration.some((item) => resolve(item.path) === record.path)) {
        throw new Error("Git still registers this worktree. Inspect it before recovery.");
      }
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
      const restored = { ...record, status: "restored" as const };
      await saveRecovery(restored);
      return restored;
    }
  };
};
