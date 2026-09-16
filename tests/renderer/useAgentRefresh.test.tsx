// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TargetInfo } from "../../src/shared/types";
import { useAgentRefresh } from "../../src/renderer/hooks/useAgentRefresh";

it("retains a reorder made while Agent discovery is pending", async () => {
  let finish!: (targets: TargetInfo[]) => void;
  const targets = [{ id: "codex" }, { id: "opencode" }] as TargetInfo[];
  Object.defineProperty(window, "agentEnv", { configurable: true, value: {
    listSupportedTargets: async () => targets,
    listTargets: () => new Promise<TargetInfo[]>(resolve => { finish = resolve; }),
    listTargetStates: async () => [],
    listNativeMcpConnections: async () => ({ connections: [], issues: [] }),
    probeSupportedTargets: async () => targets
  } });
  const setTargets = vi.fn();
  const options = {
    agentOrder: ["codex", "opencode"], profiles: [], loadRecoveryHistory: vi.fn(() => new Promise(() => undefined)),
    runFreshness: vi.fn(async (_key, _reason, run) => run()),
    setError: vi.fn(), setDiscoveredTargets: vi.fn(), setMcpConnections: vi.fn(), setMcpIssues: vi.fn(),
    setSelectedTargetId: vi.fn(), setSupportedTargets: vi.fn(), setTargetStates: vi.fn(), setTargets
  };
  const { result, rerender } = renderHook(props => useAgentRefresh(props), { initialProps: options });
  let running!: Promise<void>;
  act(() => { running = result.current(); });
  rerender({ ...options, agentOrder: ["opencode", "codex"] });
  await act(async () => { finish(targets); await running; });
  expect(setTargets.mock.calls[0][0].map((target: TargetInfo) => target.id)).toEqual(["opencode", "codex"]);
  expect(options.loadRecoveryHistory).toHaveBeenCalledOnce();
});
