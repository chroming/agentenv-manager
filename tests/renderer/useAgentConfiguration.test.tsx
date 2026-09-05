// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileSummary, TargetInfo, TargetManagementState } from "../../src/shared/types";
import { useAgentConfiguration } from "../../src/renderer/hooks/useAgentConfiguration";

afterEach(cleanup);

const target = { id: "ssh:device:codex", name: "Codex on server", location: { kind: "ssh" }, health: { canWrite: true } } as TargetInfo;
const profiles = [{ id: "daily", name: "Daily" }] as ProfileSummary[];

function mount(states: TargetManagementState[] = [], selectedTarget = target) {
  const callbacks = { onSelect: vi.fn(), onCapture: vi.fn(), onCreate: vi.fn() };
  function Harness() {
    const setup = useAgentConfiguration({ profiles, targets: [selectedTarget], states, ...callbacks });
    return <><button onClick={() => setup.openAgentConfiguration(selectedTarget.id)}>Configure</button>{setup.agentConfigurationDialog}</>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText("Configure"));
  return callbacks;
}

describe("explicit Agent configuration", () => {
  it("never guesses an SSH Profile and preserves the exact endpoint on selection", () => {
    const callbacks = mount();
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use selected Profile" })).toBeDisabled();
    expect(screen.getByText(/Remote capture is not supported/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "daily" } });
    fireEvent.click(screen.getByRole("button", { name: "Use selected Profile" }));
    expect(callbacks.onSelect).toHaveBeenCalledWith("daily", target.id);
    expect(callbacks.onCapture).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens only the Profile actually active on this endpoint", () => {
    const callbacks = mount([{ targetId: target.id, activeProfileId: "daily" }] as TargetManagementState[]);
    expect(callbacks.onSelect).toHaveBeenCalledWith("daily", target.id);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates an empty remote Profile without invoking local capture", () => {
    const callbacks = mount();
    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));
    expect(callbacks.onCreate).toHaveBeenCalledWith(target.id);
    expect(callbacks.onCapture).not.toHaveBeenCalled();
  });

  it("requires an explicit local capture choice and supports Escape without side effects", () => {
    const local = { ...target, id: "codex", location: undefined };
    const callbacks = mount([], local);
    expect(callbacks.onCapture).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Configure"));
    fireEvent.click(screen.getByRole("button", { name: "Create from current environment" }));
    expect(callbacks.onCapture).toHaveBeenCalledWith("codex");
  });
});
