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
});
