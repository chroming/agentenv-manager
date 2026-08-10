// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEnvApi } from "../../src/shared/types";
import { useProfileActionGuard } from "../../src/renderer/hooks/useProfileActionGuard";

const createWindowGuardApi = () => {
  let closeRequest: () => void = () => undefined;
  return {
    api: {
      cancelWindowClose: vi.fn(),
      confirmWindowClose: vi.fn(),
      onWindowCloseRequested: vi.fn((callback: () => void) => {
        closeRequest = callback;
        return () => undefined;
      }),
      setWindowCloseGuard: vi.fn()
    } as unknown as AgentEnvApi,
    requestClose: () => closeRequest()
  };
};

describe("useProfileActionGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs an action immediately when the Profile is clean", () => {
    const action = vi.fn();
    const windowGuard = createWindowGuardApi();
    const { result } = renderHook(() =>
      useProfileActionGuard({
        dirty: false,
        onBusyChange: vi.fn(),
        onDiscard: vi.fn(),
        onError: vi.fn(),
        onSave: vi.fn(),
        windowGuardApi: windowGuard.api
      })
    );

    act(() => result.current.guardAction("open Skills", action));

    expect(action).toHaveBeenCalledOnce();
    expect(result.current.pendingAction).toBeUndefined();
  });

  it("flushes an ordinary auto-save before navigation without opening a prompt", async () => {
    const action = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const windowGuard = createWindowGuardApi();
    const { result } = renderHook(() =>
      useProfileActionGuard({
        autoSaveDirty: true,
        dirty: false,
        onBusyChange: vi.fn(),
        onDiscard: vi.fn(),
        onError: vi.fn(),
        onSave,
        windowGuardApi: windowGuard.api
      })
    );

    await act(async () => result.current.guardAction("open Skills", action));

    expect(onSave).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
    expect(result.current.pendingAction).toBeUndefined();
  });

  it("saves before continuing a guarded action", async () => {
    const action = vi.fn();
    const onBusyChange = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const windowGuard = createWindowGuardApi();
    const { result } = renderHook(() =>
      useProfileActionGuard({
        dirty: true,
        onBusyChange,
        onDiscard: vi.fn(),
        onError: vi.fn(),
        onSave,
        windowGuardApi: windowGuard.api
      })
    );

    act(() => result.current.guardAction("open Skills", action));
    expect(result.current.pendingAction).toEqual({ label: "open Skills" });
    await act(() => result.current.continuePendingAction(true));

    expect(onSave).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(result.current.pendingAction).toBeUndefined();
  });

  it("keeps the pending action when Save fails", async () => {
    const onError = vi.fn();
    const windowGuard = createWindowGuardApi();
    const { result } = renderHook(() =>
      useProfileActionGuard({
        dirty: true,
        onBusyChange: vi.fn(),
        onDiscard: vi.fn(),
        onError,
        onSave: vi.fn().mockRejectedValue(new Error("Save failed")),
        windowGuardApi: windowGuard.api
      })
    );

    act(() => result.current.guardAction("open Skills", vi.fn()));
    await act(() => result.current.continuePendingAction(true));

    expect(onError).toHaveBeenCalledWith("Save failed");
    expect(result.current.pendingAction).toEqual({ label: "open Skills" });
  });

  it("guards an operating-system close and cancels it explicitly", () => {
    const windowGuard = createWindowGuardApi();
    const { result } = renderHook(() =>
      useProfileActionGuard({
        dirty: true,
        onBusyChange: vi.fn(),
        onDiscard: vi.fn(),
        onError: vi.fn(),
        onSave: vi.fn(),
        windowGuardApi: windowGuard.api
      })
    );

    act(() => windowGuard.requestClose());
    expect(result.current.pendingAction).toEqual({
      label: "close AgentEnv Manager"
    });
    act(() => result.current.cancelPendingAction());

    expect(windowGuard.api.cancelWindowClose).toHaveBeenCalledOnce();
    expect(result.current.pendingAction).toBeUndefined();
  });

  it("flushes auto-save before confirming an operating-system close", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const windowGuard = createWindowGuardApi();
    renderHook(() =>
      useProfileActionGuard({
        autoSaveDirty: true,
        dirty: false,
        onBusyChange: vi.fn(),
        onDiscard: vi.fn(),
        onError: vi.fn(),
        onSave,
        windowGuardApi: windowGuard.api
      })
    );

    await act(async () => windowGuard.requestClose());

    expect(onSave).toHaveBeenCalledOnce();
    expect(windowGuard.api.confirmWindowClose).toHaveBeenCalledOnce();
  });
});
