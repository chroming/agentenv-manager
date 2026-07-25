// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
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
        policy="apply-profile"
        policyLabel="Skills application policy for OpenCode"
        targetName="OpenCode"
        expanded
        onToggle={onToggle}
        onPolicyChange={() => undefined}
      >
        <button type="button">Edit skills</button>
      </ProfileComposerSection>
    );

    const trigger = screen.getByRole("button", { name: /^Skills$/ });
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
        policy="leave-unchanged"
        policyLabel="MCPs application policy for OpenCode"
        targetName="OpenCode"
        expanded={false}
        onToggle={() => undefined}
        onPolicyChange={() => undefined}
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
          policy="apply-profile"
          policyLabel="Skills application policy for OpenCode"
          targetName="OpenCode"
          expanded
          onToggle={() => undefined}
          onPolicyChange={() => undefined}
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
          policy="apply-profile"
          policyLabel="MCPs application policy for OpenCode"
          targetName="OpenCode"
          expanded
          onToggle={() => undefined}
          onPolicyChange={() => undefined}
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
        policy="apply-profile"
        policyLabel="Instructions application policy for OpenCode"
        targetName="OpenCode"
        expanded={false}
        onToggle={() => undefined}
        onPolicyChange={() => undefined}
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

  it("changes the Target application policy without expanding the section", () => {
    const onToggle = vi.fn();
    const onPolicyChange = vi.fn();
    render(
      <ProfileComposerSection
        id="profile-skills"
        icon={<BookOpen />}
        title="Skills"
        description="Choose skills"
        count={3}
        enabledCount={2}
        chipNames={["Reviewer"]}
        policy="leave-unchanged"
        policyLabel="Skills application policy for OpenCode"
        targetName="OpenCode"
        expanded={false}
        onToggle={onToggle}
        onPolicyChange={onPolicyChange}
      >
        <div>Skills panel</div>
      </ProfileComposerSection>
    );

    const policy = screen.getByRole("button", {
      name: "Skills application policy for OpenCode"
    });
    expect(policy).toHaveTextContent("Keep Agent");
    const count = document.querySelector(".profile-composer-section__count");
    expect(count).toHaveAttribute("title", "2 of 3 enabled");
    expect(count?.querySelector(".profile-composer-section__count-visual")).toHaveTextContent("2/3");
    const header = policy.closest(".profile-composer-section__header");
    expect(header?.children[0]).toBe(screen.getByRole("button", { name: "Expand Skills" }));
    expect(header?.children[1]).toBe(screen.getByRole("button", { name: "Skills" }));
    expect(header?.children[2]).toBe(policy);

    fireEvent.click(policy);
    const menu = screen.getByRole("menu", {
      name: "Skills application policy for OpenCode"
    });
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Use Profile/ }));

    expect(onPolicyChange).toHaveBeenCalledWith("apply-profile");
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("keeps Profile content editable and explains a leave-unchanged policy", () => {
    render(
      <ProfileComposerSection
        id="profile-instructions"
        icon={<BookOpen />}
        title="Instructions"
        description="Set the operating guidance"
        count={1}
        enabledCount={1}
        chipNames={["AGENTS.md"]}
        policy="leave-unchanged"
        policyLabel="Instructions application policy for OpenCode"
        targetName="OpenCode"
        expanded
        onToggle={() => undefined}
        onPolicyChange={() => undefined}
      >
        <textarea aria-label="Instructions editor" defaultValue="# Saved Profile content" />
      </ProfileComposerSection>
    );

    expect(screen.getByText(/Saved in this Profile/)).toHaveTextContent(
      "Applying to OpenCode leaves this section unchanged."
    );
    expect(screen.getByRole("textbox", { name: "Instructions editor" })).toHaveValue(
      "# Saved Profile content"
    );
  });

  it("dismisses the policy menu with Escape and restores trigger focus", async () => {
    render(
      <ProfileComposerSection
        id="profile-skills"
        icon={<BookOpen />}
        title="Skills"
        description="Choose skills"
        count={1}
        enabledCount={1}
        chipNames={["Reviewer"]}
        policy="apply-profile"
        policyLabel="Skills application policy for OpenCode"
        targetName="OpenCode"
        expanded={false}
        onToggle={() => undefined}
        onPolicyChange={() => undefined}
      >
        <div>Skills panel</div>
      </ProfileComposerSection>
    );

    const trigger = screen.getByRole("button", {
      name: "Skills application policy for OpenCode"
    });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
