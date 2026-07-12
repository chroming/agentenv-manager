// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RefreshCw } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge, Button, ControlGroup, IconButton, ModalFrame, Switch } from "../../src/renderer/components/ui";
import { OverflowTooltip } from "../../src/renderer/components/OverflowTooltip";

afterEach(cleanup);

describe("renderer UI primitives", () => {
  it("applies stable button variants and sizes without changing native semantics", () => {
    render(
      <ControlGroup aria-label="Actions">
        <Button variant="primary" size="prominent">Save</Button>
        <IconButton label="Refresh"><RefreshCw /></IconButton>
      </ControlGroup>
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "ui-button--primary",
      "ui-button--prominent"
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveAttribute("title", "Refresh");
    expect(screen.getByRole("group", { name: "Actions" })).toHaveClass("ui-control-group");
  });

  it("exposes badge tone as a visual class while preserving its content", () => {
    render(<Badge tone="success">Applied</Badge>);
    expect(screen.getByText("Applied")).toHaveClass("ui-badge--success");
  });

  it("exposes a stable native switch contract", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Switch checked label="Enable reviewer" onClick={onClick} />
    );

    const control = screen.getByRole("switch", { name: "Enable reviewer" });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control).toHaveClass("is-on");
    fireEvent.click(control);
    expect(onClick).toHaveBeenCalledOnce();

    rerender(<Switch checked={false} disabled label="Enable reviewer" onClick={onClick} />);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toBeDisabled();
  });

  it("dismisses a modal from its backdrop but not its dialog content", () => {
    const onDismiss = vi.fn();
    render(
      <ModalFrame ariaLabel="Example modal" onDismiss={onDismiss}>
        <Button>Keep editing</Button>
      </ModalFrame>
    );

    const dialog = screen.getByRole("dialog", { name: "Example modal" });
    fireEvent.click(dialog);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps a busy modal blocking backdrop dismissal", () => {
    const onDismiss = vi.fn();
    render(
      <ModalFrame ariaLabel="Busy modal" dismissDisabled onDismiss={onDismiss}>
        Working
      </ModalFrame>
    );

    fireEvent.click(screen.getByRole("dialog", { name: "Busy modal" }).parentElement!);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps long text open while the pointer moves into the selectable tooltip", () => {
    vi.useFakeTimers();
    render(
      <OverflowTooltip
        className="description"
        displayText="Truncated"
        text="A complete long value that the user needs to copy"
      />
    );

    const trigger = screen.getByText("Truncated");
    fireEvent.mouseEnter(trigger);
    const tooltip = screen.getByRole("tooltip");
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(tooltip);
    act(() => vi.advanceTimersByTime(200));

    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("A complete long value that the user needs to copy");
    vi.useRealTimers();
  });
});
