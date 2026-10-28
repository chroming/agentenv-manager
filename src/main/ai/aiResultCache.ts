import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { z } from "zod";
import type { AIResultQuality } from "../../shared/aiReliability";
import { writeAtomic } from "../fileUtils";

async function readBytes(path: string) {
  if (!(await lstat(path)).isFile()) throw new Error("AI cache must be a regular file, not a link or directory");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1_048_576) throw new Error("AI cache is not a bounded regular file");
    const buffer = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size) throw new Error("AI cache changed while reading");
    return buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
}

export async function readAIResultFile<T>(path: string, schema: z.ZodType<T>, valid: (value: T) => boolean = () => true) {
  try {
    const cached = schema.parse(JSON.parse((await readBytes(path)).toString("utf8")));
    if (!valid(cached)) throw new Error("Invalid AI cache identity");
    return { cached, damaged: false };
  } catch (error) {
    return { cached: undefined, damaged: (error as NodeJS.ErrnoException).code !== "ENOENT" };
  }
}

export async function saveAIResultFile<T>(path: string, value: T, schema: z.ZodType<T>, valid: (value: T) => boolean = () => true) {
  const checked = schema.parse(value);
  if (!valid(checked)) throw new Error("Invalid AI result identity");
  let bytes: Buffer | undefined;
  try { bytes = await readBytes(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (bytes) {
    let trusted = false;
    try { const prior = schema.parse(JSON.parse(bytes.toString("utf8"))); trusted = valid(prior); } catch { /* Preserve unreadable derived data before replacing it. */ }
    if (!trusted) await writeAtomic(join(dirname(path), "recovery", `${randomUUID()}.json`), bytes, { mode: 0o600 });
  }
  await writeAtomic(path, `${JSON.stringify(checked)}\n`, { mode: 0o600 });
}

export function createAIResultDelivery<T extends AIResultQuality & { key: string }>(write: (record: T) => Promise<void>) {
  const pending = new Map<string, T>();
  const save = async (record: T, signal: AbortSignal): Promise<T> => {
    signal.throwIfAborted();
    const { savePending: _unsaved, ...persisted } = record;
    try {
      await write(persisted as T);
      pending.delete(record.key);
      return persisted as T;
    } catch {
      const result = { ...persisted, savePending: true } as T;
      pending.set(record.key, result);
      return result;
    }
  };
  return { save, read: (key: string) => pending.get(key), async retry(key: string, signal: AbortSignal) {
    const record = pending.get(key);
    if (!record) throw new Error("The unsaved AI result is no longer available in this session. No request was sent.");
    return save(record, signal);
  } };
}
