import { describe, expect, it, vi } from "vitest";
import { runSkillImportQueue } from "../../src/renderer/skillImportQueue";

describe("skill import queue", () => {
  it("keeps completed writes and skips the current review plus every unstarted item after stop", async () => {
    let stopped = false;
    const progress = vi.fn();
    const imported = vi.fn(async (value: string) => {
      if (value === "first") stopped = true;
      return `imported-${value}`;
    });

    const result = await runSkillImportQueue(
      ["first", "second", "third"],
      { onProgress: progress, shouldStop: () => stopped },
      {
        progressKey: (value) => value,
        prepare: async (value) => value,
        importPrepared: imported,
        failure: (value, error) => ({ value, error: String(error) })
      }
    );

    expect(result).toEqual({
      imported: ["imported-first"],
      failed: [],
      updatedSourceCount: 0
    });
    expect(imported).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls.map(([item]) => [item.sourceUrl, item.status])).toEqual([
      ["first", "reviewing"],
      ["first", "importing"],
      ["first", "imported"],
      ["second", "skipped"],
      ["third", "skipped"]
    ]);
  });

  it("marks a cancelled active review as skipped instead of failed", async () => {
    let stopped = false;
    const progress = vi.fn();
    const result = await runSkillImportQueue(
      ["reviewing", "queued"],
      { onProgress: progress, shouldStop: () => stopped },
      {
        progressKey: (value) => value,
        prepare: async () => {
          stopped = true;
          throw new Error("cancelled");
        },
        importPrepared: async (value) => value,
        failure: (value, error) => ({ value, error: String(error) })
      }
    );

    expect(result.failed).toEqual([]);
    expect(progress.mock.calls.map(([item]) => [item.sourceUrl, item.status])).toEqual([
      ["reviewing", "reviewing"],
      ["reviewing", "skipped"],
      ["queued", "skipped"]
    ]);
  });
});
