// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillUpdateDialog } from "../../src/renderer/components/SkillUpdateDialog";
import type { SkillUpdatePlan } from "../../src/shared/types";

afterEach(cleanup);

const planWithChanges = (count: number): SkillUpdatePlan => ({
  id: "claude-api",
  previewId: "preview-1",
  name: "claude-api",
  sourceType: "github",
  currentRevision: "2492a1a",
  latestRevision: "adba0a5",
  updateAvailable: true,
  filePaths: [
    ...Array.from({ length: count }, (_, index) =>
      index === 0 ? "SKILL.md" : `references/file-${index}.md`
    ),
    "references/unchanged.md"
  ],
  changes: Array.from({ length: count }, (_, index) => ({
    path: index === 0 ? "SKILL.md" : `references/file-${index}.md`,
    before: `old ${index}\n`,
    after: `new ${index}\n`,
    diff: [
      `--- ${index === 0 ? "SKILL.md" : `references/file-${index}.md`}`,
      `+++ ${index === 0 ? "SKILL.md" : `references/file-${index}.md`}`,
      "@@ -1,1 +1,1 @@",
      `-old ${index}`,
      `+new ${index}`
    ].join("\n")
  })),
  errors: [],
  impact: {
    profileNames: [],
    linkedInstallCount: 0,
    linkedTargetIds: [],
    copiedInstallCount: 0,
    copiedTargetIds: []
  }
});

describe("SkillUpdateDialog", () => {
  it("renders a large change set as a file list and mounts diffs on demand", () => {
    render(
      <SkillUpdateDialog
        plan={planWithChanges(50)}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "Update preview for claude-api" }))
      .toHaveTextContent("50 file changes");
    const details = [...document.querySelectorAll<HTMLDetailsElement>(
      ".skill-update-dialog .update-change-list > details"
    )];
    expect(details).toHaveLength(50);
    expect(details[0]?.open).toBe(true);
    expect(details.slice(1).every((detail) => !detail.open)).toBe(true);
    expect(details[0]?.querySelector("summary")).toHaveTextContent("SKILL.md");
    expect(details[0]).toHaveTextContent("old 0");
    expect(document.querySelectorAll(".skill-update-dialog .diff-viewer")).toHaveLength(1);

    details[49]!.open = true;
    fireEvent(details[49]!, new Event("toggle"));
    expect(document.querySelectorAll(".skill-update-dialog .diff-viewer")).toHaveLength(2);
  });

  it("opens the shared diff workspace without dismissing the update preview", () => {
    const onClose = vi.fn();
    render(
      <SkillUpdateDialog
        plan={planWithChanges(2)}
        onClose={onClose}
        onConfirm={vi.fn()}
      />
    );

    const parent = screen.getByRole("dialog", { name: "Update preview for claude-api" });
    const expand = within(parent).getByRole("button", { name: "Maximize preview" });
    fireEvent.click(expand);

    const workspace = screen.getByRole("dialog", { name: "Full-screen preview" });
    expect(workspace).toHaveClass("is-maximized");
    expect(within(workspace).getByRole("button", { name: "unchanged.md" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(parent).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Full-screen preview" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Update preview for claude-api" }))
      .toBeInTheDocument();
    expect(expand).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and replaces Update with completion or retry state", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const plan = planWithChanges(1);
    const { rerender } = render(
      <SkillUpdateDialog
        plan={plan}
        progress={{ status: "updating" }}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Update preview for claude-api" });
    expect(within(dialog).getByRole("status", { name: "claude-api: Updating..." }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Updating claude-api" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

    rerender(
      <SkillUpdateDialog
        plan={plan}
        progress={{ status: "updated" }}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByRole("dialog", { name: "Update preview for claude-api" }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("status", { name: "claude-api: Done" }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
    expect(within(dialog).queryByRole("button", { name: "Update skill" })).toBeNull();

    rerender(
      <SkillUpdateDialog
        plan={plan}
        progress={{ status: "failed", error: "Source changed" }}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );
    expect(within(dialog).getByText("Source changed")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry update claude-api" }));
    expect(onConfirm).toHaveBeenCalledWith(plan);
  });
});
