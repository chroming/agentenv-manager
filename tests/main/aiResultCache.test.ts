import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAIResultDelivery, readAIResultFile, saveAIResultFile } from "../../src/main/ai/aiResultCache";

const roots: string[] = [];
const schema = z.object({ key: z.literal("fixture"), overview: z.string() });
const record = { key: "fixture" as const, overview: "Generated" };
const setup = async () => { const root = await mkdtemp(join(tmpdir(), "aem-ai-cache-")); roots.push(root); return { root, path: join(root, "result.json") }; };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("recoverable derived AI results", () => {
  it("treats damaged caches as a miss without modifying their bytes", async () => {
    const { path } = await setup(); await writeFile(path, "broken-original");
    expect(await readAIResultFile(path, schema)).toEqual({ cached: undefined, damaged: true });
    expect(await readFile(path, "utf8")).toBe("broken-original");
  });
  it("preserves damaged bytes before atomically replacing a result", async () => {
    const { root, path } = await setup(); await writeFile(path, "broken-original");
    await saveAIResultFile(path, record, schema);
    const preserved = await readdir(join(root, "recovery"));
    expect(preserved).toHaveLength(1);
    expect(await readFile(join(root, "recovery", preserved[0]), "utf8")).toBe("broken-original");
    expect((await readAIResultFile(path, schema)).cached).toEqual(record);
  });
  it("also preserves a valid-shaped cache with a mismatched identity", async () => {
    const { root, path } = await setup(); const original = JSON.stringify(record);
    await writeFile(path, original);
    expect((await readAIResultFile(path, schema, () => false)).damaged).toBe(true);
    await saveAIResultFile(path, { ...record, overview: "Correct" }, schema, (value) => value.overview === "Correct");
    expect(await readFile(join(root, "recovery", (await readdir(join(root, "recovery")))[0]), "utf8")).toBe(original);
  });
  it("does not replace old data when validation fails", async () => {
    const { path } = await setup(); await writeFile(path, "old");
    await expect(saveAIResultFile(path, { key: "wrong", overview: "New" }, schema)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("old");
  });
  it("does not follow a cache symlink to overwrite another file", async () => {
    const { root, path } = await setup(); const outside = join(root, "private.json");
    await writeFile(outside, "private"); await symlink(outside, path);
    expect((await readAIResultFile(path, schema)).damaged).toBe(true);
    await expect(saveAIResultFile(path, record, schema)).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("private");
  });
  it("retains an unsaved result in memory and retries only persistence", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    const delivery = createAIResultDelivery(write);
    const signal = new AbortController().signal;
    expect(await delivery.save(record, signal)).toEqual({ ...record, savePending: true });
    expect(delivery.read(record.key)).toEqual({ ...record, savePending: true });
    expect(await delivery.retry(record.key, signal)).toEqual(record);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).not.toHaveProperty("savePending");
    expect(delivery.read(record.key)).toBeUndefined();
  });
  it("does not write a cancelled or nonexistent retry", async () => {
    const write = vi.fn(); const delivery = createAIResultDelivery(write);
    const controller = new AbortController(); controller.abort();
    await expect(delivery.save(record, controller.signal)).rejects.toThrow();
    await expect(delivery.retry("missing", new AbortController().signal)).rejects.toThrow("No request was sent");
    expect(write).not.toHaveBeenCalled();
  });
});
