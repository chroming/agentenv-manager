// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookOpen } from "lucide-react";
import { QuickOpen, type QuickOpenItem } from "../../src/renderer/components/QuickOpen";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

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

    const search = screen.getByRole("combobox", {
      name: "Search Profiles, Skills, Agents, Conversations, and actions"
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

    const search = screen.getByRole("combobox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(first).not.toHaveBeenCalled();
    expect(entries[1].onSelect).toHaveBeenCalledTimes(1);
  });

  it("exposes listbox state and supports first and last keyboard navigation", () => {
    const first = vi.fn();
    const entries = items(first);
    render(<QuickOpen items={entries} open onDismiss={vi.fn()} />);

    const search = screen.getByRole("combobox");
    expect(search).toHaveAttribute("aria-controls", "quick-open-results");
    expect(search).toHaveAttribute("aria-activedescendant", "quick-open-option-0");

    fireEvent.keyDown(search, { key: "End" });
    expect(search).toHaveAttribute("aria-activedescendant", "quick-open-option-1");
    fireEvent.keyDown(search, { key: "Home" });
    expect(search).toHaveAttribute("aria-activedescendant", "quick-open-option-0");
  });

  it("searches additional indexed items after a debounce and opens the result", async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const searchAdditionalItems = vi.fn().mockResolvedValue([{
      id: "conversation:release",
      group: "Conversations",
      label: "Release investigation",
      description: "Codex · project — old token",
      icon: <BookOpen />,
      onSelect
    } satisfies QuickOpenItem]);
    const onDismiss = vi.fn();
    render(
      <QuickOpen
        items={items(vi.fn())}
        open
        onDismiss={onDismiss}
        searchAdditionalItems={searchAdditionalItems}
      />
    );

    const search = screen.getByRole("combobox");
    fireEvent.change(search, { target: { value: "old token" } });
    expect(searchAdditionalItems).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });

    expect(searchAdditionalItems).toHaveBeenCalledWith("old token");
    expect(screen.getByRole("option", { name: /Release investigation/ }))
      .toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("does not query conversation history for one-character input", () => {
    vi.useFakeTimers();
    const searchAdditionalItems = vi.fn().mockResolvedValue([]);
    render(
      <QuickOpen
        items={items(vi.fn())}
        open
        onDismiss={vi.fn()}
        searchAdditionalItems={searchAdditionalItems}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "x" } });
    act(() => vi.advanceTimersByTime(500));

    expect(searchAdditionalItems).not.toHaveBeenCalled();
  });

  it("discards results from an older asynchronous query", async () => {
    vi.useFakeTimers();
    const first = deferred<QuickOpenItem[]>();
    const second = deferred<QuickOpenItem[]>();
    const searchAdditionalItems = vi.fn((query: string) =>
      query === "first query" ? first.promise : second.promise
    );
    render(
      <QuickOpen
        items={[]}
        open
        onDismiss={vi.fn()}
        searchAdditionalItems={searchAdditionalItems}
      />
    );

    const search = screen.getByRole("combobox");
    fireEvent.change(search, { target: { value: "first query" } });
    act(() => vi.advanceTimersByTime(220));
    fireEvent.change(search, { target: { value: "second query" } });
    act(() => vi.advanceTimersByTime(220));

    await act(async () => {
      second.resolve([{
        id: "conversation:second",
        group: "Conversations",
        label: "Second result",
        icon: <BookOpen />,
        onSelect: vi.fn()
      }]);
      await Promise.resolve();
    });
    await act(async () => {
      first.resolve([{
        id: "conversation:first",
        group: "Conversations",
        label: "Stale first result",
        icon: <BookOpen />,
        onSelect: vi.fn()
      }]);
      await Promise.resolve();
    });

    expect(screen.getByRole("option", { name: /Second result/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Stale first result/ })).toBeNull();
  });

  it("keeps local navigation usable while indexed search is pending or unavailable", async () => {
    vi.useFakeTimers();
    const pending = deferred<QuickOpenItem[]>();
    render(
      <QuickOpen
        items={items(vi.fn())}
        open
        onDismiss={vi.fn()}
        searchAdditionalItems={() => pending.promise}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "daily" } });
    expect(screen.getByRole("option", { name: /Daily Coding/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(220));
    expect(screen.getByRole("listbox", { name: "Quick open results" }))
      .toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("option", { name: /Daily Coding/ })).toBeInTheDocument();

    await act(async () => {
      pending.reject(new Error("index unavailable"));
      await Promise.resolve();
    });

    expect(screen.getByRole("option", { name: /Daily Coding/ })).toBeInTheDocument();
    expect(screen.getByText("Conversation search unavailable")).toBeInTheDocument();
  });
});
