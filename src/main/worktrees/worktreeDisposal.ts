import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename } from "node:fs/promises";
import { removePhysicalPath as rm } from "../physicalFileRemoval";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { WorktreeCleanupPreview, WorktreeDisposalMode, WorktreeEntry, WorktreeRecoveryRecord, WorktreeRestoreRegistration } from "../../shared/worktrees";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import { hashFileContent, hashPathEntry, hashRequiredPathEntry } from "../filesystemIntegrity";
import { assertNoWorktreeWriter, findWorktreeWriterLock } from "./worktreeGitState";
import { assertRestoreRegistration, readLinkedRegistrationIdentity } from "./worktreeOperationRecovery";

const missing = async (path: string) => lstat(path).then(() => false, (error) => {
  if (isMissingFileError(error)) return true;
  throw error;
});
const identitySchema = z.object({
  gitDir: z.string(), commonDir: z.string(), adminDevice: z.string(), adminInode: z.string(),
  worktreeDevice: z.string(), worktreeInode: z.string(), linkDevice: z.string(), linkInode: z.string(),
  gitFileHash: z.string(), backlinkHash: z.string(), commonLinkHash: z.string()
}).strict();
const directoryIdentitySchema = z.object({ worktreeDevice: z.string(), worktreeInode: z.string() }).strict();
type DirectoryIdentity = z.infer<typeof directoryIdentitySchema>;
const journalSchema = z.object({
  id: z.string().uuid(), mode: z.enum(["trash", "permanent"]),
  phase: z.enum(["prepared", "moved", "deleting", "removed", "restoring", "restored"]),
  entry: z.object({ path: z.string(), commonDir: z.string(), repositoryPath: z.string(), head: z.string().optional(), branch: z.string().optional(), sizeBytes: z.number().nonnegative().optional() }),
  createdAt: z.string(), storage: z.string(), identity: identitySchema.optional(), directoryIdentity: directoryIdentitySchema.optional(),
  originalHead: z.string().optional(), originalGitFile: z.string().max(4096).optional(), detached: z.boolean().optional(), pendingGitCleanup: z.boolean().optional(), registrationError: z.string().optional(), notes: z.array(z.string()).optional()
}).strict();
type Journal = z.infer<typeof journalSchema>;

export const createWorktreeDisposal = ({ appDataRoot, lookup, branchAvailable, resolveHead }: {
  appDataRoot: string;
  lookup(commonDir: string, path: string): Promise<WorktreeEntry>;
  branchAvailable(commonDir: string, branch: string, head: string): Promise<boolean>;
  resolveHead(path: string): Promise<string>;
}) => {
  const root = join(appDataRoot, "worktree-trash");
  const issued = new Map<string, { entry: WorktreeEntry; identity?: WorktreeRestoreRegistration; directoryIdentity?: DirectoryIdentity; gitWriteInProgress?: boolean; mode: WorktreeDisposalMode; at: number; journalId?: string }>();
  const journalPath = (id: string) => join(root, `${z.string().uuid().parse(id)}.json`);
  const save = async (item: Journal) => writeAtomic(journalPath(item.id), `${JSON.stringify(journalSchema.parse(item), null, 2)}\n`);
  const read = async (id: string): Promise<Journal> => {
    const path = journalPath(id), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error("Unverified Worktree Trash record; nothing was changed");
    const item = journalSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const allowed = [join(root, id, "files"), join(dirname(item.entry.path), ".agentenv-worktree-trash", id, "files")];
    if (item.id !== id || !allowed.includes(item.storage) || resolve(item.entry.path) !== item.entry.path ||
      (!item.identity && !item.directoryIdentity) || item.identity && item.identity.commonDir !== item.entry.commonDir ||
      item.identity && item.directoryIdentity && (item.identity.worktreeDevice !== item.directoryIdentity.worktreeDevice || item.identity.worktreeInode !== item.directoryIdentity.worktreeInode)) throw new Error("Unverified Worktree Trash identity");
    return item;
  };
  const projection = (item: Journal): WorktreeRecoveryRecord => ({
    id: item.id, mode: item.mode, path: item.entry.path, repositoryPath: item.entry.repositoryPath,
    head: item.entry.head ?? "", branch: item.entry.branch, createdAt: item.createdAt,
    status: item.phase === "restored" ? "restored" : item.phase === "restoring" ? "restoring" : item.phase === "prepared" ? "prepared" : "removed",
    sourceSizeBytes: item.entry.sizeBytes, reclaimedSizeBytes: item.mode === "trash" ? 0 : item.phase === "removed" ? item.entry.sizeBytes : undefined,
    pendingGitCleanup: item.pendingGitCleanup, disposalIncomplete: item.phase === "deleting" || item.phase === "prepared" || item.mode === "permanent" && item.phase === "moved",
    ...(item.mode === "trash" || !["removed", "restored"].includes(item.phase) ? { retainedPath: item.storage } : {}),
    ...(item.pendingGitCleanup ? { verificationWarnings: [`Folder deleted. Git metadata was left unchanged; retrying metadata cleanup is optional. ${item.registrationError ?? ""}`.trim()] } : item.notes?.length ? { verificationWarnings: item.notes } : {})
  });
  const capture = async (entry: WorktreeEntry) => {
    const gitFile = join(entry.path, ".git"), info = await lstat(gitFile);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("This is not a verified linked Worktree directory");
    const text = await readFile(gitFile, "utf8");
    if (!text.startsWith("gitdir: ")) throw new Error("This is not a verified linked Worktree directory");
    return readLinkedRegistrationIdentity(entry.commonDir, entry.path, resolve(entry.path, text.slice(8).trim()));
  };
  const captureDirectory = async (path: string): Promise<DirectoryIdentity> => {
    const info = await lstat(path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error("Worktree directory identity changed; nothing was removed");
    const gitInfo = await lstat(join(path, ".git")).catch(() => undefined);
    if (gitInfo?.isDirectory()) throw new Error("This directory is not a linked Worktree; nothing was removed");
    return { worktreeDevice: String(info.dev), worktreeInode: String(info.ino) };
  };
  const gitPermission = async (entry: WorktreeEntry) => {
    const identity = await capture(entry).catch(() => undefined);
    if (!identity) return { identity, gitWriteInProgress: false };
    try {
      const gitWriteInProgress = Boolean(await findWorktreeWriterLock(identity.gitDir));
      return { identity: gitWriteInProgress ? undefined : identity, gitWriteInProgress };
    } catch { return { identity: undefined, gitWriteInProgress: false }; }
  };
  const preserveGit = (item: Journal, writing = false) => {
    item.directoryIdentity ??= item.identity && { worktreeDevice: item.identity.worktreeDevice, worktreeInode: item.identity.worktreeInode };
    item.identity = undefined; item.originalGitFile = undefined;
    const note = writing ? "Only the folder was changed. Git metadata was left unchanged because Git may still be writing."
      : "Git metadata could not be verified and was left unchanged. Only the selected directory is managed by this cleanup.";
    item.notes = [...new Set([...(item.notes ?? []), note])];
  };
  const prepare = async (entry: WorktreeEntry, mode: WorktreeDisposalMode, journalId?: string): Promise<WorktreeCleanupPreview> => {
    const directoryIdentity = await captureDirectory(entry.path);
    const permission = await gitPermission(entry), previewId = randomUUID();
    issued.set(previewId, { entry, ...permission, directoryIdentity, mode, at: Date.now(), journalId });
    return { mode, previewId, entry, fingerprint: previewId, checkedAt: new Date().toISOString(),
      backupRequired: false, forceRequired: false, savedWorkspace: false, gitWriteInProgress: permission.gitWriteInProgress };
  };
  const retainedEntry = (item: Journal): WorktreeEntry => ({ ...item.entry, path: item.storage,
    sizeBytes: item.phase === "deleting" ? undefined : item.entry.sizeBytes,
    main: false, exists: true, detached: true, state: "review", changes: [], ignored: [], reasons: [],
    submodules: false, manualReviewAvailable: true, cleanupReviewAvailable: false, headNeedsProtection: false });
  const slots = async (entry: WorktreeEntry, id: string) => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const source = await lstat(entry.path), local = await lstat(root);
    if (!local.isDirectory() || local.isSymbolicLink()) throw new Error("Worktree Trash storage is not a regular directory");
    const base = source.dev === local.dev ? root : join(dirname(entry.path), ".agentenv-worktree-trash");
    if (base !== root) {
      try { await mkdir(base, { mode: 0o700 }); await writeAtomic(join(base, "owner.json"), '{"owner":"AgentEnv Worktree Trash"}\n'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const info = await lstat(base);
        if (!info.isDirectory() || info.isSymbolicLink() || await readFile(join(base, "owner.json"), "utf8") !== '{"owner":"AgentEnv Worktree Trash"}\n') throw new Error("The local Trash location is occupied; nothing was changed");
      }
    }
    const slot = join(base, id);
    await mkdir(slot, { mode: 0o700 });
    return join(slot, "files");
  };
  const validateMoved = async (item: Journal) => item.identity ? assertRestoreRegistration(item.identity, item.entry.commonDir, item.storage) : validateStorage(item);
  const retainedPointer = (item: Journal) => `gitdir: ${item.identity!.gitDir}\n`;
  const writePointer = async (path: string, text: string) => {
    if (await readFile(join(path, ".git"), "utf8") !== text) await writeAtomic(join(path, ".git"), text);
  };
  const validateStorage = async (item: Journal) => {
    const info = await lstat(item.storage, { bigint: true });
    const identity = item.directoryIdentity ?? item.identity!;
    if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== identity.worktreeDevice || String(info.ino) !== identity.worktreeInode) {
      throw new Error("Worktree Trash contents changed identity; nothing else was removed");
    }
  };
  const resumeMove = async (item: Journal) => {
    if (item.phase !== "prepared") return;
    await validateStorage(item);
    if (!item.identity) { item.phase = "moved"; await save(item); return; }
    try {
      const admin = await lstat(item.identity.gitDir, { bigint: true });
      const backlink = (await readFile(join(item.identity.gitDir, "gitdir"), "utf8")).trim();
      const pointerHash = await hashRequiredPathEntry(join(item.storage, ".git"));
      if (!admin.isDirectory() || admin.isSymbolicLink() || String(admin.dev) !== item.identity.adminDevice || String(admin.ino) !== item.identity.adminInode ||
          (pointerHash !== item.identity.gitFileHash && (!item.originalGitFile || pointerHash !== hashFileContent(retainedPointer(item)))) ||
          await hashRequiredPathEntry(join(item.identity.gitDir, "commondir")) !== item.identity.commonLinkHash ||
          ![join(item.entry.path, ".git"), join(item.storage, ".git")].includes(resolve(item.identity.gitDir, backlink))) throw new Error("Interrupted Trash move changed; nothing was overwritten");
      await assertNoWorktreeWriter(item.identity.gitDir);
      if (item.originalGitFile && !isAbsolute(item.originalGitFile.slice(8).trim())) await writePointer(item.storage, retainedPointer(item));
      await assertNoWorktreeWriter(item.identity.gitDir);
      await writeAtomic(join(item.identity.gitDir, "gitdir"), `${join(item.storage, ".git")}\n`);
      item.identity = await capture(retainedEntry(item));
    } catch { preserveGit(item); }
    item.phase = "moved"; await save(item);
  };
  const clearRegistration = async (item: Journal) => {
    if (!item.identity) return;
    const admin = item.identity.gitDir;
    if (await missing(admin)) return;
    const info = await lstat(admin, { bigint: true });
    const backlink = await readFile(join(admin, "gitdir"), "utf8").catch((error) => { if (isMissingFileError(error)) return undefined; throw error; });
    const commonHash = await hashPathEntry(join(admin, "commondir"));
    if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== item.identity.adminDevice || String(info.ino) !== item.identity.adminInode ||
      dirname(await realpath(admin)) !== join(await realpath(item.entry.commonDir), "worktrees") ||
      (commonHash === undefined ? !item.pendingGitCleanup : commonHash !== item.identity.commonLinkHash) ||
      (backlink === undefined ? !item.pendingGitCleanup : resolve(admin, backlink.trim()) !== join(item.storage, ".git"))) {
      throw new Error("Git registration identity changed; its files were not removed");
    }
    await assertNoWorktreeWriter(admin);
    await rm(admin, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  const purge = async (item: Journal, progress?: (phase: "preparing" | "removing" | "verifying") => void) => {
    const hasContents = !await missing(item.storage);
    const remainingSize = hasContents ? item.phase === "deleting" ? undefined : item.entry.sizeBytes : 0;
    if (hasContents) {
      await validateStorage(item);
      item.phase = "deleting"; item.mode = "permanent"; await save(item);
      progress?.("removing");
      try {
        for (let attempt = 0; ; attempt++) {
          await validateStorage(item);
          try { await rm(item.storage, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); break; }
          catch (error) {
            if (await missing(item.storage)) break;
            if (attempt >= 2 || !["ENOTEMPTY", "EBUSY", "EPERM"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
            await new Promise((done) => setTimeout(done, 100 * (attempt + 1)));
          }
        }
      }
      catch (error) { throw new Error(`Deletion did not finish. Remaining contents are in Worktree Trash; retry permanent deletion there. ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    }
    progress?.("verifying");
    if (!await missing(item.storage)) throw new Error("Worktree deletion did not finish; retry this item");
    item.phase = "removed"; item.mode = "permanent";
    try { await clearRegistration(item); item.pendingGitCleanup = false; item.registrationError = undefined; }
    catch (error) { item.pendingGitCleanup = true; item.registrationError = error instanceof Error ? error.message : String(error); }
    await save(item);
    return { ...projection(item), sourceSizeBytes: remainingSize, reclaimedSizeBytes: remainingSize };
  };
  const assertTrashDeletionAllowed = (item: Journal) => {
    if (item.phase === "restoring" || item.phase === "restored") throw new Error("This Worktree is being restored or was already restored. Refresh Trash; its files were not deleted.");
    if (item.mode !== "trash" && !item.pendingGitCleanup && !["prepared", "moved", "deleting"].includes(item.phase)) throw new Error("This Worktree is not in Trash");
  };
  return {
    preview: async (commonDir: string, path: string, mode: WorktreeDisposalMode) => prepare(await lookup(commonDir, path), mode),
    previewTrash: async (id: string) => {
      const item = await read(id);
      assertTrashDeletionAllowed(item);
      if (!(await missing(item.storage) && item.pendingGitCleanup)) await validateStorage(item);
      const previewId = randomUUID(), entry = retainedEntry(item);
      issued.set(previewId, { entry, identity: item.identity, mode: "permanent", at: Date.now(), journalId: id });
      const gitWriteInProgress = item.identity ? Boolean(await findWorktreeWriterLock(item.identity.gitDir).catch(() => undefined)) : false;
      return { mode: "permanent" as const, previewId, entry, fingerprint: previewId, checkedAt: new Date().toISOString(), backupRequired: false, forceRequired: false, savedWorkspace: false, gitWriteInProgress };
    },
    remove: async (preview: WorktreeCleanupPreview, progress?: (phase: "preparing" | "removing" | "verifying") => void) => {
      const request = issued.get(preview.previewId); issued.delete(preview.previewId);
      if (!request || request.mode !== preview.mode || Date.now() - request.at > 10 * 60_000) throw new Error("Cleanup review expired. Review this Worktree again.");
      progress?.("preparing");
      if (request.journalId) {
        const item = await read(request.journalId);
        assertTrashDeletionAllowed(item);
        return purge(item, progress);
      }
      const entry = request.entry;
      if (request.directoryIdentity && JSON.stringify(await captureDirectory(entry.path)) !== JSON.stringify(request.directoryIdentity)) throw new Error("Worktree directory identity changed; nothing was removed");
      const current = await gitPermission(entry);
      if (!current.identity || JSON.stringify(current.identity) !== JSON.stringify(request.identity)) request.identity = undefined;
      let originalGitFile = request.identity ? await readFile(join(entry.path, ".git"), "utf8").catch(() => undefined) : undefined;
      if (request.identity && (originalGitFile === undefined || hashFileContent(originalGitFile) !== request.identity.gitFileHash)) {
        request.identity = undefined; originalGitFile = undefined;
      }
      const id = randomUUID(), storage = await slots(entry, id);
      const item: Journal = { id, mode: request.mode, phase: "prepared", entry,
        createdAt: new Date().toISOString(), storage, identity: request.identity, directoryIdentity: request.directoryIdentity, originalGitFile };
      if (!item.identity) preserveGit(item, request.gitWriteInProgress || current.gitWriteInProgress);
      await save(item);
      progress?.("removing");
      await rename(entry.path, storage);
      try { await validateStorage(item); }
      catch (error) { if (await missing(entry.path)) await rename(storage, entry.path); throw error; }
      await resumeMove(item);
      if (item.mode === "permanent") return purge(item, progress);
      if (!item.identity) { progress?.("verifying"); return projection(item); }
      try {
        await assertNoWorktreeWriter(item.identity.gitDir);
        item.originalHead = await readFile(join(item.identity.gitDir, "HEAD"), "utf8");
        const branch = /^ref: refs\/heads\/(.+)$/.exec(item.originalHead.trim());
        if (branch) {
          const head = (await resolveHead(storage)).trim();
          if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) throw new Error("HEAD is unavailable");
          item.entry = { ...item.entry, branch: branch[1], head };
          item.detached = true; await save(item);
          await assertNoWorktreeWriter(item.identity.gitDir);
          await writeAtomic(join(item.identity.gitDir, "HEAD"), `${head}\n`);
        }
      } catch {
        item.notes = ["Moved to Trash, but its branch could not be released. Restore or permanently delete this item before reusing that branch."];
        await save(item);
      }
      progress?.("verifying");
      return projection(item);
    },
    list: async () => {
      const records: WorktreeRecoveryRecord[] = [], issues: string[] = [], paths = new Set<string>();
      for (const name of await readdir(root).catch((error) => { if (isMissingFileError(error)) return []; throw error; })) {
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
        try {
          const item = await read(name.slice(0, -5));
          if (item.phase === "moved") { await validateStorage(item); paths.add(item.storage); }
          if (item.phase === "deleting" || item.phase === "restoring") paths.add(item.storage);
          if (item.phase === "prepared" && await missing(item.storage)) continue;
          if (item.mode === "trash" && item.phase !== "restored" || item.pendingGitCleanup || ["prepared", "moved", "deleting"].includes(item.phase)) records.push(projection(item));
        } catch (error) { issues.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      return { records, issues, paths };
    },
    owns: async (id: string) => !await missing(journalPath(id)),
    restore: async (id: string) => {
      const item = await read(id);
      await resumeMove(item);
      if (item.phase === "restored") return projection(item);
      if (item.mode !== "trash" || !["moved", "restoring"].includes(item.phase)) throw new Error("This Worktree cannot be restored; deletion already started");
      if (item.phase === "restoring" && await missing(item.entry.path) && !await missing(item.storage)) {
        await validateStorage(item);
        try { if (item.identity) { await validateMoved(item); await assertNoWorktreeWriter(item.identity.gitDir); } }
        catch { preserveGit(item); }
        if (await realpath(dirname(item.entry.path)) !== dirname(item.entry.path)) throw new Error("The original parent path changed; nothing was overwritten");
        await rename(item.storage, item.entry.path);
      }
      if (item.phase === "moved") {
        if (!await missing(item.entry.path)) throw new Error("The original path is occupied; nothing was overwritten");
        await validateStorage(item);
        try { if (item.identity) { await validateMoved(item); await assertNoWorktreeWriter(item.identity.gitDir); } }
        catch { preserveGit(item); }
        await mkdir(dirname(item.entry.path), { recursive: true });
        if (await realpath(dirname(item.entry.path)) !== dirname(item.entry.path)) throw new Error("The original parent path changed; nothing was overwritten");
        item.phase = "restoring"; await save(item);
        await rename(item.storage, item.entry.path);
      }
      const info = await lstat(item.entry.path, { bigint: true });
      const identity = item.directoryIdentity ?? item.identity!;
      if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== identity.worktreeDevice || String(info.ino) !== identity.worktreeInode) throw new Error("Restore target changed; nothing was overwritten");
      if (item.identity) {
        try {
          const admin = await lstat(item.identity.gitDir, { bigint: true });
          if (!admin.isDirectory() || admin.isSymbolicLink() || String(admin.dev) !== item.identity.adminDevice || String(admin.ino) !== item.identity.adminInode) throw new Error("Restore target changed; nothing was overwritten");
          await assertNoWorktreeWriter(item.identity.gitDir);
        } catch { preserveGit(item); }
      }
      try {
        if (item.originalGitFile) await writePointer(item.entry.path, item.originalGitFile);
        if (item.identity) await writeAtomic(join(item.identity.gitDir, "gitdir"), `${join(item.entry.path, ".git")}\n`);
        if (item.identity && item.detached && item.originalHead && item.entry.branch && item.entry.head &&
          await branchAvailable(item.entry.commonDir, item.entry.branch, item.entry.head).catch(() => false)) {
          await assertNoWorktreeWriter(item.identity.gitDir);
          await writeAtomic(join(item.identity.gitDir, "HEAD"), item.originalHead);
        }
      } catch { preserveGit(item); }
      item.phase = "restored"; await save(item);
      return projection(item);
    }
  };
};
