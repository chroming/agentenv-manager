// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillDeploymentUpgradeDialog } from "../../src/renderer/components/SkillDeploymentUpgradeDialog";

afterEach(cleanup);

describe("SkillDeploymentUpgradeDialog", () => {
  it("explains that existing links change only after a later Preview and Apply", () => {
    render(
      <SkillDeploymentUpgradeDialog
        busy={false}
        currentMethod="copy"
        linkedInstallCount={3}
        open
        onDismiss={vi.fn()}
        onDecide={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "Choose Skill deployment" }))
      .toHaveTextContent("3 existing live links stay unchanged now");
    expect(screen.getByText(/only when you next Preview and Apply/)).toBeInTheDocument();
  });

  it("lets an existing user retain Live link explicitly", () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(
      <SkillDeploymentUpgradeDialog
        busy={false}
        currentMethod="copy"
        linkedInstallCount={1}
        open
        onDismiss={vi.fn()}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: /Live link/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use this deployment" }));
    expect(onDecide).toHaveBeenCalledWith("symlink");
  });
});
