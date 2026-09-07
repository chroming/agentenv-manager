import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { evidencePriority, selectDiffEvidence } from "./summaryEvidence";
import { hashSkillContent } from "../skillContentHash";
import type { PendingSkillUpdate } from "../skillUpdatePreviewStore";
import type { SkillSummaryInput } from "../../shared/skillSummaries";

// Do not follow preview files into unrelated local data before sending model input.
const readText = async (root: string, path: string): Promise<string | undefined> => {
  const full = join(root, path);
  let resolved: string;
  try { resolved = await realpath(full); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
  const offset = relative(await realpath(root), resolved);
  if (offset.startsWith("..") || isAbsolute(offset)) return undefined;
  const stat = await lstat(full);
  if (!stat.isFile() || stat.size > 128_000) return undefined;
  const file = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const expectedSize = (await file.stat()).size;
    if (expectedSize > 128_000) return undefined;
    const buffer = Buffer.alloc(128_001);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== expectedSize || bytesRead > 128_000 || buffer.subarray(0, bytesRead).includes(0)) return undefined;
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)); }
    catch { return undefined; }
  } finally { await file.close(); }
};

const prepared = new WeakMap<PendingSkillUpdate, { root: string; snapshot: SkillSummaryInput }>();
export const readSummarySnapshot = async (pending: PendingSkillUpdate, targetDir: string): Promise<SkillSummaryInput> => {
  const verify = async () => {
    if (await hashSkillContent(targetDir) !== pending.expectedLibraryContentHash ||
        await hashSkillContent(pending.candidateDir) !== pending.candidateContentHash) {
      throw new Error("Skill content changed. Refresh the update preview before generating a summary.");
    }
  };
  await verify();
  const cached = prepared.get(pending);
  if (cached?.root === targetDir && cached.snapshot.beforeHash === pending.expectedLibraryContentHash &&
      cached.snapshot.afterHash === pending.candidateContentHash) return structuredClone(cached.snapshot);
  const files: SkillSummaryInput["files"] = [];
  const omittedPaths: string[] = [];
  const changeInventory: NonNullable<SkillSummaryInput["changeInventory"]> = [];
  let bytes = 0;
  const paths = [...new Set(pending.changePaths)].sort((a, b) => evidencePriority(a) - evidencePriority(b) || a.localeCompare(b));
  for (const path of paths) {
    const before = await readText(targetDir, path);
    const after = await readText(pending.candidateDir, path);
    const selected = before !== undefined && after !== undefined
      ? selectDiffEvidence(path, before, after, Math.min(24_000, 56_000 - bytes)) : undefined;
    const diff = selected?.diff;
    if (!diff || selected?.partial) omittedPaths.push(path);
    if (diff) { files.push({ path, diff }); bytes += Buffer.byteLength(JSON.stringify({ path, diff })); }
    const exists = async (root: string) => lstat(join(root, path)).then(() => true).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
    changeInventory.push({ path, action: !await exists(targetDir) ? "added" : !await exists(pending.candidateDir) ? "removed" : "modified",
      coverage: !diff ? "omitted" : selected?.partial ? "partial" : "full" });
  }
  const instruction = await readText(pending.candidateDir, "SKILL.md");
  const context = instruction ? [...instruction].slice(0, 1200).join("") : undefined;
  await verify();
  const snapshot = { skillId: pending.id, beforeHash: pending.expectedLibraryContentHash,
    afterHash: pending.candidateContentHash, files, omittedPaths, context, changeInventory };
  prepared.set(pending, { root: targetDir, snapshot });
  return structuredClone(snapshot);
};
