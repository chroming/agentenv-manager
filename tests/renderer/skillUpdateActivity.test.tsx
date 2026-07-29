// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useScheduledSkillUpdateChecks,
  type SkillUpdateActivity
} from "../../src/renderer/skillUpdateActivity";
import type { SkillSourceGroupView } from "../../src/shared/types";

const sourceGroup: SkillSourceGroupView = {
  formatVersion: 1,
  sourceId: "source-without-timestamp",
  sourceKind: "repository",
  automaticChecks: true,
  canonicalLink: "https://github.com/acme/skills/tree/main",
  repository: "https://github.com/acme/skills.git",
  ref: "main",
  directory: "",
  observationState: "ready",
  counts: { total: 0, updates: 0, new: 0, removed: 0 },
  candidates: []
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scheduled Skill source checks", () => {
  it("uses the latest local attempt as a retry floor when checkedAt is missing", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-07-29T10:00:00.000Z");
    vi.setSystemTime(now);
    const onCheck = vi.fn().mockResolvedValue({
      groups: [sourceGroup],
      checked: 1,
      failed: 0
    });
    const Probe = () => {
      const activityRef = useRef<SkillUpdateActivity | undefined>(undefined);
      useScheduledSkillUpdateChecks({
        activityRef,
        enabled: true,
        groups: [sourceGroup],
        intervalMinutes: 5,
        lastCheckAt: now,
        onCheck
      });
      return null;
    };
    render(<Probe />);

    await act(async () => vi.advanceTimersByTimeAsync(4 * 60_000 + 59_999));
    expect(onCheck).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(onCheck).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });
});
