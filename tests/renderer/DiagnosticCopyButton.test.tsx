// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Notice } from "../../src/renderer/components/ui/Notice";
import { DiagnosticMessage } from "../../src/renderer/components/ui/DiagnosticCopyButton";
import type { AgentEnvApi } from "../../src/shared/types";

afterEach(cleanup);
const message = "Request failed. Diagnostic reference: AEM-20260918-ABC123";
const install = () => {
  const readDiagnosticIssue = vi.fn().mockResolvedValue({ reference: "AEM-20260918-ABC123", action: "skill-summaries:generate",
    occurredAt: "2026-09-18T12:00:00Z", error: { name: "Error", message: "Request failed", stack: "at generate", causes: [] } });
  const copyText = vi.fn().mockResolvedValue(undefined);
  window.agentEnv = { readDiagnosticIssue, copyText } as unknown as AgentEnvApi;
  return { readDiagnosticIssue, copyText };
};

it("copies full diagnostics from an inline notice without leaving the current dialog", async () => {
  const api = install();
  render(<Notice role="alert" tone="warning" actions={<button>Retry</button>}>{message}</Notice>);
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
  await screen.findByRole("button", { name: "Copied" });
  expect(api.readDiagnosticIssue).toHaveBeenCalledWith("AEM-20260918-ABC123");
  expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining("Stack:\nat generate"));
});

it("falls back to the original message when the diagnostic record cannot be read", async () => {
  const api = install();
  api.readDiagnosticIssue.mockRejectedValue(new Error("Missing report"));
  render(<DiagnosticMessage message={message} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
  await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(message));
});

it("does not add a meaningless copy action to ordinary notices and allows retry after clipboard failure", async () => {
  const api = install();
  const { rerender } = render(<Notice>Ordinary information</Notice>);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  api.copyText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
  rerender(<Notice>{message}</Notice>);
  fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
  fireEvent.click(await screen.findByRole("button", { name: "Copy failed. Try again." }));
  await screen.findByRole("button", { name: "Copied" });
});
