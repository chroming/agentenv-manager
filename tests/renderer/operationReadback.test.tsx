// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useInstructionLibrary } from "../../src/renderer/hooks/useInstructionLibrary";
import { useRemoteEndpoints } from "../../src/renderer/hooks/useRemoteEndpoints";
import { useSettingsController } from "../../src/renderer/hooks/useSettingsController";
import type { AgentEnvApi, InstructionBlock, RemoteDevice, RemoteDeviceProbe } from "../../src/shared/types";

const install = (value: Partial<AgentEnvApi>) => Object.defineProperty(window, "agentEnv", { configurable: true, value });
const never = <T,>() => new Promise<T>(() => {});

it("reports saved settings even if the Agent refresh is stalled", async () => {
  const callbacks = { onBackupRetentionChanged: vi.fn(), onBusyChange: vi.fn(), onError: vi.fn(),
    onLocaleChange: vi.fn(), onTargetSettingsChanged: vi.fn(() => never<void>()) };
  const { result } = renderHook(() => useSettingsController(callbacks));
  const saved = { ...result.current.state.settings, enabledTargetIds: ["codex"] };
  install({ updateSettings: vi.fn().mockResolvedValue(saved) });
  await act(async () => { expect(await result.current.actions.update({ enabledTargetIds: ["codex"] })).toEqual(saved); });
  expect(result.current.state.status).toBe("Settings saved");
  expect(callbacks.onTargetSettingsChanged).toHaveBeenCalledWith(saved);
  expect(callbacks.onBusyChange).toHaveBeenLastCalledWith(false);
});

it("uses the saved Instruction immediately and reports a readback failure separately", async () => {
  const saved = { id: "review", name: "Review", contentHash: "current" } as InstructionBlock;
  const onRefreshError = vi.fn(), failure = new Error("Profile list unavailable");
  install({ createInstructionBlock: vi.fn().mockResolvedValue(saved), listInstructionBlocks: () => never() });
  const { result } = renderHook(() => useInstructionLibrary(async () => { throw failure; }, onRefreshError));
  await act(() => result.current.create({ name: saved.name, description: "", content: "Review" }));
  expect(result.current.blocks).toEqual([saved]);
  expect(result.current.loading).toBe(false);
  expect(onRefreshError).toHaveBeenCalledWith(failure);
});

it("shows an SSH device after its local save, without waiting for probing or all remote endpoints", async () => {
  const device: RemoteDevice = { id: "fixture", name: "Offline fixture", host: "fixture",
    createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z" };
  let finish!: (value: RemoteDeviceProbe) => void;
  const pending = new Promise<RemoteDeviceProbe>((done) => { finish = done; });
  const probeRemoteDevice = vi.fn().mockReturnValue(pending);
  install({ addRemoteDevice: vi.fn().mockResolvedValue(device), listRemoteDevices: vi.fn().mockResolvedValue([device]),
    probeRemoteDevice, listRemoteEndpoints: () => never() });
  const options = { targets: [], supportedTargets: [], setTargetStates: vi.fn(), enabled: false,
    sharedSkillsLabel: "Shared Skills", onError: vi.fn() };
  const { result } = renderHook(() => useRemoteEndpoints(options));
  await act(async () => { await result.current.add({ name: device.name, host: device.host }); });
  expect(result.current.devices).toEqual([device]);
  expect(result.current.busy).toBe(false);
  expect(probeRemoteDevice).toHaveBeenCalledWith(device.id, false);
  await act(async () => finish({ deviceId: device.id, status: "unavailable", agentExecutables: {},
    checkedAt: device.updatedAt, error: "SSH connection timed out" }));
  await waitFor(() => expect(result.current.probes[0]?.error).toBe("SSH connection timed out"));
  expect(options.onError).not.toHaveBeenCalled();
});
