// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolbarOverflowMenu } from "../../src/renderer/components/ui/ToolbarOverflowMenu";

afterEach(cleanup);

describe("ToolbarOverflowMenu button trigger", () => {
  it("uses the shared wrapped-label variant only when requested", () => {
    render(<ToolbarOverflowMenu triggerVariant="button" labelLayout="wrap" label="Select" menuLabel="Selection"
      items={[{ id: "select", label: "Select integrated, unchanged Worktrees", onSelect: vi.fn() }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("menu")).toHaveClass("toolbar-overflow-menu--wrap");
    expect(screen.getByRole("menuitem")).toHaveTextContent("Select integrated, unchanged Worktrees");
  });
  it("renders visible button content, exposes its accessible scope and forwards the trigger to commands", () => {
    const ref = createRef<HTMLButtonElement>();
    const onSelect = vi.fn();
    render(<ToolbarOverflowMenu ref={ref} triggerVariant="button" triggerContent="Select"
      label="Select Worktrees in this view" menuLabel="Selection" items={[
        { id: "disabled", label: "Unavailable", disabled: true, onSelect },
        { id: "automatic", label: "Select integrated", onSelect }
      ]} />);
    const trigger = screen.getByRole("button", { name: "Select Worktrees in this view" });
    expect(ref.current).toBe(trigger);
    expect(trigger).toHaveTextContent("Select");
    expect(trigger).toHaveClass("ui-button");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("title", "Select Worktrees in this view");
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Selection" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("menuitem", { name: "Select integrated" })).toHaveFocus();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Unavailable" }));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Select integrated" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("supports keyboard navigation, Escape focus return, outside dismissal and modal portals", () => {
    const onSelect = vi.fn();
    const { container } = render(<section role="dialog" aria-modal="true"><ToolbarOverflowMenu
      triggerVariant="button" label="Select" menuLabel="Selection" items={[
        { id: "first", label: "First", onSelect },
        { id: "disabled", label: "Unavailable", disabled: true, onSelect },
        { id: "last", label: "Last", onSelect }
      ]} /></section>);
    const trigger = screen.getByRole("button", { name: "Select" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
    expect(menu).toHaveClass("toolbar-overflow-menu--modal");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Last" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([{ disabled: true }, { busy: true }])("does not open or execute while unavailable: %j", (props) => {
    const onSelect = vi.fn();
    render(<ToolbarOverflowMenu {...props} triggerVariant="button" label="Select" menuLabel="Selection"
      items={[{ id: "select", label: "Select all", onSelect }]} />);
    const trigger = screen.getByRole("button", { name: "Select" });
    expect(trigger).toBeDisabled();
    if ("busy" in props) expect(trigger).toHaveAttribute("aria-busy", "true");
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each(["resize", "scroll"])("dismisses an open button menu on %s", (event) => {
    render(<ToolbarOverflowMenu triggerVariant="button" label="Select" menuLabel="Selection"
      items={[{ id: "select", label: "Select all", onSelect: vi.fn() }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent(window, new Event(event));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
