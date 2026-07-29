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
  it("provides a selectable file tree and maximizable read-only diff surface", () => {
    render(
      <DiffWorkspaceDialog
        changes={changes}
        open
        title="Skill update"
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Expanded diff preview" });
    expect(within(dialog).getByText("/tmp/project")).toBeInTheDocument();
    expect(within(dialog).getByRole("table", {
      name: "Formatted diff for /tmp/project/SKILL.md"
    })).toHaveTextContent("old");

    fireEvent.click(within(dialog).getByRole("button", { name: "guide.md" }));
    expect(within(dialog).getByRole("table", {
      name: "Formatted diff for /tmp/project/references/guide.md"
    })).toHaveTextContent("after");

    fireEvent.click(within(dialog).getByRole("button", { name: "Maximize preview" }));
    expect(dialog).toHaveClass("is-maximized");
    expect(within(dialog).getByRole("button", { name: "Restore preview size" }))
      .toBeEnabled();
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
});
