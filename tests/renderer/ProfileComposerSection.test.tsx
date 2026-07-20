// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BookOpen } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileComposerSection } from "../../src/renderer/components/ProfileComposerSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProfileComposerSection", () => {
  it("connects trigger and panel accessibly", () => {
    const onToggle = vi.fn();

    render(
      <ProfileComposerSection
        id="profile-skills"
        icon={<BookOpen data-testid="section-icon" />}
        title="Skills"
        description="Choose reusable capabilities"
        count={2}
        enabledCount={1}
        chipNames={["Reviewer", "Planner"]}
        managed
        managementLabel="Manage Skills for OpenCode"
        expanded
        onToggle={onToggle}
        onManagementChange={() => undefined}
      >
        <button type="button">Edit skills</button>
      </ProfileComposerSection>
    );

    const trigger = screen.getByRole("button", { name: /^Skills\b/i });
    const panel = screen.getByRole("region");
    const panelId = trigger.getAttribute("aria-controls");

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panelId).toBeTruthy();
    expect(panel).toHaveAttribute("id", panelId);
    expect(panel).toHaveAttribute("aria-labelledby", trigger.id);
    expect(trigger).toHaveAccessibleDescription(
      "Choose reusable capabilities 1 of 2 enabled Reviewer Planner"
    );
    expect(screen.getByTestId("section-icon")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders collapsed resource chips with overflow count", () => {
    render(
      <ProfileComposerSection
        id="profile-mcp"
        icon={<BookOpen />}
        title="MCP Servers"
        description="Connect shared tools"
        count={6}
        enabledCount={4}
        chipNames={["Context7", "Filesystem", "Context7", "GitHub", "Figma", "Slack"]}
        managed={false}
        managementLabel="Manage MCPs for OpenCode"
        expanded={false}
        onToggle={() => undefined}
        onManagementChange={() => undefined}
      >
        <div>Server editor</div>
      </ProfileComposerSection>
    );

    const trigger = screen.getByRole("button", { name: "MCP Servers" });
    const summary = screen.getByText("+3").parentElement;

    expect(summary).not.toBeNull();
    const chips = within(summary!).getAllByTestId("profile-composer-chip");

    expect(chips.map((chip) => chip.textContent)).toEqual(["Context7", "Filesystem"]);
    expect(chips.every((chip) => chip.getAttribute("data-ui-overflow-detail") === "true")).toBe(true);
    expect(within(summary!).getByText("+3")).toBeInTheDocument();
    const count = document.querySelector(".profile-composer-section__count");
    expect(count).toHaveAttribute("title", "4 of 6 enabled");
    expect(count?.querySelector(".profile-composer-section__count-visual")).toHaveTextContent("4/6");
    expect(trigger).toHaveAccessibleDescription(
      "Connect shared tools 4 of 6 enabled Context7 Filesystem +3"
    );
  });

  it("keeps duplicate caller ids from cross-wiring relationships", () => {
    render(
      <>
        <ProfileComposerSection
          id=" duplicate section "
          icon={<BookOpen />}
          title="Skills"
          description="Choose skills"
          count={1}
          enabledCount={1}
          chipNames={["Reviewer"]}
          managed
          managementLabel="Manage Skills for OpenCode"
          expanded
          onToggle={() => undefined}
          onManagementChange={() => undefined}
        >
          <div>Skills panel</div>
        </ProfileComposerSection>
        <ProfileComposerSection
          id=" duplicate section "
          icon={<BookOpen />}
          title="MCP Servers"
          description="Choose servers"
          count={1}
          enabledCount={0}
          chipNames={["Context7"]}
          managed
          managementLabel="Manage MCPs for OpenCode"
          expanded
          onToggle={() => undefined}
          onManagementChange={() => undefined}
        >
          <div>MCP panel</div>
        </ProfileComposerSection>
      </>
    );

    const skillsTrigger = screen.getByRole("button", { name: "Skills" });
    const mcpTrigger = screen.getByRole("button", { name: "MCP Servers" });
    const skillsPanel = document.getElementById(skillsTrigger.getAttribute("aria-controls")!);
    const mcpPanel = document.getElementById(mcpTrigger.getAttribute("aria-controls")!);

    expect(skillsTrigger.id).not.toBe(mcpTrigger.id);
    expect(skillsTrigger.getAttribute("aria-controls")).not.toBe(
      mcpTrigger.getAttribute("aria-controls")
    );
    expect(skillsPanel).toHaveAttribute("role", "region");
    expect(mcpPanel).toHaveAttribute("role", "region");
    expect(skillsPanel).toHaveAttribute("aria-labelledby", skillsTrigger.id);
    expect(mcpPanel).toHaveAttribute("aria-labelledby", mcpTrigger.id);

    for (const trigger of [skillsTrigger, mcpTrigger]) {
      const descriptionIds = trigger.getAttribute("aria-describedby")?.split(/\s+/) ?? [];

      expect(descriptionIds).toHaveLength(3);
      expect(descriptionIds.every((descriptionId) => document.getElementById(descriptionId))).toBe(
        true
      );
    }
  });

  it("hides the panel while collapsed", () => {
    render(
      <ProfileComposerSection
        id="profile-instructions"
        icon={<BookOpen />}
        title="Instructions"
        description="Set the operating guidance"
        count={1}
        enabledCount={1}
        chipNames={["AGENTS.md"]}
        managed
        managementLabel="Manage Instructions for OpenCode"
        expanded={false}
        onToggle={() => undefined}
        onManagementChange={() => undefined}
      >
        <textarea aria-label="Instructions editor" />
      </ProfileComposerSection>
    );

    expect(screen.getByRole("button", { name: "Instructions" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Instructions editor" })).not.toBeInTheDocument();
    expect(
      document.getElementById(
        screen.getByRole("button", { name: "Instructions" }).getAttribute("aria-controls")!
      )
    ).toBeNull();
  });

  it("changes resource management without expanding the section", () => {
    const onToggle = vi.fn();
    const onManagementChange = vi.fn();
    render(
      <ProfileComposerSection
        id="profile-skills"
        icon={<BookOpen />}
        title="Skills"
        description="Choose skills"
        count={3}
        enabledCount={2}
        chipNames={["Reviewer"]}
        managed={false}
        managementLabel="Manage Skills for OpenCode"
        expanded={false}
        onToggle={onToggle}
        onManagementChange={onManagementChange}
      >
        <div>Skills panel</div>
      </ProfileComposerSection>
    );

    const management = screen.getByRole("switch", { name: "Manage Skills for OpenCode" });
    expect(management).toHaveAttribute("aria-checked", "false");
    expect(management).toHaveTextContent("Manage");
    const count = document.querySelector(".profile-composer-section__count");
    expect(count).toHaveAttribute("title", "2 of 3 enabled");
    expect(count?.querySelector(".profile-composer-section__count-visual")).toHaveTextContent("2/3");

    fireEvent.click(management);

    expect(onManagementChange).toHaveBeenCalledWith(true);
    expect(management).toHaveTextContent("Manage");
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
