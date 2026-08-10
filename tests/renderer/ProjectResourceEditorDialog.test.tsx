// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectResourceEditorDialog } from "../../src/renderer/components/ProjectResourceEditorDialog";
import type { AgentEnvApi } from "../../src/shared/types";

const file = {
  resourceId: "instruction-1",
  name: "AGENTS.md",
  path: "/work/example/AGENTS.md",
  content: "# Original\n",
  contentHash: "original-hash",
  modifiedAt: "2026-08-06T00:00:00.000Z",
  editable: true
};

const installApi = () => {
  const api = {
    readProjectResource: vi.fn().mockResolvedValue(file),
    prepareProjectInstruction: vi.fn().mockResolvedValue({
      agentId: "opencode",
      name: "AGENTS.md",
      path: "/work/example/AGENTS.md",
      content: "",
      contentHash: "absent",
      editable: true
    }),
    saveProjectResource: vi.fn().mockResolvedValue({
      status: "saved",
      contentHash: "saved-hash",
      receiptId: "receipt-1"
    }),
    createProjectInstruction: vi.fn().mockResolvedValue({
      status: "saved",
      contentHash: "created-hash",
      receiptId: "receipt-created"
    })
  };
  Object.defineProperty(window, "agentEnv", {
    configurable: true,
    value: api as unknown as AgentEnvApi
  });
  return api;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectResourceEditorDialog", () => {
  it("keeps Save disabled for a no-op and saves against the opened content hash", async () => {
    const api = installApi();
    const onSaved = vi.fn();
    render(
      <ProjectResourceEditorDialog
        open
        projectId="project-1"
        resourceId="instruction-1"
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    const dialog = await screen.findByRole("dialog", { name: "Workspace instruction" });
    expect(await within(dialog).findByLabelText("Preview of AGENTS.md"))
      .toHaveTextContent("# Original");
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    const editor = within(dialog).getByRole("textbox", { name: "Workspace instruction content" });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.saveProjectResource).toHaveBeenCalledWith({
      projectId: "project-1",
      resourceId: "instruction-1",
      expectedHash: "original-hash",
      content: "# Updated\n"
    }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: "saved" }));
  });

  it("uses the shared resizable editor window", async () => {
    installApi();
    render(
      <ProjectResourceEditorDialog
        open
        projectId="project-1"
        resourceId="instruction-1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const dialog = await screen.findByRole("dialog", { name: "Workspace instruction" });
    await within(dialog).findByLabelText("Preview of AGENTS.md");
    fireEvent.click(screen.getByRole("button", { name: "Maximize preview" }));
    expect(dialog).toHaveClass("instruction-document-dialog", "is-maximized");
    fireEvent.click(screen.getByRole("button", { name: "Restore preview size" }));
    expect(dialog).not.toHaveClass("is-maximized");
  });

  it("requires an explicit discard decision and exposes stale reload", async () => {
    const api = installApi();
    api.saveProjectResource.mockRejectedValueOnce(
      new Error("Project instruction changed outside AgentEnv. Reload it before saving.")
    );
    const onClose = vi.fn();
    render(
      <ProjectResourceEditorDialog
        open
        projectId="project-1"
        resourceId="instruction-1"
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );

    const dialog = await screen.findByRole("dialog", { name: "Workspace instruction" });
    await within(dialog).findByLabelText("Preview of AGENTS.md");
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    const editor = await within(dialog).findByRole("textbox", { name: "Workspace instruction content" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("keeps a missing instruction as a draft until Save creates it", async () => {
    const api = installApi();
    const onClose = vi.fn();
    render(
      <ProjectResourceEditorDialog
        open
        projectId="project-1"
        agentId="opencode"
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );

    const dialog = await screen.findByRole("dialog", { name: "Workspace instruction" });
    const editor = await within(dialog).findByRole("textbox", { name: "Workspace instruction content" });
    expect(api.createProjectInstruction).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: "# New project rules\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.createProjectInstruction).toHaveBeenCalledWith({
      projectId: "project-1",
      agentId: "opencode",
      content: "# New project rules\n"
    }));
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("Preview of AGENTS.md"))
      .toHaveTextContent("# New project rules");
  });
});
