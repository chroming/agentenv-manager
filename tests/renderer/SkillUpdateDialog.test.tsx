// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("keeps Agent copy updates off by default and passes an explicit opt-in", () => {
    const onConfirm = vi.fn().mockResolvedValue({ status: "completed" as const });
    const plan = planWithChanges(1);
    plan.impact.copiedInstallCount = 2;
    render(
      <SkillUpdateDialog plan={plan} onClose={vi.fn()} onConfirm={onConfirm} />
    );

    expect(screen.getByText("Off: 2 Agent copies will show Apply pending."))
      .toBeInTheDocument();
    expect(screen.getByText("Update Skill", { selector: ".ui-button__label" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Also update Agent copies" }));
    expect(screen.getByText("2 clean managed copies will update in the same backed-up operation."))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply update claude-api" }));

    expect(onConfirm).toHaveBeenCalledWith(plan, true);
  });

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
    expect(within(workspace).getByRole("button", { name: "SKILL.md" })).toBeEnabled();
    expect(within(workspace).getByRole("button", { name: "file-1.md" })).toBeEnabled();
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
    const onConfirm = vi.fn().mockResolvedValue({ status: "failed" as const });
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
    expect(within(dialog).queryByText("Update Skill", { selector: ".ui-button__label" })).toBeNull();

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
    expect(onConfirm).toHaveBeenCalledWith(plan, false);
  });

  it("auto-closes only after the update and Library reconciliation both complete", async () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const onConfirm = vi.fn().mockResolvedValue({ status: "completed" as const });
      const plan = planWithChanges(1);
      const { rerender } = render(
        <SkillUpdateDialog
          plan={plan}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Apply update claude-api" }));
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(onClose).not.toHaveBeenCalled();

      rerender(
        <SkillUpdateDialog
          plan={plan}
          progress={{ status: "updated" }}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );
      await act(async () => {
        vi.advanceTimersByTime(699);
      });
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a partially reconciled update open with its actionable error", async () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const onConfirm = vi.fn().mockResolvedValue({
        status: "partial" as const,
        error: "Library view could not be refreshed"
      });
      const plan = planWithChanges(1);
      const { rerender } = render(
        <SkillUpdateDialog plan={plan} onClose={onClose} onConfirm={onConfirm} />
      );

      fireEvent.click(screen.getByRole("button", { name: "Apply update claude-api" }));
      await act(async () => {
        await Promise.resolve();
      });
      rerender(
        <SkillUpdateDialog
          plan={plan}
          progress={{ status: "updated" }}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );

      expect(screen.getByRole("status", { name: "claude-api: Updated with issues" }))
        .toHaveTextContent("Library view could not be refreshed");
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
