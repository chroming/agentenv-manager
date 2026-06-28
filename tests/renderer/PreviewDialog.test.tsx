// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewDialog } from "../../src/renderer/components/PreviewDialog";
import type { ActivationPreview } from "../../src/shared/types";

const preview: ActivationPreview = {
  id: "preview-1",
  profileId: "daily-coding",
  targetId: "opencode",
  createdAt: "2026-06-30T00:00:00.000Z",
  warnings: [],
  errors: [],
  changes: [
    {
      path: "/tmp/home/.config/opencode/opencode.jsonc",
      before: "{}\n",
      after: '{\n  "mcp": {}\n}\n',
      diff: "--- opencode.jsonc\n+++ opencode.jsonc\n@@\n-{}\n+{\"mcp\":{}}\n"
    }
  ],
  liveFingerprints: {},
  targetState: { managedConfigKeys: [], managedMcpNames: [] }
};

afterEach(() => {
  cleanup();
});

describe("PreviewDialog", () => {
  it("renders a structured syntax-highlighted diff", async () => {
    render(<PreviewDialog preview={preview} />);

    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.getByText("1 line before")).toBeInTheDocument();
    expect(screen.getByText("3 lines after")).toBeInTheDocument();

    const diff = await screen.findByRole("table", {
      name: "Formatted diff for /tmp/home/.config/opencode/opencode.jsonc"
    });

    expect(within(diff).getByText("-")).toBeInTheDocument();
    expect(within(diff).getByText("+")).toBeInTheDocument();
    expect(diff).toHaveTextContent("{\"mcp\":{}}");
    expect(diff.querySelector(".diff-row--deletion")).toBeTruthy();
    expect(diff.querySelector(".diff-row--addition")).toBeTruthy();
    expect(diff.querySelector(".syntax-token")).toBeTruthy();
  });

  it("dismisses modal previews with Escape and backdrop clicks", async () => {
    const onCancel = vi.fn();
    render(<PreviewDialog preview={preview} onCancel={onCancel} onConfirm={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Preview" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    const backdrop = dialog.parentElement;
    expect(backdrop).toHaveClass("preview-modal-backdrop");
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
