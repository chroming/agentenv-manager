// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RefreshCw } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Badge,
  Button,
  ControlGroup,
  IconButton,
  ModalFrame,
  PageHeader,
  ResourceRow,
  Switch
} from "../../src/renderer/components/ui";
import { OverflowTooltip } from "../../src/renderer/components/OverflowTooltip";
import { InfoTip } from "../../src/renderer/components/InfoTip";

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
    expect(trigger).toHaveAttribute("data-ui-overflow-detail", "true");
    Object.defineProperties(trigger, {
      clientWidth: { configurable: true, value: 80 },
      scrollWidth: { configurable: true, value: 220 }
    });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole("tooltip");
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(tooltip);
    act(() => vi.advanceTimersByTime(200));

    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveClass("ui-hover-detail");
    expect(tooltip).toHaveTextContent("A complete long value that the user needs to copy");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("does not open an overflow detail for text that already fits", () => {
    render(<OverflowTooltip className="description" text="Short value" />);
    const trigger = screen.getByText("Short value");
    Object.defineProperties(trigger, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 80 }
    });

    fireEvent.focus(trigger);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("passes boundary wheel movement back to the owning list", () => {
    render(
      <div data-testid="scroll-owner" style={{ height: 80, overflowY: "auto" }}>
        <OverflowTooltip
          className="description"
          displayText="Truncated"
          text="A complete value"
        />
      </div>
    );
    const scrollOwner = screen.getByTestId("scroll-owner");
    const scrollBy = vi.fn();
    Object.defineProperties(scrollOwner, {
      clientHeight: { configurable: true, value: 80 },
      scrollHeight: { configurable: true, value: 240 },
      scrollBy: { configurable: true, value: scrollBy }
    });
    fireEvent.focus(screen.getByText("Truncated"));

    fireEvent.wheel(screen.getByRole("tooltip"), { deltaY: 40 });

    expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 40 });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("uses the same hover detail primitive for contextual information", () => {
    render(<InfoTip label="A complete explanation" />);
    fireEvent.focus(screen.getByLabelText("A complete explanation"));
    expect(screen.getByRole("tooltip")).toHaveClass(
      "ui-hover-detail",
      "info-tip__bubble"
    );
  });

  it("keeps page identity and page actions in one shared header contract", () => {
    render(
      <PageHeader
        title="Skills"
        description="Manage shared resources."
        actions={<Button variant="primary">Import</Button>}
      />
    );

    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("Manage shared resources.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" }).closest(".ui-page-header__actions"))
      .toBeInTheDocument();
  });

  it("uses one resource row anatomy for identity, metadata, state, and actions", () => {
    render(
      <ResourceRow
        aria-label="Skill reviewer"
        icon={<RefreshCw />}
        title="reviewer"
        description="Review changes"
        metadata="GitHub · main"
        state={<Badge tone="warning">Update</Badge>}
        actions={<IconButton label="More"><RefreshCw /></IconButton>}
      />
    );

    const row = screen.getByLabelText("Skill reviewer");
    expect(row).toHaveClass("ui-resource-row--default");
    expect(row.querySelector(".ui-resource-row__identity")).toHaveTextContent(
      "reviewerReview changes"
    );
    expect(row.querySelector(".ui-resource-row__metadata")).toHaveTextContent("GitHub · main");
    expect(screen.getByText("Update")).toHaveClass("ui-badge--warning");
  });
});
