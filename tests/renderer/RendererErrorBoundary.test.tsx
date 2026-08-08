// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererErrorBoundary } from "../../src/renderer/RendererErrorBoundary";

const ThrowingChild = () => {
  throw new Error("Renderer exploded");
};

describe("RendererErrorBoundary", () => {
  const reportRendererError = vi.fn();
  const exportDiagnostics = vi.fn().mockResolvedValue("/tmp/diagnostics.json");
  const quitApp = vi.fn();

  beforeEach(() => {
    Object.defineProperty(window, "agentEnv", {
      configurable: true,
      value: { reportRendererError, exportDiagnostics, quitApp }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "agentEnv");
  });

  it("replaces a crashed Renderer with recovery actions and records diagnostics", async () => {
    const reload = vi.fn();

    render(
      <RendererErrorBoundary onReload={reload}>
        <ThrowingChild />
      </RendererErrorBoundary>
    );

    expect(screen.getByRole("heading", { name: "The interface stopped unexpectedly" })).toBeInTheDocument();
    expect(screen.getByText("Renderer exploded")).toBeInTheDocument();
    expect(reportRendererError).toHaveBeenCalledWith(expect.objectContaining({
      kind: "react-render-error",
      message: "Renderer exploded"
    }));

    fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }));
    await waitFor(() => expect(exportDiagnostics).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Diagnostic report exported to /tmp/diagnostics.json")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reload interface" }));
    expect(reload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it("keeps export failures visible and selectable", async () => {
    exportDiagnostics.mockRejectedValueOnce(new Error("Export unavailable"));

    render(
      <RendererErrorBoundary onReload={vi.fn()}>
        <ThrowingChild />
      </RendererErrorBoundary>
    );

    fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }));
    expect(await screen.findByText("Export unavailable")).toBeInTheDocument();
  });

  it("keeps the recovery surface available when diagnostic reporting fails", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportRendererError.mockImplementationOnce(() => {
      throw new Error("Diagnostic bridge unavailable");
    });

    render(
      <RendererErrorBoundary onReload={vi.fn()}>
        <ThrowingChild />
      </RendererErrorBoundary>
    );

    expect(screen.getByRole("heading", { name: "The interface stopped unexpectedly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload interface" })).toBeEnabled();
    expect(consoleError).toHaveBeenCalledWith(
      "[AgentEnv] Renderer failure could not be recorded",
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
