import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { ManagedBackupFile, ManagedBackupItem, ManagedBackupPreview } from "../../shared/types";
import { isMissingFileError } from "../fileUtils";

const RecoveryId = z.string().uuid();
// This is a read-only projection, not the transaction owner's strict write schema.
const RecoveryRecord = z.object({
  id: RecoveryId,
  path: z.string().refine(isAbsolute),
  repositoryPath: z.string().refine(isAbsolute),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  status: z.enum(["prepared", "removed", "restoring", "restored", "unchanged"]),
  backupHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  indexHash: z.string().regex(/^[a-f0-9]{64}$/).optional()
});
const MAX_SCANNED_ENTRIES = 100_000;
const MAX_PREVIEW_ENTRIES = 1_000;
const MAX_JOURNAL_BYTES = 1024 * 1024;
const INVENTORY_BUDGET_MS = 2_000;
const PREVIEW_BUDGET_MS = 2_000;

interface ReadOptions {
  now?: () => number;
}

interface TraversalBudget {
  now: () => number;
  deadline: number;
}

const recoveryRoot = (appDataRoot: string) => join(appDataRoot, "worktree-recovery");
const info = async (path: string) => lstat(path).catch((error) => {
  if (isMissingFileError(error)) return undefined;
  throw error;
});

const inspectRoot = async (appDataRoot: string) => {
  const root = recoveryRoot(appDataRoot);
  const stats = await info(root);
  if (stats && (!stats.isDirectory() || stats.isSymbolicLink())) {
    throw new Error("Worktree recovery storage is not a regular directory; nothing was changed");
  }
  return stats ? root : undefined;
};

const readRecord = async (path: string, id: string) => {
  const stats = await info(path);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.size > MAX_JOURNAL_BYTES) {
    throw new Error("Unavailable recovery record");
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const current = await file.stat();
    if (!current.isFile() || current.size > MAX_JOURNAL_BYTES) throw new Error("Invalid recovery record");
    const buffer = Buffer.alloc(Math.min(current.size + 1, MAX_JOURNAL_BYTES + 1));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_JOURNAL_BYTES) throw new Error("Invalid recovery record");
    const record = RecoveryRecord.parse(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
    if (record.id !== id) throw new Error("Recovery identity mismatch");
    return record;
  } finally {
    await file.close();
  }
};

const inspectBackup = async (root: string, id: string, preview: boolean, budget: TraversalBudget) => {
  const journal = join(root, `${id}.json`);
  const storage = join(root, id);
  const record = await readRecord(journal, id).catch(() => undefined);
  let incomplete = !record || record.status === "prepared" || record.status === "restoring";
  let sizeIncomplete = false;
  let sizeBytes = 0;
  let fileCount = 0;
  let scanned = 0;
  let storageIsDirectory = false;
  let fallbackTime = new Date(0).toISOString();
  const files: ManagedBackupFile[] = [];
  const append = (path: string, kind: "file" | "directory") => {
    fileCount++;
    if (preview && files.length < MAX_PREVIEW_ENTRIES) files.push({ path, kind, state: "saved" });
  };
  const walk = async (path: string): Promise<void> => {
    if (budget.now() >= budget.deadline || ++scanned > MAX_SCANNED_ENTRIES) {
      sizeIncomplete = true;
      return;
    }
    try {
      const stats = await info(path);
      if (!stats) { sizeIncomplete = true; return; }
      if (fallbackTime === new Date(0).toISOString()) fallbackTime = stats.mtime.toISOString();
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        sizeBytes += stats.size;
        append(path, "file");
        return;
      }
      let empty = true;
      const directory = await opendir(path);
      for await (const entry of directory) {
        empty = false;
        if (budget.now() >= budget.deadline || scanned >= MAX_SCANNED_ENTRIES) { sizeIncomplete = true; break; }
        await walk(join(path, entry.name));
      }
      if (empty) append(path, "directory");
    } catch {
      sizeIncomplete = true;
    }
  };

  for (const path of [journal, storage]) {
    try {
      const stats = await info(path);
      if (stats) {
        if (path === storage) {
          storageIsDirectory = stats.isDirectory() && !stats.isSymbolicLink();
          if (!storageIsDirectory) incomplete = true;
        }
        await walk(path);
      }
    } catch { sizeIncomplete = true; }
  }
  for (const [required, path, directory] of [
    [record?.backupHash, join(storage, "files"), true],
    [record?.indexHash, join(storage, "index"), false]
  ] as const) {
    // Safe no-op removal discards redundant payloads but retains their recorded hashes.
    if (!required || record?.status === "unchanged") continue;
    if (!storageIsDirectory) { incomplete = true; continue; }
    try {
      const stats = await info(path);
      if (!stats || stats.isSymbolicLink() || (directory ? !stats.isDirectory() : !stats.isFile())) incomplete = true;
    } catch { incomplete = true; }
  }
  const item: ManagedBackupItem = {
    id, kind: "worktree-recovery", createdAt: record?.createdAt ?? fallbackTime,
    sizeBytes, sizeIncomplete, fileCount,
    worktreePath: record?.path,
    restored: record?.status === "restored",
    cleanupStatus: "required",
    requiredReason: incomplete ? "worktree-recovery-incomplete" : "worktree-recovery",
    deletable: false
  };
  return {
    item,
    preview: {
      id, kind: "worktree-recovery", files,
      truncated: fileCount > files.length || sizeIncomplete,
      sizeIncomplete
    } satisfies ManagedBackupPreview
  };
};

export const listWorktreeRecoveryBackups = async (appDataRoot: string, options: ReadOptions = {}): Promise<ManagedBackupItem[]> => {
  const now = options.now ?? (() => performance.now());
  const budget = { now, deadline: now() + INVENTORY_BUDGET_MS };
  const root = await inspectRoot(appDataRoot);
  if (!root) return [];
  const ids = new Set<string>();
  const directory = await opendir(root);
  for await (const entry of directory) {
    const id = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : entry.name;
    if (RecoveryId.safeParse(id).success) ids.add(id);
  }
  const items: ManagedBackupItem[] = [];
  // Sequential inspection avoids a stat storm for full worktree copies.
  for (const id of ids) items.push((await inspectBackup(root, id, false, budget)).item);
  return items;
};

export const previewWorktreeRecoveryBackup = async (appDataRoot: string, id: string, options: ReadOptions = {}): Promise<ManagedBackupPreview> => {
  const now = options.now ?? (() => performance.now());
  const budget = { now, deadline: now() + PREVIEW_BUDGET_MS };
  RecoveryId.parse(id);
  const root = await inspectRoot(appDataRoot);
  if (!root || !(await info(join(root, `${id}.json`)) || await info(join(root, id)))) {
    throw new Error(`Backup does not exist: ${id}`);
  }
  return (await inspectBackup(root, id, true, budget)).preview;
};
