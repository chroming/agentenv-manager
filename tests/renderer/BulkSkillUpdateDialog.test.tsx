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
    const stopButton = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "Reviewer: Updating..." })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  });
});
