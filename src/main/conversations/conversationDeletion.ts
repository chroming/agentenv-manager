import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { BackupManifest } from "../../shared/types";
import type { ConversationDeletionMetadata, ConversationDeletionPhase } from "../../shared/conversationDeletion";
import type { BackupStore } from "../backupStore";
import { hashPathEntry, syncPathTree } from "../filesystemIntegrity";
import { pathEntryExists, writeAtomic } from "../fileUtils";
import { readFile } from "node:fs/promises";

const within = (root: string, path: string) => {
  const suffix = relative(resolve(root), resolve(path));
  return Boolean(suffix) && !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../") && !suffix.startsWith("..\\");
};

const phaseSchema = z.enum(["prepared", "deleting", "deleted", "restoring", "restored"]);
export const inspectConversationFiles = async (files: string[], roots: string[], now = Date.now()) => {
  let sizeBytes = 0;
  const hashes: Record<string, string> = {};
  for (const path of files) {
    await assertConversationPath(path, roots);
    const info = await lstat(path);
    if (now - info.mtimeMs < 60_000) throw new Error("This conversation was recently written. Close its Agent session and retry after one minute.");
    const hash = await hashPathEntry(path);
    if (!hash) throw new Error(`Conversation file disappeared: ${path}`);
    hashes[path] = hash;
    sizeBytes += info.size;
  }
  return { hashes, sizeBytes };
};
const journalPath = (backupsDir: string, id: string) => join(backupsDir, id, "conversation-state.json");

export const readConversationDeletionPhase = async (backupsDir: string, id: string): Promise<ConversationDeletionPhase> => {
  const path = journalPath(backupsDir, id);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Invalid conversation recovery journal");
  return phaseSchema.parse(JSON.parse(await readFile(path, "utf8")).phase);
};

export const writeConversationDeletionPhase = (backupsDir: string, id: string, phase: ConversationDeletionPhase) =>
  writeAtomic(journalPath(backupsDir, id), JSON.stringify({ version: 1, phase }));

// Use only adapter-owned roots; never follow a symlink into another history or project.
export const assertConversationPath = async (path: string, roots: string[], missing = false) => {
  const root = roots.find((item) => within(item, path));
  if (!root || !isAbsolute(path)) throw new Error(`Conversation path leaves its history root: ${path}`);
  const actualRoot = await realpath(root);
  if (actualRoot !== resolve(root)) throw new Error(`History root is a symbolic link: ${root}`);
  let parent = dirname(path);
  while (!(await pathEntryExists(parent))) parent = dirname(parent);
  if (await realpath(parent) !== resolve(parent)) throw new Error(`History directory is a symbolic link: ${parent}`);
  if (missing && !(await pathEntryExists(path))) return;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error(`Conversation deletion requires a regular, unshared file: ${path}`);
};

const metadataSchema = z.object({ conversationId: z.string(), title: z.string(), agentId: z.string().regex(/^[a-z0-9-]+$/), sourceKey: z.string(), workspacePath: z.string().optional(), roots: z.array(z.string()).min(1) });
export const validateConversationBackup = (backup: BackupManifest) => {
  if (backup.operation !== "conversation-delete") throw new Error("This is not a deleted conversation");
  const metadata = metadataSchema.parse(backup.conversation);
  if (!backup.entries.length || backup.entries.some((entry) => entry.kind !== "file" || entry.missing || !entry.backupPath || !entry.sha256 || !metadata.roots.some((root) => within(root, entry.sourcePath)))) {
    throw new Error("Invalid conversation backup file set");
  }
  return metadata;
};

const restoreFile = async (entry: BackupManifest["entries"][number]) => {
  await mkdir(dirname(entry.sourcePath), { recursive: true, mode: 0o700 });
  await copyFile(entry.backupPath!, entry.sourcePath, constants.COPYFILE_EXCL);
  if (entry.mode !== undefined) await chmod(entry.sourcePath, entry.mode);
  if (await hashPathEntry(entry.sourcePath) !== entry.sha256) throw new Error("Restored content could not be verified. The recovery copy is preserved.");
  await syncPathTree(entry.sourcePath, process.platform);
};

export const createConversationDeletion = (store: BackupStore, backupsDir: string, options: { removeFile?: typeof unlink } = {}) => ({
  async remove(metadata: ConversationDeletionMetadata, hashes: Record<string, string>, onRemoved?: () => void) {
    const files = Object.keys(hashes);
    const backup = await store.createBackup(files, { operation: "conversation-delete", conversation: metadata, targetId: metadata.agentId });
    await writeConversationDeletionPhase(backupsDir, backup.id, "prepared");
    validateConversationBackup(backup);
    for (const entry of backup.entries) if (entry.sha256 !== hashes[entry.sourcePath]) {
      await writeConversationDeletionPhase(backupsDir, backup.id, "restored");
      throw new Error("Conversation changed while preparing its backup. No original files were removed.");
    }
    await writeConversationDeletionPhase(backupsDir, backup.id, "deleting");
    const removed: BackupManifest["entries"] = [];
    try {
      for (const entry of backup.entries) {
        await assertConversationPath(entry.sourcePath, metadata.roots);
        if (await hashPathEntry(entry.sourcePath) !== entry.sha256) throw new Error(`Conversation changed before deletion: ${entry.sourcePath}`);
        await (options.removeFile ?? unlink)(entry.sourcePath);
        removed.push(entry);
      }
      onRemoved?.();
      await writeConversationDeletionPhase(backupsDir, backup.id, "deleted");
      return backup.id;
    } catch (error) {
      try {
        for (const entry of removed) {
          await assertConversationPath(entry.sourcePath, metadata.roots, true);
          await restoreFile(entry);
        }
        await writeConversationDeletionPhase(backupsDir, backup.id, "restored");
      } catch {
        throw new Error(`Deletion stopped and automatic recovery could not finish. Recover the saved files from Recently deleted (${backup.id}). ${error instanceof Error ? error.message : String(error)}`);
      }
      throw new Error(`Deletion stopped; removed files were restored. ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  async restore(id: string) {
    const backup = await store.readBackup(id);
    const metadata = validateConversationBackup(backup);
    const phase = await readConversationDeletionPhase(backupsDir, id).catch(() => "deleting" as const);
    if (phase === "restored") return;
    for (const entry of backup.entries) {
      await assertConversationPath(entry.sourcePath, metadata.roots, true);
      if (await pathEntryExists(entry.sourcePath)) {
        if (phase === "deleted" || await hashPathEntry(entry.sourcePath) !== entry.sha256) throw new Error(`Restore would overwrite an existing file: ${entry.sourcePath}. Move it aside before retrying.`);
      }
    }
    await writeConversationDeletionPhase(backupsDir, id, "restoring");
    for (const entry of backup.entries) {
      await assertConversationPath(entry.sourcePath, metadata.roots, true);
      if (!(await pathEntryExists(entry.sourcePath))) {
        await restoreFile(entry);
      }
      if (await hashPathEntry(entry.sourcePath) !== entry.sha256) throw new Error("Restored content could not be verified. The recovery copy is preserved.");
    }
    await writeConversationDeletionPhase(backupsDir, id, "restored");
  }
});
