// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { handleActionMenuKeyDown } from "../../src/renderer/components/ui";

const MenuFixture = () => (
  <div role="menu" aria-label="Actions" onKeyDown={handleActionMenuKeyDown}>
    <button type="button" role="menuitem">First</button>
    <button type="button" role="menuitem" disabled>Unavailable</button>
    <button type="button" role="menuitemradio">Second</button>
    <button type="button" role="menuitem">Last</button>
  </div>
);

afterEach(cleanup);

describe("action menu keyboard contract", () => {
  it("moves through enabled items and wraps with arrow keys", () => {
    render(<MenuFixture />);
    const menu = screen.getByRole("menu", { name: "Actions" });
    const first = screen.getByRole("menuitem", { name: "First" });
    const second = screen.getByRole("menuitemradio", { name: "Second" });
    const last = screen.getByRole("menuitem", { name: "Last" });

    first.focus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowLeft" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowRight" });
    expect(first).toHaveFocus();
  });

  it("supports Home and End without activating a command", () => {
    render(<MenuFixture />);
    const menu = screen.getByRole("menu", { name: "Actions" });
    const first = screen.getByRole("menuitem", { name: "First" });
    const last = screen.getByRole("menuitem", { name: "Last" });

    first.focus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(first).toHaveFocus();
  });
});
