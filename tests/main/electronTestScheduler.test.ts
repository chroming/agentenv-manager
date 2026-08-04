import { describe, expect, it } from "vitest";
import {
  assertExactTestCoverage,
  mergeVitestReports,
  partitionTestNames
} from "../../scripts/electron-test-scheduler.mjs";

describe("Electron test scheduler", () => {
  it("partitions every test exactly once across bounded shards", () => {
    const names = Array.from({ length: 11 }, (_, index) => `test ${index + 1}`);
    const shards = partitionTestNames(names, 3);

    expect(shards).toHaveLength(3);
    expect([...shards.flat()].sort()).toEqual([...names].sort());
    expect(Math.max(...shards.map((shard) => shard.length)) -
      Math.min(...shards.map((shard) => shard.length))).toBeLessThanOrEqual(1);
  });

  it("rejects missing, duplicate, and unexpected Electron executions", () => {
    expect(() => assertExactTestCoverage(
      ["alpha", "beta", "gamma"],
      ["alpha", "beta", "beta", "delta"]
    )).toThrowError(/missing: gamma[\s\S]*duplicate: beta[\s\S]*unexpected: delta/i);
  });

  it("merges shard reports using only the tests that actually executed", () => {
    const report = (name: string, assertions: Array<{ fullName: string; status: string }>) => ({
      success: true,
      startTime: 1,
      testResults: [{
        name,
        status: "passed",
        startTime: 1,
        endTime: 2,
        message: "",
        assertionResults: assertions.map((assertion) => ({
          ...assertion,
          ancestorTitles: ["suite"],
          title: assertion.fullName,
          failureMessages: [],
          meta: {},
          tags: []
        }))
      }]
    });

    const merged = mergeVitestReports([
      report("ui", [
        { fullName: "suite alpha", status: "passed" },
        { fullName: "suite beta", status: "skipped" }
      ]),
      report("ui", [
        { fullName: "suite alpha", status: "skipped" },
        { fullName: "suite beta", status: "passed" }
      ])
    ]);

    expect(merged.success).toBe(true);
    expect(merged.numTotalTests).toBe(2);
    expect(merged.numPassedTests).toBe(2);
    expect(merged.numPendingTests).toBe(0);
    expect(merged.testResults.flatMap((result) => result.assertionResults))
      .toHaveLength(2);
  });
});
