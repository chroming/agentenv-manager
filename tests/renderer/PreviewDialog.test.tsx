// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewDialog } from "../../src/renderer/components/PreviewDialog";
import type { ActivationPreview } from "../../src/shared/types";

const preview: ActivationPreview = {
  id: "preview-1",
  profileId: "daily-coding",
  profileContentHash: "profile-hash",
  libraryVersions: { skills: {}, mcp: {} },
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
  resourceChanges: [],
  liveFingerprints: {},
  resourceFingerprints: {},
  sourceFingerprints: {},
  targetState: { managedConfigKeys: [], managedMcpNames: [] }
};

afterEach(() => {
  cleanup();
});

describe("PreviewDialog", () => {
  it("renders a structured syntax-highlighted diff", async () => {
    render(<PreviewDialog preview={preview} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("shows install, replace, and remove resource operations explicitly", () => {
    render(
      <PreviewDialog
        preview={{
          ...preview,
          resourceChanges: [
            { kind: "skill", action: "install", name: "new-skill", path: "/skills/new-skill" },
            { kind: "skill", action: "replace", name: "shared", path: "/skills/shared" },
            { kind: "agent", action: "remove", name: "old.md", path: "/agents/old.md" }
          ]
        }}
      />
    );

    const plan = screen.getByRole("region", { name: "Resource changes" });
    expect(plan).toHaveTextContent("1 install · 1 replace · 1 remove");
    expect(plan).toHaveTextContent("new-skill");
    expect(plan).toHaveTextContent("shared");
    expect(plan).toHaveTextContent("old.md");
    expect(screen.getByText("1 install · 1 replace · 1 remove")).toBeInTheDocument();
  });

  it("requires an explicit acknowledgement for resources omitted on another Target", () => {
    const onAcknowledgedChange = vi.fn();
    render(
      <PreviewDialog
        preview={{
          ...preview,
          targetId: "codex",
          effectivePayload: {
            instructions: 1,
            skills: 2,
            mcpServers: 1,
            agents: 0,
            nativeConfig: 0,
            total: 4
          },
          omissions: [
            {
              kind: "config",
              name: "OpenCode Advanced config",
              reason: "OpenCode Advanced config is not applied to Codex"
            }
          ],
          requiresOmissionAcknowledgement: true
        }}
        omissionsAcknowledged={false}
        onOmissionsAcknowledgedChange={onAcknowledgedChange}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("OpenCode Advanced config")).toBeInTheDocument();
    expect(screen.getByText("Codex will receive 1 instruction file, 2 Skills, 1 MCP server.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I understand these resources will not be applied to Codex"
      })
    );
    expect(onAcknowledgedChange).toHaveBeenCalledWith(true);
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

  it("moves focus into the modal and restores the invoking control on close", () => {
    const PreviewHarness = () => {
      const [isOpen, setIsOpen] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>
            Open preview
          </button>
          {isOpen ? (
            <PreviewDialog
              preview={preview}
              onCancel={() => setIsOpen(false)}
              onConfirm={vi.fn()}
            />
          ) : null}
        </>
      );
    };

    render(<PreviewHarness />);
    const invokingControl = screen.getByRole("button", { name: "Open preview" });
    invokingControl.focus();

    fireEvent.click(invokingControl);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Preview" })).not.toBeInTheDocument();
    expect(invokingControl).toHaveFocus();
  });

  it("wraps Tab from the last modal control to the first", () => {
    render(<PreviewDialog preview={preview} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    const firstControl = dialog.querySelector<HTMLElement>("summary");
    const lastControl = within(dialog).getByRole("button", { name: "Confirm" });
    lastControl.focus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(firstControl).toHaveFocus();
  });

  it("wraps Shift+Tab from the first modal control to the last", () => {
    render(<PreviewDialog preview={preview} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    const firstControl = dialog.querySelector<HTMLElement>("summary");
    const lastControl = within(dialog).getByRole("button", { name: "Confirm" });
    firstControl?.focus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(lastControl).toHaveFocus();
  });

  it("keeps focus inside when the focused Confirm becomes disabled", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const renderDialog = (confirmDisabled: boolean) => (
      <PreviewDialog
        preview={preview}
        confirmDisabled={confirmDisabled}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
    const { rerender } = render(renderDialog(false));
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    const firstControl = dialog.querySelector<HTMLElement>("summary");
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    confirm.focus();

    rerender(renderDialog(true));
    fireEvent.keyDown(document, { key: "Tab" });

    expect(firstControl).toHaveFocus();

    rerender(renderDialog(false));
    within(dialog).getByRole("button", { name: "Confirm" }).focus();
    rerender(renderDialog(true));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("closes only the topmost modal and restores focus inside the outer dialog", () => {
    const outerCancel = vi.fn();
    const innerCancel = vi.fn();
    const NestedPreviewHarness = () => {
      const [isOuterOpen, setIsOuterOpen] = useState(false);
      const [isInnerOpen, setIsInnerOpen] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setIsOuterOpen(true)}>
            Open outer preview
          </button>
          {isOuterOpen ? (
            <PreviewDialog
              preview={preview}
              title="Outer preview"
              cancelLabel="Close outer"
              confirmLabel="Open inner preview"
              onCancel={() => {
                outerCancel();
                setIsOuterOpen(false);
              }}
              onConfirm={() => setIsInnerOpen(true)}
            />
          ) : null}
          {isInnerOpen ? (
            <PreviewDialog
              preview={preview}
              title="Inner preview"
              cancelLabel="Close inner"
              confirmLabel="Confirm inner"
              onCancel={() => {
                innerCancel();
                setIsInnerOpen(false);
              }}
              onConfirm={vi.fn()}
            />
          ) : null}
        </>
      );
    };

    render(<NestedPreviewHarness />);
    const outerTrigger = screen.getByRole("button", { name: "Open outer preview" });
    outerTrigger.focus();
    fireEvent.click(outerTrigger);
    const outerConfirm = screen.getByRole("button", { name: "Open inner preview" });
    outerConfirm.focus();
    fireEvent.click(outerConfirm);

    expect(screen.getAllByRole("dialog", { name: "Preview" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Close inner" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(innerCancel).toHaveBeenCalledTimes(1);
    expect(outerCancel).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog", { name: "Preview" })).toHaveLength(1);
    expect(screen.getByText("Outer preview")).toBeInTheDocument();
    expect(outerConfirm).toHaveFocus();
  });
});
