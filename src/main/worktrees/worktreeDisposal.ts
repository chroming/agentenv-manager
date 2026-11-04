import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { WorktreeCleanupPreview, WorktreeDisposalMode, WorktreeEntry, WorktreeRecoveryRecord, WorktreeRestoreRegistration } from "../../shared/worktrees";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import { hashFileContent, hashPathEntry, hashRequiredPathEntry } from "../filesystemIntegrity";
import { assertNoWorktreeWriter } from "./worktreeGitState";
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
const journalSchema = z.object({
  id: z.string().uuid(), mode: z.enum(["trash", "permanent"]),
  phase: z.enum(["prepared", "moved", "deleting", "removed", "restoring", "restored"]),
  entry: z.object({ path: z.string(), commonDir: z.string(), repositoryPath: z.string(), head: z.string().optional(), branch: z.string().optional(), sizeBytes: z.number().nonnegative().optional() }),
  createdAt: z.string(), storage: z.string(), identity: identitySchema,
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
  const issued = new Map<string, { entry: WorktreeEntry; identity: WorktreeRestoreRegistration; mode: WorktreeDisposalMode; at: number; journalId?: string }>();
  const journalPath = (id: string) => join(root, `${z.string().uuid().parse(id)}.json`);
  const save = async (item: Journal) => writeAtomic(journalPath(item.id), `${JSON.stringify(journalSchema.parse(item), null, 2)}\n`);
  const read = async (id: string): Promise<Journal> => {
    const path = journalPath(id), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error("Unverified Worktree Trash record; nothing was changed");
    const item = journalSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const allowed = [join(root, id, "files"), join(dirname(item.entry.path), ".agentenv-worktree-trash", id, "files")];
    if (item.id !== id || !allowed.includes(item.storage) || resolve(item.entry.path) !== item.entry.path ||
      item.identity.commonDir !== item.entry.commonDir) throw new Error("Unverified Worktree Trash identity");
    return item;
  };
  const projection = (item: Journal): WorktreeRecoveryRecord => ({
    id: item.id, mode: item.mode, path: item.entry.path, repositoryPath: item.entry.repositoryPath,
    head: item.entry.head ?? "", branch: item.entry.branch, createdAt: item.createdAt,
    status: item.phase === "restored" ? "restored" : item.phase === "restoring" ? "restoring" : item.phase === "prepared" ? "prepared" : "removed",
    sourceSizeBytes: item.entry.sizeBytes, reclaimedSizeBytes: item.mode === "trash" ? 0 : item.phase === "removed" ? item.entry.sizeBytes : undefined,
    pendingGitCleanup: item.pendingGitCleanup, disposalIncomplete: item.phase === "deleting" || item.phase === "prepared" || item.mode === "permanent" && item.phase === "moved",
    ...(item.mode === "trash" || !["removed", "restored"].includes(item.phase) ? { retainedPath: item.storage } : {}),
    ...(item.pendingGitCleanup ? { verificationWarnings: [`Folder deleted; Git registration cleanup is pending. ${item.registrationError ?? "Retry cleanup from Worktree recovery."}`] } : item.notes?.length ? { verificationWarnings: item.notes } : {})
  });
  const capture = async (entry: WorktreeEntry) => {
    const gitFile = join(entry.path, ".git"), info = await lstat(gitFile);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("This is not a verified linked Worktree directory");
    const text = await readFile(gitFile, "utf8");
    if (!text.startsWith("gitdir: ")) throw new Error("This is not a verified linked Worktree directory");
    return readLinkedRegistrationIdentity(entry.commonDir, entry.path, resolve(entry.path, text.slice(8).trim()));
  };
  const prepare = async (entry: WorktreeEntry, mode: WorktreeDisposalMode, journalId?: string): Promise<WorktreeCleanupPreview> => {
    const identity = await capture(entry), previewId = randomUUID();
    issued.set(previewId, { entry, identity, mode, at: Date.now(), journalId });
    return { mode, previewId, entry, fingerprint: previewId, checkedAt: new Date().toISOString(),
      backupRequired: false, forceRequired: false, savedWorkspace: false };
  };
  const retainedEntry = (item: Journal): WorktreeEntry => ({ ...item.entry, path: item.storage,
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
  const validateMoved = async (item: Journal) => assertRestoreRegistration(item.identity, item.entry.commonDir, item.storage);
  const retainedPointer = (item: Journal) => `gitdir: ${item.identity.gitDir}\n`;
  const writePointer = async (path: string, text: string) => {
    if (await readFile(join(path, ".git"), "utf8") !== text) await writeAtomic(join(path, ".git"), text);
  };
  const validateStorage = async (item: Journal) => {
    const info = await lstat(item.storage, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== item.identity.worktreeDevice || String(info.ino) !== item.identity.worktreeInode) {
      throw new Error("Worktree Trash contents changed identity; nothing else was removed");
    }
  };
  const resumeMove = async (item: Journal) => {
    if (item.phase !== "prepared") return;
    const info = await lstat(item.storage, { bigint: true }), admin = await lstat(item.identity.gitDir, { bigint: true });
    const backlink = (await readFile(join(item.identity.gitDir, "gitdir"), "utf8")).trim();
    const pointerHash = await hashRequiredPathEntry(join(item.storage, ".git"));
    if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== item.identity.worktreeDevice || String(info.ino) !== item.identity.worktreeInode ||
        !admin.isDirectory() || admin.isSymbolicLink() || String(admin.dev) !== item.identity.adminDevice || String(admin.ino) !== item.identity.adminInode ||
        (pointerHash !== item.identity.gitFileHash && (!item.originalGitFile || pointerHash !== hashFileContent(retainedPointer(item)))) ||
        await hashRequiredPathEntry(join(item.identity.gitDir, "commondir")) !== item.identity.commonLinkHash ||
        ![join(item.entry.path, ".git"), join(item.storage, ".git")].includes(resolve(item.identity.gitDir, backlink))) throw new Error("Interrupted Trash move changed; nothing was overwritten");
    await assertNoWorktreeWriter(item.identity.gitDir);
    if (item.originalGitFile && !isAbsolute(item.originalGitFile.slice(8).trim())) await writePointer(item.storage, retainedPointer(item));
    await writeAtomic(join(item.identity.gitDir, "gitdir"), `${join(item.storage, ".git")}\n`);
    item.identity = await capture(retainedEntry(item)); item.phase = "moved"; await save(item);
  };
  const clearRegistration = async (item: Journal) => {
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
    await rm(admin, { recursive: true });
  };
  const purge = async (item: Journal, progress?: (phase: "preparing" | "removing" | "verifying") => void) => {
    if (!await missing(item.storage)) {
      await validateStorage(item);
      await assertNoWorktreeWriter(item.identity.gitDir);
      item.phase = "deleting"; item.mode = "permanent"; await save(item);
      progress?.("removing");
      try { await rm(item.storage, { recursive: true }); }
      catch (error) { throw new Error(`Deletion did not finish. Remaining contents are in Worktree Trash; retry permanent deletion there. ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    }
    progress?.("verifying");
    if (!await missing(item.storage)) throw new Error("Worktree deletion did not finish; retry this item");
    item.phase = "removed"; item.mode = "permanent";
    try { await clearRegistration(item); item.pendingGitCleanup = false; item.registrationError = undefined; }
    catch (error) { item.pendingGitCleanup = true; item.registrationError = error instanceof Error ? error.message : String(error); }
    await save(item);
    return projection(item);
  };
  return {
    preview: async (commonDir: string, path: string, mode: WorktreeDisposalMode) => prepare(await lookup(commonDir, path), mode),
    previewTrash: async (id: string) => {
      const item = await read(id);
      if (item.phase === "restored" || item.mode !== "trash" && !item.pendingGitCleanup && !["prepared", "moved", "deleting"].includes(item.phase)) throw new Error("This Worktree is not in Trash");
      if (await missing(item.storage) && item.pendingGitCleanup) {
        const entry = retainedEntry(item), previewId = randomUUID();
        issued.set(previewId, { entry, identity: item.identity, mode: "permanent", at: Date.now(), journalId: id });
        return { mode: "permanent" as const, previewId, entry, fingerprint: previewId, checkedAt: new Date().toISOString(), backupRequired: false, forceRequired: false, savedWorkspace: false };
      }
      if (item.phase === "deleting" || item.phase === "prepared") {
        const previewId = randomUUID(), entry = retainedEntry(item);
        issued.set(previewId, { entry, identity: item.identity, mode: "permanent", at: Date.now(), journalId: id });
        return { mode: "permanent" as const, previewId, entry, fingerprint: previewId, checkedAt: new Date().toISOString(), backupRequired: false, forceRequired: false, savedWorkspace: false };
      }
      await validateStorage(item);
      const previewId = randomUUID(), entry = retainedEntry(item);
      issued.set(previewId, { entry, identity: item.identity, mode: "permanent", at: Date.now(), journalId: id });
      return { mode: "permanent" as const, previewId, entry, fingerprint: previewId, checkedAt: new Date().toISOString(), backupRequired: false, forceRequired: false, savedWorkspace: false };
    },
    remove: async (preview: WorktreeCleanupPreview, progress?: (phase: "preparing" | "removing" | "verifying") => void) => {
      const request = issued.get(preview.previewId); issued.delete(preview.previewId);
      if (!request || request.mode !== preview.mode || Date.now() - request.at > 10 * 60_000) throw new Error("Cleanup review expired. Review this Worktree again.");
      progress?.("preparing");
      if (request.journalId) { const item = await read(request.journalId); await resumeMove(item); return purge(item, progress); }
      const entry = request.entry;
      await assertRestoreRegistration(request.identity, entry.commonDir, entry.path);
      await assertNoWorktreeWriter(request.identity.gitDir);
      const originalGitFile = await readFile(join(entry.path, ".git"), "utf8");
      if (hashFileContent(originalGitFile) !== request.identity.gitFileHash) throw new Error("Worktree Git pointer changed; nothing was removed");
      const id = randomUUID(), storage = await slots(entry, id);
      const item: Journal = { id, mode: request.mode, phase: "prepared", entry,
        createdAt: new Date().toISOString(), storage, identity: request.identity, originalGitFile };
      await save(item);
      progress?.("removing");
      await rename(entry.path, storage);
      try {
        if (!isAbsolute(originalGitFile.slice(8).trim())) await writePointer(storage, retainedPointer(item));
        await writeAtomic(join(item.identity.gitDir, "gitdir"), `${join(storage, ".git")}\n`);
        item.identity = await capture(retainedEntry(item));
        item.phase = "moved"; await save(item);
      } catch (error) {
        if (await missing(entry.path)) {
          await rename(storage, entry.path);
          await writePointer(entry.path, originalGitFile);
          await writeAtomic(join(item.identity.gitDir, "gitdir"), `${join(entry.path, ".git")}\n`);
        }
        throw error;
      }
      if (item.mode === "permanent") return purge(item, progress);
      try {
        item.originalHead = await readFile(join(item.identity.gitDir, "HEAD"), "utf8");
        const branch = /^ref: refs\/heads\/(.+)$/.exec(item.originalHead.trim());
        if (branch) {
          const head = (await resolveHead(storage)).trim();
          if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) throw new Error("HEAD is unavailable");
          item.entry = { ...item.entry, branch: branch[1], head };
          item.detached = true; await save(item);
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
        await validateMoved(item);
        await rename(item.storage, item.entry.path);
      }
      if (item.phase === "moved") {
        if (!await missing(item.entry.path)) throw new Error("The original path is occupied; nothing was overwritten");
        await validateMoved(item); await assertNoWorktreeWriter(item.identity.gitDir);
        await mkdir(dirname(item.entry.path), { recursive: true });
        if (await realpath(dirname(item.entry.path)) !== dirname(item.entry.path)) throw new Error("The original parent path changed; nothing was overwritten");
        item.phase = "restoring"; await save(item);
        await rename(item.storage, item.entry.path);
      }
      const info = await lstat(item.entry.path, { bigint: true });
      const admin = await lstat(item.identity.gitDir, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== item.identity.worktreeDevice || String(info.ino) !== item.identity.worktreeInode ||
          !admin.isDirectory() || admin.isSymbolicLink() || String(admin.dev) !== item.identity.adminDevice || String(admin.ino) !== item.identity.adminInode) throw new Error("Restore target changed; nothing was overwritten");
      await assertNoWorktreeWriter(item.identity.gitDir);
      if (item.originalGitFile) await writePointer(item.entry.path, item.originalGitFile);
      await writeAtomic(join(item.identity.gitDir, "gitdir"), `${join(item.entry.path, ".git")}\n`);
      if (item.detached && item.originalHead && item.entry.branch && item.entry.head &&
        await branchAvailable(item.entry.commonDir, item.entry.branch, item.entry.head).catch(() => false)) {
        await writeAtomic(join(item.identity.gitDir, "HEAD"), item.originalHead);
      }
      item.phase = "restored"; await save(item);
      return projection(item);
    }
  };
};
