import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zstdCompressSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { readHistoryText, decodeHistoryBytes, retryHistoryRead } from "../../../src/main/conversations/historyFileReader";
import { candidateForFile, forEachJsonLine, sourceIdFromFilename } from "../../../src/main/conversations/adapterUtils";
import { collapseCompressedHistoryCopies } from "../../../src/main/conversations/compressedHistoryCopies";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
const fixture = async () => { root = await mkdtemp(join(tmpdir(), "aem-history-reader-")); return root; };

it("reads compressed JSONL without changing source bytes and propagates corrupt streams", async () => {
  const path = join(await fixture(), "session.jsonl.zst");
  const text = '{"text":"你好"}\n{"text":"second"}\n';
  const bytes = zstdCompressSync(text);
  await writeFile(path, bytes);
  expect(await readHistoryText(path)).toBe(text);
  expect(await decodeHistoryBytes(path, bytes)).toBe(text);
  const records: unknown[] = [];
  await forEachJsonLine(path, (value) => { records.push(value); });
  expect(records).toEqual([{ text: "你好" }, { text: "second" }]);
  expect(await readFile(path)).toEqual(bytes);
  expect(sourceIdFromFilename(path)).toBe("session");
  await expect(readHistoryText(path, 10)).rejects.toThrow("indexing limit");
  await writeFile(path, bytes.subarray(0, bytes.length - 3));
  await expect(readHistoryText(path)).rejects.toThrow();
});

it("ignores malformed lines but never swallows consumer errors", async () => {
  const path = join(await fixture(), "session.jsonl");
  await writeFile(path, 'broken\n{"value":1}\n');
  const visitor = vi.fn(() => { throw new Error("parser failed"); });
  await expect(forEachJsonLine(path, visitor)).rejects.toThrow("parser failed");
  expect(visitor).toHaveBeenCalledTimes(1);
});

it("retries only transient observations with a bounded budget", async () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const read = vi.fn().mockRejectedValueOnce(missing).mockResolvedValue("fresh");
  expect(await retryHistoryRead(read)).toBe("fresh");
  const denied = vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
  await expect(retryHistoryRead(denied, "darwin")).rejects.toThrow("denied");
  expect(denied).toHaveBeenCalledTimes(1);
  const locked = vi.fn().mockRejectedValue(Object.assign(new Error("locked"), { code: "EBUSY" }));
  await expect(retryHistoryRead(locked)).rejects.toThrow("locked");
  expect(locked).toHaveBeenCalledTimes(3);
});

it("collapses only content-proven sibling copies and keeps divergent or broken copies", async () => {
  const plain = join(await fixture(), "session.jsonl");
  const compressed = `${plain}.zst`;
  const original = '{"text":"first"}\n';
  await writeFile(plain, original);
  await writeFile(compressed, zstdCompressSync(original));
  const candidates = await Promise.all([plain, compressed].map((path) => candidateForFile(path, { recordId: "session", detailState: "full" })));
  const issue = vi.fn();
  const select = () => collapseCompressedHistoryCopies(candidates, (candidate) => readHistoryText(candidate.source.locator), issue);
  expect(await select()).toEqual([candidates[0]]);
  await writeFile(compressed, zstdCompressSync(original + '{"text":"later"}\n'));
  expect(await select()).toEqual([candidates[1]]);
  await writeFile(compressed, zstdCompressSync('{"text":"different"}\n'));
  expect(await select()).toEqual(candidates);
  await writeFile(compressed, "broken");
  expect(await select()).toEqual(candidates);
  expect(issue).toHaveBeenCalledTimes(1);
});

it("reuses only version-bound comparison evidence on unchanged refreshes", async () => {
  const path = join(await fixture(), "cached.jsonl");
  await writeFile(path, "{}\n");
  await writeFile(`${path}.zst`, zstdCompressSync("{}\n"));
  const candidates = await Promise.all([path, `${path}.zst`].map((file) => candidateForFile(file, { recordId: "cached", detailState: "full" })));
  const read = vi.fn(async () => "{}\n");
  const cache = new Map<string, string | undefined>();
  await collapseCompressedHistoryCopies(candidates, read, vi.fn(), cache);
  await collapseCompressedHistoryCopies(candidates, read, vi.fn(), cache);
  expect(read).toHaveBeenCalledTimes(2);
  candidates[0].source.version += ":changed";
  await collapseCompressedHistoryCopies(candidates, read, vi.fn(), cache);
  expect(read).toHaveBeenCalledTimes(4);
  await collapseCompressedHistoryCopies(candidates, read, vi.fn(), cache, "other-device");
  expect(read).toHaveBeenCalledTimes(6);
});
