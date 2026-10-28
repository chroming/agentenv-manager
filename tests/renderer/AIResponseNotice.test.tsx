// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEnvApi } from "../../src/shared/types";
import type { AIRequestProgress } from "../../src/shared/aiReliability";
import { AIOriginalResponse, AIResponseNotice } from "../../src/renderer/components/AIResponseNotice";
import { AIErrorNotice } from "../../src/renderer/components/AIErrorNotice";
import { useAIRequestProgress } from "../../src/renderer/hooks/useAIRequestProgress";
import { useRef } from "react";

afterEach(cleanup);
describe("shared AI recovery feedback", () => {
  it("retains unknown and malformed content without presenting it as a complete result", () => {
    const result = { responseIssues: ["invalid-items", "unclassified"] as const, unparsedOutput: '{"finding":"inspect this"}' };
    const output = { ...result, responseIssues: [...result.responseIssues] };
    render(<><AIResponseNotice result={output} /><AIOriginalResponse result={output} /></>);
    expect(screen.getByRole("status")).toHaveTextContent("Some returned findings could not be displayed");
    expect(screen.getByText("Original AI response")).toBeInTheDocument();
  });
  it("retries saving only after a click and preserves the result while busy", () => {
    const save = vi.fn(); const result = { savePending: true };
    const view = render(<AIResponseNotice result={result} onRetrySave={save} />);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry saving" })); expect(save).toHaveBeenCalledTimes(1);
    view.rerender(<AIResponseNotice result={result} onRetrySave={save} busy />);
    expect(screen.getByRole("button", { name: "Retry saving" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("does not call the AI service again");
  });
  it("makes parameter errors configurable rather than blindly retrying", () => {
    const retry = vi.fn(); const configure = vi.fn();
    render(<AIErrorNotice message="AI service returned HTTP 400. The model rejected response_format." onRetry={retry} onConfigure={configure} />);
    fireEvent.click(screen.getByRole("button", { name: "Configure AI service" }));
    expect(configure).toHaveBeenCalledOnce(); expect(retry).not.toHaveBeenCalled();
  });
  it("keeps temporary errors as explicit manual retries", () => {
    const retry = vi.fn(); render(<AIErrorNotice message="AI service returned HTTP 503." onRetry={retry} />);
    expect(retry).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("does not leak progress from a different or previous request", async () => {
    let emit!: (value: AIRequestProgress) => void; const unsubscribe = vi.fn();
    window.agentEnv = { onAIRequestProgress: (callback: (value: AIRequestProgress) => void) => { emit = callback; return unsubscribe; } } as unknown as AgentEnvApi;
    function Probe({ id }: { id: string }) { const request = useRef(id); request.current = id; return <span>{useAIRequestProgress(request) ?? "idle"}</span>; }
    const view = render(<Probe id="one" />);
    act(() => emit({ requestId: "other", phase: "receiving" })); expect(screen.getByText("idle")).toBeInTheDocument();
    act(() => emit({ requestId: "one", phase: "waiting" })); expect(screen.getByText("Waiting for AI service")).toBeInTheDocument();
    view.rerender(<Probe id="two" />); expect(screen.getByText("idle")).toBeInTheDocument();
    act(() => emit({ requestId: "one", phase: "saving" })); expect(screen.getByText("idle")).toBeInTheDocument();
    view.unmount(); await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
  });
});
