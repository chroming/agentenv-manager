import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { createUnifiedDiff } from "../diff";
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

export const readSummarySnapshot = async (pending: PendingSkillUpdate, targetDir: string): Promise<SkillSummaryInput> => {
  const verify = async () => {
    if (await hashSkillContent(targetDir) !== pending.expectedLibraryContentHash ||
        await hashSkillContent(pending.candidateDir) !== pending.candidateContentHash) {
      throw new Error("Skill content changed. Refresh the update preview before generating a summary.");
    }
  };
  await verify();
  const files: SkillSummaryInput["files"] = [];
  const omittedPaths: string[] = [];
  let bytes = 0;
  for (const path of pending.changePaths) {
    const before = await readText(targetDir, path);
    const after = await readText(pending.candidateDir, path);
    const diff = before !== undefined && after !== undefined ? createUnifiedDiff(path, before, after) : undefined;
    const size = Buffer.byteLength(JSON.stringify({ path, diff }));
    if (diff === undefined || size > 32_000 || diff.split("\n").some((line) => line.length > 2000) || bytes + size > 80_000) omittedPaths.push(path);
    else { files.push({ path, diff }); bytes += size; }
  }
  await verify();
  return { skillId: pending.id, beforeHash: pending.expectedLibraryContentHash,
    afterHash: pending.candidateContentHash, files, omittedPaths };
};
