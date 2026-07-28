// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticIssueDialog } from "../../src/renderer/components/DiagnosticIssueDialog";
import type { AgentEnvApi, DiagnosticIssueDetail } from "../../src/shared/types";

const issue: DiagnosticIssueDetail = {
  reference: "AEM-20260728-ABC123",
  action: "activation:apply",
  category: "activation",
  occurredAt: "2026-07-28T12:00:00.000Z",
  durationMs: 57,
  context: { targetId: "codex", profileId: "daily-coding" },
  error: {
    name: "Error",
    message: "Apply failed",
    code: "EEXIST",
    stack: "Error: Apply failed\n at apply",
    causes: [
      {
        name: "Error",
        message: "Skill path occupied",
        code: "EEXIST"
      }
    ]
  },
  events: []
};

describe("DiagnosticIssueDialog", () => {
  it("shows selectable original details and supports copy, export, Escape, and backdrop close", async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    const exportDiagnostics = vi.fn().mockResolvedValue("/tmp/diagnostics.json");
    Object.defineProperty(window, "agentEnv", {
      configurable: true,
      value: {
        copyText,
        exportDiagnostics
      } as unknown as AgentEnvApi
    });
    const onDismiss = vi.fn();
    const { rerender } = render(
      <DiagnosticIssueDialog issue={issue} onDismiss={onDismiss} />
    );

    expect(screen.getByRole("dialog", { name: "Diagnostic details" })).toHaveTextContent(
      "AEM-20260728-ABC123"
    );
    expect(screen.getByText(/Skill path occupied/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith(expect.stringContaining("Context:"))
    );
    fireEvent.click(screen.getByRole("button", { name: "Export report" }));
    await waitFor(() =>
      expect(exportDiagnostics).toHaveBeenCalledWith(issue.reference)
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    onDismiss.mockClear();
    rerender(<DiagnosticIssueDialog issue={issue} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
