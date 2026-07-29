// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFreshnessCoordinator } from "../../src/renderer/hooks/useFreshnessCoordinator";

afterEach(cleanup);

describe("useFreshnessCoordinator", () => {
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
