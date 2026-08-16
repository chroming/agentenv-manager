// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedSkillAreaModeActions } from "../../src/renderer/components/SharedSkillAreaWorkflow";

afterEach(cleanup);

describe("SharedSkillAreaModeActions", () => {
  it("separates stable folder policy from the Profiles migration command", () => {
    const onChange = vi.fn();
    const onMoveToProfiles = vi.fn();

    render(
      <SharedSkillAreaModeActions
        disabled={false}
        canMoveToProfiles
        canRestore={false}
        onChange={onChange}
        onMoveToProfiles={onMoveToProfiles}
        onShowRestorePoints={vi.fn()}
      />
    );

    expect(screen.getByRole("group", { name: "Shared folder policy" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave unchanged" }))
      .toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Leave unchanged" }));
    expect(onChange).toHaveBeenCalledWith("keep");
    const moveButton = screen.getByRole("button", { name: "Move and remove shared copies…" });
    expect(moveButton).toHaveClass("ui-button--warning");
    fireEvent.click(moveButton);
    expect(onMoveToProfiles).toHaveBeenCalledTimes(1);
  });

  it("shows migration recovery instead of a false symmetric policy switch", () => {
    const onShowRestorePoints = vi.fn();
    const onMoveToProfiles = vi.fn();

    render(
      <SharedSkillAreaModeActions
        mode="profiles-only"
        disabled={false}
        canMoveToProfiles
        canRestore
        onChange={vi.fn()}
        onMoveToProfiles={onMoveToProfiles}
        onShowRestorePoints={onShowRestorePoints}
      />
    );

    expect(screen.queryByRole("group", { name: "Shared folder policy" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "Move and remove new shared copies…"
    }));
    expect(onMoveToProfiles).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Restore shared setup…" }));
    expect(onShowRestorePoints).toHaveBeenCalledTimes(1);
  });
});
