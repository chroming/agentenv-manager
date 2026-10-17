// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationDeletionDialog } from "../../src/renderer/components/ConversationDeletionDialog";
import type { AgentEnvApi } from "../../src/shared/types";

afterEach(cleanup);
const preview = { previewId: "p", title: "Fixture", files: ["/history/session.jsonl"], sizeBytes: 800, retentionDays: 30 as const, warnings: [] };
it("previews before deleting, keeps failures in the dialog and never retries automatically", async () => {
  const remove = vi.fn().mockRejectedValue(new Error("Changed after preview"));
  window.agentEnv = { previewDeleteConversation: vi.fn().mockResolvedValue(preview), deleteConversation: remove } as unknown as AgentEnvApi;
  const onDeleted = vi.fn(), onClose = vi.fn();
  render(<ConversationDeletionDialog id="one" onClose={onClose} onDeleted={onDeleted} />);
  expect(screen.getByRole("button", { name: "Delete conversation" })).toBeDisabled();
  await screen.findByText("Fixture");
  fireEvent.click(screen.getByRole("button", { name: "Delete conversation" }));
  await screen.findByText(/Changed after preview/);
  expect(onDeleted).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Delete conversation" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("finishes only after the backend commits deletion", async () => {
  let finish!: (value: { backupId: string }) => void;
  window.agentEnv = { previewDeleteConversation: vi.fn().mockResolvedValue(preview), deleteConversation: vi.fn(() => new Promise((resolve) => { finish = resolve; })) } as unknown as AgentEnvApi;
  const onDeleted = vi.fn();
  render(<ConversationDeletionDialog id="one" onClose={vi.fn()} onDeleted={onDeleted} />);
  await screen.findByText("Fixture");
  fireEvent.click(screen.getByRole("button", { name: "Delete conversation" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(onDeleted).not.toHaveBeenCalled();
  finish({ backupId: "backup" });
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("backup"));
});
