import { describe, expect, it, vi } from "vitest";
import {
  measureSkillPerformancePhase,
  runSkillPerformanceTrace
} from "../../src/main/skillPerformanceTrace";

describe("skill performance trace", () => {
  it("records nested phase totals in one operation sample", async () => {
    const record = vi.fn();

    await runSkillPerformanceTrace("preview-update", "review", record, async () => {
      await measureSkillPerformancePhase("source", async () => undefined);
      await runSkillPerformanceTrace("nested", undefined, record, async () => {
        await measureSkillPerformancePhase("source", async () => undefined);
        await measureSkillPerformancePhase("diff", async () => undefined);
      });
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      operation: "preview-update",
      subject: "review",
      outcome: "completed",
      phases: expect.objectContaining({
        source: expect.any(Number),
        diff: expect.any(Number)
      })
    }));
  });

  it("records failed operations without changing the public error", async () => {
    const record = vi.fn();

    await expect(runSkillPerformanceTrace("check", undefined, record, async () => {
      throw new Error("network failed");
    })).rejects.toThrow("network failed");

    expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  });
});
