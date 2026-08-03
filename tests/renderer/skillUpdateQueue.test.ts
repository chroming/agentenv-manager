import { describe, expect, it, vi } from "vitest";
import type { SkillLibraryEntry, SkillUpdatePlan } from "../../src/shared/types";
import { runSkillUpdateQueue } from "../../src/renderer/skillUpdateQueue";

const plan = (id: string): SkillUpdatePlan => ({
  id,
  previewId: `preview-${id}`,
  name: id,
  sourceType: "local",
  updateAvailable: true,
  changes: [],
  errors: [],
  impact: {
    profileNames: [],
    linkedInstallCount: 0,
    linkedTargetIds: [],
    copiedInstallCount: 0,
    copiedTargetIds: []
  }
});

const updatedSkill = (id: string): SkillLibraryEntry => ({
  id,
  name: id,
  description: "",
  path: `/tmp/${id}`,
  sourceType: "local",
  updatePolicy: "tracked",
  contentHash: `hash-${id}`,
  updatedAt: "2026-07-27T00:00:00.000Z"
});

describe("skill update queue", () => {
  it("updates Skills one at a time and keeps per-item failures", async () => {
    const progress = vi.fn();
    let active = 0;
    let maxActive = 0;
    const update = vi.fn(async (item: SkillUpdatePlan) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      if (item.id === "second") throw new Error("Source changed");
      return updatedSkill(item.id);
    });

    const result = await runSkillUpdateQueue(
      [plan("first"), plan("second"), plan("third")],
      update,
      (id, item) => progress(id, item)
    );

    expect(maxActive).toBe(1);
    expect(result.updated.map((skill) => skill.id)).toEqual(["first", "third"]);
    expect(result.failed).toEqual([{ id: "second", error: "Source changed" }]);
    expect(progress.mock.calls).toEqual([
      ["first", { status: "updating" }],
      ["first", { status: "updated" }],
      ["second", { status: "updating" }],
      ["second", { status: "failed", error: "Source changed" }],
      ["third", { status: "updating" }],
      ["third", { status: "updated" }]
    ]);
  });

  it("stops between Skills and marks the remaining queue as skipped", async () => {
    const progress = vi.fn();
    let stopRequested = false;
    const update = vi.fn(async (item: SkillUpdatePlan) => {
      stopRequested = true;
      return updatedSkill(item.id);
    });

    const result = await runSkillUpdateQueue(
      [plan("first"), plan("second"), plan("third")],
      update,
      (id, item) => progress(id, item),
      () => stopRequested
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(result.updated.map((skill) => skill.id)).toEqual(["first"]);
    expect(result.cancelled).toBe(true);
    expect(progress.mock.calls).toEqual([
      ["first", { status: "updating" }],
      ["first", { status: "updated" }],
      ["second", { status: "skipped" }],
      ["third", { status: "skipped" }]
    ]);
  });
});
