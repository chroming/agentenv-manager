// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    saveProjectResource: vi.fn().mockResolvedValue({
      status: "saved",
      contentHash: "saved-hash",
      receiptId: "receipt-1"
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

    const editor = await screen.findByRole("textbox", { name: "Project instruction content" });
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

    const editor = await screen.findByRole("textbox", { name: "Project instruction content" });
    fireEvent.change(editor, { target: { value: "# Updated\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
