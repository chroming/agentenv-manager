// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffWorkspaceDialog } from "../../src/renderer/components/DiffWorkspaceDialog";
import type { PlannedFileChange } from "../../src/shared/types";

afterEach(cleanup);

const changes: PlannedFileChange[] = [
  {
    path: "/tmp/project/SKILL.md",
    before: "old\n",
    after: "new\n",
    diff: "--- SKILL.md\n+++ SKILL.md\n@@ -1,1 +1,1 @@\n-old\n+new\n"
  },
  {
    path: "/tmp/project/references/guide.md",
    before: "before\n",
    after: "after\n",
    diff: "--- guide.md\n+++ guide.md\n@@ -1,1 +1,1 @@\n-before\n+after\n"
  }
];

describe("DiffWorkspaceDialog", () => {
  it("shows only files that have selectable preview content", () => {
    render(
      <DiffWorkspaceDialog
        changes={changes}
        open
        title="Skill update"
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Full-screen preview" });
    expect(dialog).toHaveClass("is-maximized");
    expect(within(dialog).getByText("/tmp/project")).toBeInTheDocument();
    expect(dialog.querySelector('[data-file-icon="docs"]')).toBeInTheDocument();
    expect(dialog.querySelectorAll('[data-file-icon="markdown"]')).toHaveLength(2);
    expect(within(dialog).getAllByRole("button").filter((button) =>
      button.closest(".diff-workspace__tree")
    ).every((button) => button.getAttribute("aria-disabled") !== "true")).toBe(true);
    expect(within(dialog).getByRole("button", { name: "references" }))
      .toHaveClass("has-changes");
    expect(within(dialog).getByRole("table", {
      name: "Formatted diff for /tmp/project/SKILL.md"
    })).toHaveTextContent("old");

    fireEvent.click(within(dialog).getByRole("button", { name: "guide.md" }));
    expect(within(dialog).getByRole("table", {
      name: "Formatted diff for /tmp/project/references/guide.md"
    })).toHaveTextContent("after");

    expect(within(dialog).queryByRole("button", { name: "Maximize preview" })).toBeNull();
  });

  it("resizes the file tree by keyboard and closes with Escape", () => {
    const onClose = vi.fn();
    render(
      <DiffWorkspaceDialog
        changes={changes}
        open
        title="Skill update"
        onClose={onClose}
      />
    );

    const splitter = screen.getByRole("separator", { name: "Resize file tree" });
    expect(splitter).toHaveAttribute("aria-valuenow", "248");
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(splitter).toHaveAttribute("aria-valuenow", "264");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens readonly files when they share a tree with changed files", () => {
    render(
      <DiffWorkspaceDialog
        changes={changes.slice(0, 1)}
        readonlyFiles={[{
          path: "/tmp/project/README.md",
          content: "# Project notes\n"
        }]}
        open
        title="Skill update"
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Full-screen preview" });
    fireEvent.click(within(dialog).getByRole("button", { name: "README.md" }));

    expect(within(dialog).getByText("# Project notes")).toBeInTheDocument();
    expect(within(dialog).getByText("/tmp/project/README.md")).toBeInTheDocument();
  });
});
