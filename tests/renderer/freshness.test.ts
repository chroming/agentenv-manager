import { describe, expect, it } from "vitest";
import {
  createFreshnessStateMap,
  monitoredSkillSourcesDue,
  nextMonitoredSkillCheckDelay,
  oldestMonitoredSkillCheckAt,
  shouldRefreshResource
} from "../../src/renderer/freshness";
import type { SkillSourceGroupView } from "../../src/shared/types";

const group = (
  sourceId: string,
  checkedAt?: string,
  automaticChecks = true
): SkillSourceGroupView => ({
  sourceId,
  formatVersion: 1,
  kind: "repository",
  repository: `https://example.com/${sourceId}.git`,
  ref: "main",
  directory: "skills",
  canonicalLink: `https://example.com/${sourceId}/tree/main/skills`,
  automaticChecks,
  checkedAt,
  observationState: checkedAt ? "ready" : "unchecked",
  counts: { total: 1, updates: 0, new: 0, removed: 0 },
  candidates: []
});

describe("freshness policy", () => {
  it("refreshes invalid, never-loaded, expired, and forced resources", () => {
    const state = createFreshnessStateMap().agents;
    expect(shouldRefreshResource({ state, maxAgeMs: 60_000, now: 100_000 }))
      .toBe(true);
    expect(shouldRefreshResource({
      state: { ...state, lastSuccessAt: 80_000, status: "ready" },
      maxAgeMs: 60_000,
      now: 100_000
    })).toBe(false);
    expect(shouldRefreshResource({
      state: { ...state, lastSuccessAt: 20_000, status: "ready" },
      maxAgeMs: 60_000,
      now: 100_000
    })).toBe(true);
    expect(shouldRefreshResource({
      state: { ...state, lastSuccessAt: 99_000, status: "ready" },
      maxAgeMs: 60_000,
      now: 100_000,
      force: true
    })).toBe(true);
    expect(shouldRefreshResource({
      state: { ...state, invalidated: true, lastSuccessAt: 99_000, status: "ready" },
      maxAgeMs: 60_000,
      now: 100_000
    })).toBe(true);
  });

  it("uses the oldest monitored source and ignores monitoring-off sources", () => {
    const groups = [
      group("one", "2026-07-29T08:00:00.000Z"),
      group("two", "2026-07-29T09:00:00.000Z"),
      group("off", undefined, false)
    ];
    expect(oldestMonitoredSkillCheckAt(groups))
      .toBe(Date.parse("2026-07-29T08:00:00.000Z"));
    expect(monitoredSkillSourcesDue({
      groups,
      intervalMinutes: 60,
      now: Date.parse("2026-07-29T08:30:00.000Z")
    })).toBe(false);
    expect(monitoredSkillSourcesDue({
      groups,
      intervalMinutes: 60,
      now: Date.parse("2026-07-29T09:00:00.000Z")
    })).toBe(true);
  });

  it("checks immediately when any monitored source has never been checked", () => {
    const groups = [
      group("checked", "2026-07-29T09:00:00.000Z"),
      group("new")
    ];
    expect(oldestMonitoredSkillCheckAt(groups)).toBeUndefined();
    expect(nextMonitoredSkillCheckDelay({
      groups,
      intervalMinutes: 60,
      now: Date.parse("2026-07-29T09:10:00.000Z")
    })).toBe(0);
    expect(monitoredSkillSourcesDue({
      groups,
      intervalMinutes: 60,
      now: Date.parse("2026-07-29T09:10:00.000Z")
    })).toBe(true);
  });

  it("treats malformed or future source timestamps as due instead of stalling checks", () => {
    const now = Date.parse("2026-07-29T09:10:00.000Z");
    for (const checkedAt of [
      "not-a-date",
      "2026-07-30T09:10:00.000Z"
    ]) {
      const groups = [group("clock-skewed", checkedAt)];
      expect(monitoredSkillSourcesDue({
        groups,
        intervalMinutes: 60,
        now
      })).toBe(true);
      expect(nextMonitoredSkillCheckDelay({
        groups,
        intervalMinutes: 60,
        now
      })).toBe(0);
    }
  });
});
