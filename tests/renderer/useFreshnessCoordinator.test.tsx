// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFreshnessCoordinator } from "../../src/renderer/hooks/useFreshnessCoordinator";

afterEach(cleanup);

describe("useFreshnessCoordinator", () => {
  it("does not replace a newer explicit freshness result with an older failure", async () => {
    const { result } = renderHook(() => useFreshnessCoordinator(() => 500));
    let reject!: (error: Error) => void;
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.run("agents", "page-entry", () => new Promise<void>((_, fail) => { reject = fail; })).catch(() => undefined);
      result.current.markFresh("agents", { at: 501 });
    });
    await act(async () => { reject(new Error("obsolete")); await pending; });
    expect(result.current.states.agents).toMatchObject({ status: "ready", lastSuccessAt: 501, invalidated: false });
    expect(result.current.states.agents.error).toBeUndefined();
  });

  it("keeps invalidation that happens while an older request is running", async () => {
    const { result } = renderHook(() => useFreshnessCoordinator());
    let finish!: () => void;
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.run("agents", "page-entry", () => new Promise<void>((resolve) => { finish = resolve; })); });
    act(() => result.current.invalidate("agents"));
    await act(async () => { finish(); await pending; });
    expect(result.current.states.agents.invalidated).toBe(true);
    expect(result.current.states.agents.lastSuccessAt).toBeUndefined();
  });

  it("queues one latest mutation refresh even when the older request fails", async () => {
    const { result } = renderHook(() => useFreshnessCoordinator());
    let reject!: (error: Error) => void;
    const firstMutation = vi.fn(async () => "earlier");
    const latestMutation = vi.fn(async () => "latest");
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      void result.current.run("agents", "page-entry", () => new Promise<void>((_, fail) => { reject = fail; })).catch(() => undefined);
      first = result.current.run("agents", "mutation", firstMutation);
      second = result.current.run("agents", "mutation", latestMutation);
    });
    expect(first).toBe(second);
    await act(async () => { reject(new Error("old failure")); await second; });
    expect(firstMutation).not.toHaveBeenCalled();
    expect(latestMutation).toHaveBeenCalledOnce();
    expect(result.current.states.agents).toMatchObject({ invalidated: false, status: "ready" });
  });

  it("deduplicates work, respects TTL, and refreshes invalidated resources", async () => {
    let now = 100_000;
    let finish: ((value: string) => void) | undefined;
    const task = vi.fn(() => new Promise<string>((resolve) => {
      finish = resolve;
    }));

    const Harness = () => {
      const freshness = useFreshnessCoordinator(() => now);
      return (
        <>
          <span>{freshness.states.agents.status}</span>
          <button
            type="button"
            onClick={() => {
              void freshness.run("agents", "page-entry", task);
              void freshness.run("agents", "focus", task);
            }}
          >
            Ensure
          </button>
          <button
            type="button"
            onClick={() => freshness.invalidate("agents")}
          >
            Invalidate
          </button>
        </>
      );
    };

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ensure" }));
    expect(task).toHaveBeenCalledTimes(1);
    expect(screen.getByText("refreshing")).toBeInTheDocument();
    finish?.("done");
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Ensure" }));
    expect(task).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Invalidate" }));
    now += 1;
    fireEvent.click(screen.getByRole("button", { name: "Ensure" }));
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("retains the last successful timestamp when a later refresh fails", async () => {
    let fail = false;
    const task = vi.fn(async () => {
      if (fail) throw new Error("Unavailable");
      return "ok";
    });

    const Harness = () => {
      const freshness = useFreshnessCoordinator(() => 42);
      const state = freshness.states.conversations;
      return (
        <>
          <span>{`${state.status}:${state.lastSuccessAt ?? "none"}`}</span>
          <button
            type="button"
            onClick={() => {
              void freshness.run("conversations", "manual", task).catch(() => undefined);
            }}
          >
            Refresh
          </button>
        </>
      );
    };

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText("ready:42")).toBeInTheDocument());
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText("error:42")).toBeInTheDocument());
  });
});
