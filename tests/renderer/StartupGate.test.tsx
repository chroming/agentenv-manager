// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StartupStatus } from "../../src/shared/types";

vi.mock("../../src/renderer/App", () => ({
  App: () => <main>Ready workspace</main>
}));

import { StartupGate } from "../../src/renderer/StartupGate";

const originalLanguages = navigator.languages;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const installApi = (input: {
  readStartupStatus: () => Promise<StartupStatus>;
  retryStartup?: () => Promise<void>;
  openStartupDataFolder?: () => Promise<void>;
  exportStartupDiagnostics?: () => Promise<string | undefined>;
  onStatus(callback: (status: StartupStatus) => void): () => void;
}) => {
  Object.defineProperty(window, "agentEnv", {
    configurable: true,
    value: {
      readStartupStatus: input.readStartupStatus,
      retryStartup: input.retryStartup ?? vi.fn().mockResolvedValue(undefined),
      openStartupDataFolder: input.openStartupDataFolder ?? vi.fn().mockResolvedValue(undefined),
      exportStartupDiagnostics: input.exportStartupDiagnostics ?? vi.fn().mockResolvedValue(undefined),
      quitApp: vi.fn(),
      onStartupStatusChanged: input.onStatus
    }
  });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "agentEnv");
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: originalLanguages
  });
});

describe("StartupGate", () => {
  it("names the current startup phase instead of presenting a generic wait", async () => {
    installApi({
      readStartupStatus: vi.fn().mockResolvedValue({
        state: "initializing",
        phase: "recovering-writes"
      }),
      onStatus: () => vi.fn()
    });

    render(<StartupGate />);
    expect(await screen.findByText("Recovering interrupted changes…")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("explains when launch is waiting for an automatic update helper", async () => {
    installApi({
      readStartupStatus: vi.fn().mockResolvedValue({
        state: "initializing",
        phase: "finishing-update"
      }),
      onStatus: () => vi.fn()
    });

    render(<StartupGate />);
    expect(await screen.findByText("Finishing the automatic update…")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("does not let an older status response overwrite a newer startup event", async () => {
    const initial = deferred<StartupStatus>();
    let listener: ((status: StartupStatus) => void) | undefined;
    installApi({
      readStartupStatus: () => initial.promise,
      onStatus: (callback) => {
        listener = callback;
        return vi.fn();
      }
    });

    render(<StartupGate />);
    act(() => listener?.({ state: "ready" }));
    expect(await screen.findByText("Ready workspace")).toBeInTheDocument();
    await act(async () => initial.resolve({ state: "initializing" }));
    expect(screen.getByText("Ready workspace")).toBeInTheDocument();
  });

  it("renders Traditional Chinese recovery controls and keeps action errors selectable", async () => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["zh-TW"]
    });
    const openFolder = vi.fn().mockRejectedValue(new Error("Folder is unavailable"));
    installApi({
      readStartupStatus: vi.fn().mockResolvedValue({
        state: "failed",
        kind: "newer-data-format",
        title: "This data needs a newer AgentEnv Manager",
        message: "Stored format 3 is newer than supported format 2.",
        dataRoot: "/tmp/agentenv-data",
        canRetry: false
      }),
      openStartupDataFolder: openFolder,
      onStatus: () => vi.fn()
    });

    render(<StartupGate />);
    expect(await screen.findByRole("heading", {
      name: "這些資料需要較新版本的 AgentEnv Manager"
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "開啟資料目錄" }));
    expect(await screen.findByText("Folder is unavailable")).toBeInTheDocument();
    expect(screen.getByText("/tmp/agentenv-data")).toBeInTheDocument();
  });

  it("reads the final status after retry even when no event arrives", async () => {
    const failed: StartupStatus = {
      state: "failed",
      kind: "recovery",
      title: "AgentEnv could not finish recovery",
      message: "Recovery was interrupted.",
      canRetry: true
    };
    const readStartupStatus = vi.fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce({ state: "ready" });
    installApi({
      readStartupStatus,
      retryStartup: vi.fn().mockResolvedValue(undefined),
      onStatus: () => vi.fn()
    });

    render(<StartupGate />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Ready workspace")).toBeInTheDocument());
    expect(readStartupStatus).toHaveBeenCalledTimes(2);
  });
});
