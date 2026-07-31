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
  it("opens maximized with a complete aligned tree that marks changed context", () => {
    render(
      <DiffWorkspaceDialog
        changes={changes}
        filePaths={[
          "/tmp/project/SKILL.md",
          "/tmp/project/references/guide.md",
          "/tmp/project/references/unchanged.md"
        ]}
        open
        title="Skill update"
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Full-screen preview" });
    expect(dialog).toHaveClass("is-maximized");
    expect(within(dialog).getByText("/tmp/project")).toBeInTheDocument();
    expect(dialog.querySelector('[data-file-icon="docs"]')).toBeInTheDocument();
    expect(dialog.querySelectorAll('[data-file-icon="markdown"]')).toHaveLength(3);
    expect(within(dialog).getByRole("button", { name: "unchanged.md" }))
      .toHaveAttribute("aria-disabled", "true");
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
});
