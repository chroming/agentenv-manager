// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SortMenu } from "../../src/renderer/components/ui/SortMenu";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("shared sort menu", () => {
  const options = [{ value: "name", label: "Name" }, { value: "size", label: "Largest" }];
  it("focuses the selected radio, supports keyboard selection and restores trigger focus", () => {
    const onChange = vi.fn();
    render(<SortMenu label="Sort" value="name" options={options} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Sort: Name" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "Name" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    const largest = screen.getByRole("menuitemradio", { name: "Largest" });
    expect(largest).toHaveFocus();
    fireEvent.click(largest);
    expect(onChange).toHaveBeenCalledWith("size");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it.each(["outside", "resize", "scroll", "escape"])("dismisses on %s without changing the selection", (action) => {
    const onChange = vi.fn();
    render(<SortMenu label="Sort" value="size" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort: Largest" }));
    if (action === "outside") fireEvent.mouseDown(document.body);
    if (action === "resize") fireEvent(window, new Event("resize"));
    if (action === "scroll") fireEvent.scroll(window);
    if (action === "escape") fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
