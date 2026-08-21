// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkSkillUpdateDialog } from "../../src/renderer/components/BulkSkillUpdateDialog";
import type { SkillUpdatePlan } from "../../src/shared/types";

afterEach(cleanup);

const plan: SkillUpdatePlan = {
  id: "reviewer",
  previewId: "preview-reviewer",
  name: "Reviewer",
  sourceType: "github",
  updateAvailable: true,
  changes: [{ action: "write", path: "SKILL.md", before: "old", after: "new", diff: "" }],
  errors: [],
  impact: {
    profileNames: [],
    linkedInstallCount: 0,
    linkedTargetIds: [],
    copiedInstallCount: 0,
    copiedTargetIds: []
  }
};

describe("BulkSkillUpdateDialog", () => {
  it("applies one explicit Agent-copy choice to the whole update queue", () => {
    const onUpdate = vi.fn();
    const copiedPlan = {
      ...plan,
      impact: { ...plan.impact, copiedInstallCount: 3 }
    };
    render(
      <BulkSkillUpdateDialog
        plans={[copiedPlan]}
        failures={[]}
        updateRun={{}}
        isBusy={false}
        previewingAllUpdates={false}
        updateActivityBusy={false}
        stopRequested={false}
        onClose={vi.fn()}
        onPreview={vi.fn()}
        onStop={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    expect(screen.getByText("Off: 3 Agent copies will show Apply pending."))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Also update Agent copies" }));
    fireEvent.click(screen.getByRole("button", { name: "Update 1 skill" }));

    expect(onUpdate).toHaveBeenCalledWith([copiedPlan], true);
  });

  it("keeps multiple preview failures inside the scrolling body below the copy option", () => {
    render(
      <BulkSkillUpdateDialog
        plans={[{
          ...plan,
          impact: { ...plan.impact, copiedInstallCount: 2 }
        }]}
        failures={[
          { id: "ljg-book", error: "GitHub API rate limit reached (429 Too Many Requests)" },
          { id: "yao-meta-skill", error: "GitHub API rate limit reached (429 Too Many Requests)" }
        ]}
        updateRun={{}}
        isBusy={false}
        previewingAllUpdates={false}
        updateActivityBusy={false}
        stopRequested={false}
        onClose={vi.fn()}
        onPreview={vi.fn()}
        onStop={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Update all skills" });
    const body = dialog.querySelector<HTMLElement>(".bulk-update-body");
    const option = screen.getByText("Also update Agent copies")
      .closest<HTMLElement>(".skill-update-copy-option");
    const failures = screen.getByRole("region", { name: "Preview failures" });

    expect(body).toContainElement(option);
    expect(body).toContainElement(failures);
    expect(option?.nextElementSibling).toContainElement(failures);
    expect(failures).toHaveTextContent("2 update previews could not be prepared");
    expect(failures).toHaveTextContent("ljg-book");
    expect(failures).toHaveTextContent("yao-meta-skill");
    expect(screen.getByRole("status", { name: "1 Skills ready to update" }))
      .toHaveAttribute("data-tone", "neutral");
  });

  it("uses the standard preview controls and can stop an active queue", () => {
    const onStop = vi.fn();
    render(
      <BulkSkillUpdateDialog
        plans={[plan]}
        failures={[]}
        updateRun={{ reviewer: { status: "updating" } }}
        isBusy
        previewingAllUpdates={false}
        updateActivityBusy
        stopRequested={false}
        onClose={vi.fn()}
        onPreview={vi.fn()}
        onStop={onStop}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Maximize preview" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Updating 0 of 1" }))
      .toHaveAttribute("data-tone", "accent");
    const stopButton = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "Reviewer: Updating..." })).toBeInTheDocument();
  });

  it("keeps preview-only failures actionable instead of reporting an empty success", () => {
    render(
      <BulkSkillUpdateDialog
        plans={[]}
        failures={[{ id: "missing", error: "Source no longer contains SKILL.md" }]}
        updateRun={{}}
        isBusy={false}
        previewingAllUpdates={false}
        updateActivityBusy={false}
        stopRequested={false}
        onClose={vi.fn()}
        onPreview={vi.fn()}
        onStop={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByRole("status", { name: "Update previews need attention" }))
      .toHaveAttribute("data-tone", "warning");
    expect(screen.getByRole("button", { name: "Retry failed previews" }))
      .toHaveClass("ui-button--primary");
    expect(screen.getByRole("button", { name: "Cancel" }))
      .toHaveClass("ui-button--secondary");
  });

  it("shows skipped items with the same progress grammar", () => {
    render(
      <BulkSkillUpdateDialog
        plans={[plan]}
        failures={[]}
        updateRun={{ reviewer: { status: "skipped" } }}
        isBusy={false}
        previewingAllUpdates={false}
        updateActivityBusy={false}
        stopRequested
        onClose={vi.fn()}
        onPreview={vi.fn()}
        onStop={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByRole("status", { name: "Reviewer: Skipped" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Updates finished with issues" }))
      .toHaveAttribute("data-tone", "warning");
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  });

  it("makes the completed result and its only exit visually decisive", () => {
    render(
      <BulkSkillUpdateDialog
        plans={[plan]}
        failures={[]}
        updateRun={{ reviewer: { status: "updated" } }}
        isBusy={false}
        previewingAllUpdates={false}
        updateActivityBusy={false}
        stopRequested={false}
        onClose={vi.fn()}
        onPreview={vi.fn()}
        onStop={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByRole("status", { name: "All 1 Skills updated" }))
      .toHaveAttribute("data-tone", "success");
    expect(screen.getByRole("button", { name: "Close" }))
      .toHaveClass("ui-button--primary");
  });
});
