// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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
      .filter((label) => ["Agents", "Profiles", "Workspaces", "Conversations", "Skills"].includes(label ?? ""));

    expect(destinations).toEqual(["Agents", "Profiles", "Workspaces", "Conversations", "Skills"]);
    expect(quickOpen.parentElement).not.toBe(
      within(navigation).getByRole("button", { name: "Agents" }).parentElement
    );
    expect(within(navigation).getByRole("button", { name: "Profiles" }).parentElement).toBe(
      within(navigation).getByRole("button", { name: "Agents" }).parentElement
    );
    expect(within(navigation).getByRole("button", { name: "Skills" }).parentElement).toBe(
      within(navigation).getByRole("button", { name: "Agents" }).parentElement
    );
    expect(within(navigation).queryByText("Library", { selector: ".nav-section-label" }))
      .not.toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: "Settings" }).parentElement)
      .toHaveClass("workspace-nav__group--settings");
    expect(within(navigation).queryByText("Workspace", { selector: ".nav-section-label" }))
      .not.toBeInTheDocument();
  });
});
