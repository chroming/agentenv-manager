// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Copy, ListFilter } from "lucide-react";
import { FilterTrigger, IconButton } from "../../src/renderer/components/ui";
import { useModalDialog } from "../../src/renderer/hooks/useModalDialog";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("quiet icon utilities", () => {
  it("does not show a tooltip for modal autofocus, but keeps hover and subsequent focus hints", () => {
    vi.useFakeTimers();
    function Dialog() {
      const dialogRef = createRef<HTMLDivElement>();
      const initialFocusRef = createRef<HTMLButtonElement>();
      useModalDialog({ open: true, dialogRef, initialFocusRef, onDismiss: vi.fn() });
      return <div ref={dialogRef} role="dialog" aria-modal="true">
        <IconButton ref={initialFocusRef} label="Close"><Copy /></IconButton>
      </div>;
    }
    render(<Dialog />);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.mouseEnter(close);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Close");
    fireEvent.pointerDown(close);
    fireEvent.blur(close);
    fireEvent.focus(close);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Close");
  });
  it("keeps the button as the layout and focus anchor while exposing a delayed tooltip", () => {
    vi.useFakeTimers();
    const ref = createRef<HTMLButtonElement>();
    const click = vi.fn();
    const focus = vi.fn();
    const { container, rerender } = render(<IconButton ref={ref} label="Copy path" onClick={click} onFocus={focus}><Copy /></IconButton>);
    const button = screen.getByRole("button", { name: "Copy path" });
    expect(container.firstElementChild).toBe(button);
    expect(button).not.toHaveAttribute("title");
    fireEvent.mouseEnter(button);
    act(() => vi.advanceTimersByTime(299));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Copy path");
    expect(tooltip).toHaveClass("ui-hover-detail--noninteractive");
    expect(button).toHaveAttribute("aria-describedby", tooltip.id);
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(button);
    expect(focus).toHaveBeenCalledOnce();
    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    rerender(<IconButton ref={ref} busy label="Copy path"><Copy /></IconButton>);
    expect(ref.current).toBe(button);
    expect(button).toBeDisabled();
    expect(button.querySelector(".is-spinning")).not.toBeNull();
  });

  it("dismisses a short hint without swallowing the containing menu Escape", () => {
    const escape = vi.fn();
    document.addEventListener("keydown", escape);
    try {
      render(<IconButton label="Copy path"><Copy /></IconButton>);
      fireEvent.focus(screen.getByRole("button"));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(escape).toHaveBeenCalledOnce();
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally { document.removeEventListener("keydown", escape); }
  });

  it("exposes the reason for a disabled utility without enabling its action", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<IconButton disabled label="Copy path" title="No path is available" onClick={onClick}><Copy /></IconButton>);
    const button = screen.getByRole("button", { name: "Copy path" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("No path is available");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
  });

  it("marks active filters without inserting label text or losing the trigger ref", () => {
    const ref = createRef<HTMLButtonElement>();
    const { container, rerender } = render(<FilterTrigger ref={ref} label="Filters" activeCount={2}><ListFilter /></FilterTrigger>);
    const trigger = screen.getByRole("button", { name: "Filters, 2 active filters" });
    expect(ref.current).toBe(trigger);
    expect(trigger.textContent).toBe("");
    expect(container.querySelectorAll(".ui-filter-popover__indicator")).toHaveLength(1);
    rerender(<FilterTrigger ref={ref} label="Filters"><ListFilter /></FilterTrigger>);
    expect(ref.current).toBe(trigger);
    expect(container.querySelector(".ui-filter-popover__indicator")).toBeNull();
    expect(trigger).toHaveAccessibleName("Filters");
  });
});
