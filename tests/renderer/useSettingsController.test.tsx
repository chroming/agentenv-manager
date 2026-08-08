// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsController } from "../../src/renderer/hooks/useSettingsController";

const settings = {
  locale: "system" as const,
  conversationTerminal: "default" as const,
  skillSyncMethod: "auto" as const,
  skillStorageLocation: "appData" as const,
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60,
  backupRetentionDays: null
};

describe("useSettingsController", () => {
  const updateSettings = vi.fn();
  const onBusyChange = vi.fn();
  const onError = vi.fn();
  const onLocaleChange = vi.fn();
  const onBackupRetentionChanged = vi.fn();
  const onTargetSettingsChanged = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    updateSettings.mockResolvedValue(settings);
    Object.defineProperty(window, "agentEnv", {
      configurable: true,
      value: { updateSettings }
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "agentEnv");
  });

  it("owns loaded settings and coordinates dependent refreshes after a save", async () => {
    const next = { ...settings, locale: "zh_CN" as const, backupRetentionDays: 30 };
    updateSettings.mockResolvedValue(next);
    const { result } = renderHook(() => useSettingsController({
      onBackupRetentionChanged,
      onBusyChange,
      onError,
      onLocaleChange,
      onTargetSettingsChanged
    }));

    await act(async () => {
      await result.current.actions.update({ locale: "zh_CN", backupRetentionDays: 30 });
    });

    expect(result.current.state.settings).toEqual(next);
    expect(result.current.state.status).toBe("Settings saved");
    expect(onLocaleChange).toHaveBeenCalledWith("zh_CN");
    expect(onBackupRetentionChanged).toHaveBeenCalledTimes(1);
    expect(onTargetSettingsChanged).not.toHaveBeenCalled();
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it("refreshes Target data only for Target-affecting preferences", async () => {
    const { result } = renderHook(() => useSettingsController({
      onBackupRetentionChanged,
      onBusyChange,
      onError,
      onLocaleChange,
      onTargetSettingsChanged
    }));

    await act(async () => {
      await result.current.actions.update({ enabledTargetIds: ["opencode"] });
    });
    expect(onTargetSettingsChanged).toHaveBeenCalledWith(settings);
  });

  it("keeps failures scoped and auto-clears only successful save feedback", async () => {
    updateSettings.mockRejectedValueOnce(new Error("Save failed"));
    const { result } = renderHook(() => useSettingsController({
      onBackupRetentionChanged,
      onBusyChange,
      onError,
      onLocaleChange,
      onTargetSettingsChanged
    }));

    await act(async () => {
      await result.current.actions.update({ locale: "zh_CN" });
    });
    expect(onError).toHaveBeenLastCalledWith("Save failed");
    expect(result.current.state.status).toBe("");

    act(() => result.current.actions.setStatus("Settings saved"));
    act(() => vi.advanceTimersByTime(2400));
    expect(result.current.state.status).toBe("");
  });
});
