// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSkillDeploymentUpgrade } from "../../src/renderer/hooks/useSkillDeploymentUpgrade";

const settings = {
  locale: "system" as const,
  conversationTerminal: "default" as const,
  skillSyncMethod: "symlink" as const,
  skillDeploymentPreferenceVersion: 1 as const,
  skillDeploymentReviewPending: true,
  skillStorageLocation: "appData" as const,
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60,
  backupRetentionDays: null
};

describe("useSkillDeploymentUpgrade", () => {
  it("opens once for an upgraded device and counts physical live-link installs", () => {
    const { result } = renderHook(() => useSkillDeploymentUpgrade({
      inventory: [
        { id: "one", name: "One", description: "", path: "/skills/one", foundIn: ["codex"], status: "managed", skillKey: "one", contentHash: "same", installMethod: "linked" },
        { id: "one-alias", name: "One", description: "", path: "/skills/one", foundIn: ["opencode"], status: "managed", skillKey: "one", contentHash: "same", installMethod: "linked" }
      ],
      isLoading: false,
      settings,
      telemetryOpen: false,
      updateSettings: vi.fn()
    }));

    expect(result.current.open).toBe(true);
    expect(result.current.linkedInstallCount).toBe(1);
    act(() => result.current.onDismiss());
    expect(result.current.open).toBe(false);
  });

  it("persists the choice without writing Agent resources", async () => {
    const updateSettings = vi.fn().mockResolvedValue({ ...settings, skillSyncMethod: "copy" });
    const { result } = renderHook(() => useSkillDeploymentUpgrade({
      inventory: [],
      isLoading: false,
      settings,
      telemetryOpen: false,
      updateSettings
    }));

    await act(async () => result.current.onDecide("copy"));
    expect(updateSettings).toHaveBeenCalledWith({
      skillSyncMethod: "copy",
      skillDeploymentPreferenceVersion: 1,
      skillDeploymentReviewPending: false
    });
    expect(result.current.open).toBe(false);
  });
});
