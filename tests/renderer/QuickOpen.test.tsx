// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookOpen } from "lucide-react";
import { QuickOpen, type QuickOpenItem } from "../../src/renderer/components/QuickOpen";

afterEach(cleanup);

const items = (onSelect: () => void): QuickOpenItem[] => [
  {
    id: "profile:daily",
    group: "Profiles",
    label: "Daily Coding",
    description: "Default development environment",
    icon: <BookOpen />,
    onSelect
  },
  {
    id: "skill:review",
    group: "Skills",
    label: "Code Review",
    description: "Review pull requests",
    icon: <BookOpen />,
    onSelect: vi.fn()
  }
];

describe("QuickOpen", () => {
  it("filters across item metadata and opens the active result", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    render(<QuickOpen items={items(onSelect)} open onDismiss={onDismiss} />);

    const search = screen.getByRole("textbox", {
      name: "Search Profiles, Skills, Agents, and actions"
    });
    fireEvent.change(search, { target: { value: "default development" } });
    expect(screen.getByRole("option", { name: /Daily Coding/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Code Review/ })).not.toBeInTheDocument();

    fireEvent.keyDown(search, { key: "Enter" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("uses arrow keys to choose another result", () => {
    const first = vi.fn();
    const entries = items(first);
    render(<QuickOpen items={entries} open onDismiss={vi.fn()} />);

    const search = screen.getByRole("textbox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(first).not.toHaveBeenCalled();
    expect(entries[1].onSelect).toHaveBeenCalledTimes(1);
  });
});
