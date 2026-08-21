import { describe, expect, it } from "vitest";
import type { TargetInfo, TargetManagementState } from "../../src/shared/types";
import {
  mergeLocalTargetStates,
  mergeRemoteTargetStates,
  preserveSelectedTarget
} from "../../src/renderer/targetStateSlices";

const state = (targetId: string): TargetManagementState => ({
  targetId,
  status: "unmanaged",
  lifecycleStatus: "unmanaged",
  managedResourceCount: 0,
  warningCount: 0,
  errorCount: 0
});

describe("Target state slices", () => {
  it("does not discard remote states when local Profiles refresh", () => {
    expect(mergeLocalTargetStates(
      [state("opencode"), state("ssh:device:opencode")],
      [state("codex")]
    ).map((item) => item.targetId)).toEqual(["codex", "ssh:device:opencode"]);
  });

  it("does not discard local states when SSH devices refresh", () => {
    expect(mergeRemoteTargetStates(
      [state("opencode"), state("ssh:old:opencode")],
      [state("ssh:new:codex")]
    ).map((item) => item.targetId)).toEqual(["opencode", "ssh:new:codex"]);
  });

  it("preserves a selected remote endpoint during a local refresh", () => {
    expect(preserveSelectedTarget(
      "ssh:device:opencode",
      [{ id: "opencode" } as TargetInfo]
    )).toBe("ssh:device:opencode");
  });
});
