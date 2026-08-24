// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstructionsWorkspace } from "../../src/renderer/components/InstructionsWorkspace";
import type { InstructionBlock } from "../../src/shared/types";

afterEach(cleanup);

const block: InstructionBlock = {
  id: "review-rules",
  name: "Review rules",
  description: "Consistent review guidance",
  iconKey: "book",
  content: "# Review\nCheck behavior.\n",
  contentHash: "hash",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T01:00:00.000Z",
  path: "/data/instructions-library/review-rules/CONTENT.md",
  usedByProfiles: ["Daily"]
};

describe("InstructionsWorkspace", () => {
  it("uses the shared list-detail pattern and protects referenced Blocks", () => {
    render(
      <InstructionsWorkspace
        blocks={[block]}
        loading={false}
        onCreate={vi.fn()}
        onImport={vi.fn()}
        onRefresh={vi.fn()}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getAllByText("Review rules").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Consistent review guidance")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Review rules" }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Delete" }))
      .toHaveAttribute("title", "Remove this Block from its Profiles before deleting it");
  });

  it("opens imported content in the same editor used for a new Block", async () => {
    render(
      <InstructionsWorkspace
        blocks={[]}
        loading={false}
        onCreate={vi.fn()}
        onImport={vi.fn().mockResolvedValue({
          name: "Imported rules",
          path: "/tmp/rules.md",
          content: "# Imported\n"
        })}
        onRefresh={vi.fn()}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const dialog = await screen.findByRole("dialog", { name: "New Instruction Block" });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Imported rules")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Instruction content" }))
      .toHaveValue("# Imported\n");
    fireEvent.click(screen.getByRole("button", { name: "Maximize preview" }));
    expect(dialog).toHaveClass("is-maximized");
  });

  it("offers the same preview and edit actions from the row context menu", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <InstructionsWorkspace
        blocks={[block]}
        loading={false}
        onCreate={vi.fn()}
        onImport={vi.fn()}
        onRefresh={vi.fn()}
        onRemove={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    const row = screen.getByRole("button", { name: "Review rules" });
    fireEvent.contextMenu(row, { clientX: 40, clientY: 50 });
    expect(screen.getByRole("menu", { name: "Instruction actions" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview" }));
    const preview = screen.getByRole("dialog", { name: "Instruction document" });
    expect(within(preview).getByLabelText("Preview of CONTENT.md").querySelector(".syntax-code-preview"))
      .toBeInTheDocument();
    fireEvent.click(within(preview).getAllByRole("button", { name: "Close" }).at(-1)!);

    fireEvent.contextMenu(row, { clientX: 40, clientY: 50 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Change icon for Review rules" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Code" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(block, expect.objectContaining({
      iconKey: "code"
    })));
  });
});
