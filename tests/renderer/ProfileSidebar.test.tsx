// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSidebar } from "../../src/renderer/components/ProfileSidebar";

afterEach(cleanup);

describe("ProfileSidebar", () => {
  it("keeps the startup destination first without reusing Workspace as a group label", () => {
    Object.defineProperty(window, "agentEnv", {
      configurable: true,
      value: { platform: "darwin" }
    });

    render(
      <ProfileSidebar
        targets={[]}
        profiles={[]}
        activeWorkspace="targets"
        isLoading={false}
        collapsed={false}
        onWorkspaceSelect={vi.fn()}
        onAgentSelect={vi.fn()}
        onOpenAgents={vi.fn()}
        onQuickOpen={vi.fn()}
      />
    );

    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const quickOpen = within(navigation).getByRole("button", { name: "Quick open" });
    const destinations = within(navigation).getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
      .filter((label) => ["Agents", "Profiles", "Workspaces", "Conversations", "Skills", "Instructions"].includes(label ?? ""));

    expect(destinations).toEqual([
      "Agents",
      "Profiles",
      "Workspaces",
      "Conversations",
      "Skills",
      "Instructions"
    ]);
    expect(quickOpen.parentElement).not.toBe(
      within(navigation).getByRole("button", { name: "Agents" }).parentElement
    );
    expect(within(navigation).getByRole("button", { name: "Profiles" }).parentElement).toBe(
      within(navigation).getByRole("button", { name: "Agents" }).parentElement
    );
    expect(within(navigation).getByRole("button", { name: "Skills" }).parentElement).not.toBe(
      within(navigation).getByRole("button", { name: "Agents" }).parentElement
    );
    expect(within(navigation).getByRole("button", { name: "Instructions" }).parentElement).toBe(
      within(navigation).getByRole("button", { name: "Skills" }).parentElement
    );
    expect(within(navigation).queryByText("Library", { selector: ".nav-section-label" }))
      .not.toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: "Settings" }).parentElement)
      .toHaveClass("workspace-nav__group--settings");
    expect(within(navigation).queryByText("Workspace", { selector: ".nav-section-label" }))
      .not.toBeInTheDocument();
    const summary = screen.getByRole("button", { name: "Show Local Agents" });
    expect(summary).toHaveTextContent("0");
    expect(summary).not.toHaveTextContent("This Mac");
    expect(document.querySelector(".system-status-card__summary")).toBeNull();
    fireEvent.click(summary);
    expect(screen.getByRole("menu", { name: "Local Agents" })).toHaveTextContent("No enabled Agents");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Local Agents" })).not.toBeInTheDocument();
    expect(summary).toHaveFocus();
  });

  it("separates local and remote counts and preserves remote device identities in details", () => {
    const targets = [
      { id: "codex", name: "Codex", health: { status: "ready" } },
      { id: "ssh:one:codex", name: "Codex", health: { status: "ready" }, location: { kind: "ssh", deviceName: "Build server" } },
      { id: "ssh:two:codex", name: "Codex", health: { status: "ready" }, location: { kind: "ssh", deviceName: "Test server" } }
    ] as import("../../src/shared/types").TargetInfo[];
    render(<ProfileSidebar targets={targets} profiles={[]} activeWorkspace="targets" isLoading={false} collapsed={false}
      onWorkspaceSelect={vi.fn()} onAgentSelect={vi.fn()} onOpenAgents={vi.fn()} onQuickOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Show Local Agents" })).toHaveTextContent("1");
    const remote = screen.getByRole("button", { name: "Show Remote Agents" });
    expect(remote).toHaveTextContent("2");
    fireEvent.click(remote);
    const menu = screen.getByRole("menu", { name: "Remote Agents" });
    expect(menu).toHaveTextContent("Build server");
    expect(menu).toHaveTextContent("Test server");
  });
});
