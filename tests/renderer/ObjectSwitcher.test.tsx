// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectSwitcher } from "../../src/renderer/components/ui";

afterEach(() => cleanup());

describe("ObjectSwitcher", () => {
  it("opens a searchable object list and selects a different object", () => {
    const onOpenChange = vi.fn();
    const onQueryChange = vi.fn();
    const onSelect = vi.fn();

    const { rerender } = render(
      <ObjectSwitcher
        ariaLabel="Choose Profile"
        items={[
          { id: "daily", title: "Daily Coding", description: "OpenCode · Active" },
          { id: "review", title: "Code Review", description: "Not applied" }
        ]}
        open={false}
        query=""
        searchLabel="Search Profiles"
        searchPlaceholder="Search Profiles"
        selectedId="daily"
        onOpenChange={onOpenChange}
        onQueryChange={onQueryChange}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose Profile" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <ObjectSwitcher
        ariaLabel="Choose Profile"
        items={[
          { id: "daily", title: "Daily Coding", description: "OpenCode · Active" },
          { id: "review", title: "Code Review", description: "Not applied" }
        ]}
        open
        query=""
        searchLabel="Search Profiles"
        searchPlaceholder="Search Profiles"
        selectedId="daily"
        onOpenChange={onOpenChange}
        onQueryChange={onQueryChange}
        onSelect={onSelect}
      />
    );

    const search = screen.getByRole("searchbox", { name: "Search Profiles" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "review" } });
    expect(onQueryChange).toHaveBeenCalledWith("review");

    rerender(
      <ObjectSwitcher
        ariaLabel="Choose Profile"
        items={[
          { id: "daily", title: "Daily Coding", description: "OpenCode · Active" },
          { id: "review", title: "Code Review", description: "Not applied" }
        ]}
        open
        query="review"
        searchLabel="Search Profiles"
        searchPlaceholder="Search Profiles"
        selectedId="daily"
        onOpenChange={onOpenChange}
        onQueryChange={onQueryChange}
        onSelect={onSelect}
      />
    );
    expect(screen.queryByRole("option", { name: /Daily Coding/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /Code Review/ }));
    expect(onSelect).toHaveBeenCalledWith("review");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes as a no-op for the current object and restores focus after Escape", () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    const { rerender } = render(
      <ObjectSwitcher
        ariaLabel="Choose Workspace"
        items={[{ id: "current", title: "AgentEnv", description: "/work/agentenv" }]}
        open
        query=""
        searchLabel="Search Workspaces"
        searchPlaceholder="Search folders"
        selectedId="current"
        onOpenChange={onOpenChange}
        onQueryChange={() => undefined}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("option", { name: /AgentEnv/ }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <ObjectSwitcher
        ariaLabel="Choose Workspace"
        items={[{ id: "current", title: "AgentEnv", description: "/work/agentenv" }]}
        open={false}
        query=""
        searchLabel="Search Workspaces"
        searchPlaceholder="Search folders"
        selectedId="current"
        onOpenChange={onOpenChange}
        onQueryChange={() => undefined}
        onSelect={onSelect}
      />
    );
    const trigger = screen.getByRole("button", { name: "Choose Workspace" });
    trigger.focus();
    fireEvent.click(trigger);

    rerender(
      <ObjectSwitcher
        ariaLabel="Choose Workspace"
        items={[{ id: "current", title: "AgentEnv", description: "/work/agentenv" }]}
        open
        query=""
        searchLabel="Search Workspaces"
        searchPlaceholder="Search folders"
        selectedId="current"
        onOpenChange={onOpenChange}
        onQueryChange={() => undefined}
        onSelect={onSelect}
      />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger).toHaveFocus();
  });

  it("gives footer actions the stable switcher trigger for modal focus restoration", () => {
    const onFooterAction = vi.fn();
    render(
      <ObjectSwitcher
        ariaLabel="Choose Profile"
        footerAction={{ label: "New Profile", onClick: onFooterAction }}
        items={[{ id: "daily", title: "Daily Coding" }]}
        open
        query=""
        searchLabel="Search Profiles"
        searchPlaceholder="Search Profiles"
        selectedId="daily"
        onOpenChange={() => undefined}
        onQueryChange={() => undefined}
        onSelect={() => undefined}
      />
    );

    const trigger = screen.getByRole("button", { name: "Choose Profile" });
    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));

    expect(onFooterAction).toHaveBeenCalledWith(trigger);
  });

  it("supports an icon-free detail trigger and a disabled empty state", () => {
    render(
      <ObjectSwitcher
        ariaLabel="Choose Agent"
        className="project-agent-switcher"
        disabled
        fullWidth
        items={[]}
        open={false}
        query=""
        searchLabel="Search Agents"
        searchPlaceholder="Search Agents"
        showTriggerIcon={false}
        triggerVariant="icon"
        onOpenChange={() => undefined}
        onQueryChange={() => undefined}
        onSelect={() => undefined}
      />
    );

    const trigger = screen.getByRole("button", { name: "Choose Agent" });
    expect(trigger).toBeDisabled();
    expect(trigger.querySelector(".ui-object-switcher__trigger-icon")).toBeNull();
    expect(trigger.parentElement?.classList.contains("ui-object-switcher--full-width")).toBe(true);
    expect(trigger.parentElement?.classList.contains("ui-object-switcher--icon-trigger")).toBe(true);
  });

  it("supports an inline title trigger for the current object header", () => {
    render(
      <ObjectSwitcher
        ariaLabel="Choose Profile"
        items={[{ id: "daily", title: "Daily Coding" }]}
        open={false}
        query=""
        searchLabel="Search Profiles"
        searchPlaceholder="Search Profiles"
        selectedId="daily"
        triggerVariant="inline"
        showTriggerDescription={false}
        onOpenChange={() => undefined}
        onQueryChange={() => undefined}
        onSelect={() => undefined}
      />
    );

    const trigger = screen.getByRole("button", { name: "Choose Profile" });
    expect(trigger.parentElement?.classList.contains("ui-object-switcher--inline-trigger")).toBe(true);
    expect(screen.getByText("Daily Coding")).toBeInTheDocument();
    expect(screen.queryByText("OpenCode · Active")).not.toBeInTheDocument();
  });

  it("reorders complete unfiltered lists by drag or keyboard", () => {
    const onReorder = vi.fn();
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn()
    };
    const { rerender } = render(
      <ObjectSwitcher
        ariaLabel="Choose Profile"
        items={[
          { id: "daily", title: "Daily Coding" },
          { id: "review", title: "Code Review" }
        ]}
        open
        query=""
        searchLabel="Search Profiles"
        searchPlaceholder="Search Profiles"
        selectedId="daily"
        onOpenChange={() => undefined}
        onQueryChange={() => undefined}
        onReorder={onReorder}
        onSelect={() => undefined}
      />
    );

    const daily = screen.getByRole("option", { name: /Daily Coding/ });
    const review = screen.getByRole("option", { name: /Code Review/ });
    vi.spyOn(review, "getBoundingClientRect").mockReturnValue({
      bottom: 20,
      height: 20,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    const handles = screen.getAllByRole("button", { name: "Reorder" });
    expect(daily).not.toHaveAttribute("draggable");
    expect(handles[0]).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(handles[0], { dataTransfer });
    fireEvent.dragOver(review, { clientY: 15, dataTransfer });
    fireEvent.drop(review, { clientY: 15, dataTransfer });
    expect(onReorder).toHaveBeenCalledWith(["review", "daily"]);

    onReorder.mockClear();
    fireEvent.keyDown(handles[0], { altKey: true, key: "ArrowDown" });
    expect(onReorder).toHaveBeenCalledWith(["review", "daily"]);

    rerender(
      <ObjectSwitcher
        ariaLabel="Choose Profile"
        items={[
          { id: "daily", title: "Daily Coding" },
          { id: "review", title: "Code Review" }
        ]}
        open
        query="daily"
        searchLabel="Search Profiles"
        searchPlaceholder="Search Profiles"
        selectedId="daily"
        onOpenChange={() => undefined}
        onQueryChange={() => undefined}
        onReorder={onReorder}
        onSelect={() => undefined}
      />
    );
    expect(screen.getByRole("option", { name: /Daily Coding/ })).not.toHaveAttribute("draggable");
    expect(screen.queryByRole("button", { name: "Reorder" })).not.toBeInTheDocument();
  });

  it("keeps selectable row copy independent from the reorder handle", () => {
    const onSelect = vi.fn();
    render(
      <ObjectSwitcher
        ariaLabel="Choose Workspace"
        items={[
          { id: "one", title: "AgentEnv", description: "/work/agentenv" },
          { id: "two", title: "Examples", description: "/work/examples" }
        ]}
        open
        query=""
        searchLabel="Search Workspaces"
        searchPlaceholder="Search Workspaces"
        selectedId="one"
        onOpenChange={() => undefined}
        onQueryChange={() => undefined}
        onReorder={() => undefined}
        onSelect={onSelect}
      />
    );

    const row = screen.getByRole("option", { name: /Examples/ });
    expect(row.tagName).toBe("DIV");
    expect(row.querySelector(".ui-selectable-row__identity")).toBeInTheDocument();
    expect(row).not.toHaveAttribute("draggable");
    fireEvent.click(screen.getAllByRole("button", { name: "Reorder" })[1]);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("two");
  });
});
