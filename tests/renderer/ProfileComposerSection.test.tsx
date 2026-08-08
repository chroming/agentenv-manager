// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
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
        policy="manage"
        policyLabel="Skills application policy for OpenCode"
        expanded
        onToggle={onToggle}
        onPolicyChange={() => undefined}
      >
        <button type="button">Edit skills</button>
      </ProfileComposerSection>
    );

    const trigger = screen.getByRole("button", { name: "Skills" });
    const panel = screen.getByRole("group", { name: "Skills" });
    const panelId = trigger.getAttribute("aria-controls");

    expect(trigger.closest(".ui-resource-disclosure")).toHaveClass(
      "profile-composer-section"
    );
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panelId).toBeTruthy();
    expect(panel).toHaveAttribute("id", panelId);
    expect(panel).toHaveAttribute("aria-labelledby", trigger.id);
    expect(trigger).toHaveAccessibleDescription(
      "Choose reusable capabilities 1 of 2 enabled Reviewer, Planner"
    );
    expect(
      screen.getByText("Choose reusable capabilities").closest(
        ".ui-resource-disclosure__description"
      )
    ).toHaveClass("ui-visually-hidden");
    expect(screen.getByTestId("section-icon")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps collapsed resource names accessible without visible chip noise", () => {
    render(
      <ProfileComposerSection
        id="profile-mcp"
        icon={<BookOpen />}
        title="MCP Servers"
        description="Connect shared tools"
        count={6}
        enabledCount={4}
        countSummary="1 Profile override · 6 in OpenCode"
        chipNames={["Context7", "Filesystem", "Context7", "GitHub", "Figma", "Slack"]}
        policy="ignore"
        policyLabel="MCPs application policy for OpenCode"
        expanded={false}
        onToggle={() => undefined}
        onPolicyChange={() => undefined}
      >
        <div>Server editor</div>
      </ProfileComposerSection>
    );

    const trigger = screen.getByRole("button", { name: "MCP Servers" });
    expect(trigger).toHaveAccessibleDescription(
      "Connect shared tools 1 Profile override · 6 in OpenCode Context7, Filesystem, GitHub, Figma, Slack"
    );
    expect(screen.queryByTestId("profile-composer-chip")).toBeNull();
    expect(screen.queryByText("+3")).toBeNull();
    const count = document.querySelector(".ui-resource-disclosure__summary");
    expect(count).toHaveAttribute("title", "1 Profile override · 6 in OpenCode");
    expect(count?.querySelector(".profile-composer-section__count-scope"))
      .toHaveTextContent("1 Profile override · 6 in OpenCode");
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
          policy="manage"
          policyLabel="Skills application policy for OpenCode"
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
          policy="manage"
          policyLabel="MCPs application policy for OpenCode"
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
    expect(skillsPanel).toHaveAttribute("role", "group");
    expect(mcpPanel).toHaveAttribute("role", "group");
    expect(skillsPanel).toHaveAttribute("aria-labelledby", skillsTrigger.id);
    expect(mcpPanel).toHaveAttribute("aria-labelledby", mcpTrigger.id);

    for (const trigger of [skillsTrigger, mcpTrigger]) {
      const descriptionIds = trigger.getAttribute("aria-describedby")?.split(/\s+/) ?? [];

      expect(descriptionIds).toHaveLength(2);
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
        policy="manage"
        policyLabel="Instructions application policy for OpenCode"
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
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
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
        policy="ignore"
        policyLabel="Skills application policy for OpenCode"
        expanded={false}
        onToggle={onToggle}
        onPolicyChange={onPolicyChange}
      >
        <div>Skills panel</div>
      </ProfileComposerSection>
    );

    const policy = screen.getByRole("radiogroup", {
      name: "Skills application policy for OpenCode"
    });
    expect(
      within(policy).getByRole("radio", { name: "Keep Agent" })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(policy).getByRole("radio", { name: "Use Profile" })
    ).toHaveAttribute("aria-checked", "false");
    expect(within(policy).getByText("Profile")).toBeInTheDocument();
    expect(within(policy).getByText("Off")).toBeInTheDocument();
    expect(within(policy).getByText("Agent")).toBeInTheDocument();
    expect(policy).toHaveClass("is-ignore");
    expect(policy.closest(".profile-composer-section")).toHaveClass("is-unmanaged");
    const count = document.querySelector(".ui-resource-disclosure__summary");
    expect(count).toHaveAttribute("title", "2 of 3 enabled");
    expect(count?.querySelector(".profile-composer-section__count-visual")).toHaveTextContent("2/3");
    const header = policy.closest(".ui-resource-disclosure__header");
    expect(header?.children[0]).toBe(screen.getByRole("button", { name: "Skills" }));
    expect(header?.children[1]).toContainElement(policy);
    expect(header?.querySelectorAll("button")).toHaveLength(4);

    fireEvent.click(within(policy).getByRole("radio", { name: "Use Profile" }));

    expect(onPolicyChange).toHaveBeenCalledWith("manage");
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("keeps Profile content inspectable without adding an unmanaged explanation row", () => {
    render(
      <ProfileComposerSection
        id="profile-instructions"
        icon={<BookOpen />}
        title="Instructions"
        description="Set the operating guidance"
        count={1}
        enabledCount={1}
        chipNames={["AGENTS.md"]}
        policy="ignore"
        policyLabel="Instructions application policy for OpenCode"
        expanded
        onToggle={() => undefined}
        onPolicyChange={() => undefined}
      >
        <textarea aria-label="Instructions editor" defaultValue="# Saved Profile content" />
      </ProfileComposerSection>
    );

    expect(screen.queryByText(/Saved in this Profile/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Instructions editor" })).toHaveValue(
      "# Saved Profile content"
    );
  });

  it("keeps saved content inspectable without adding a disabled explanation row", () => {
    render(
      <ProfileComposerSection
        id="profile-instructions"
        icon={<BookOpen />}
        title="Instructions"
        description="Set the operating guidance"
        count={1}
        enabledCount={0}
        chipNames={["AGENTS.md"]}
        policy="disable"
        policyLabel="Instructions application policy for OpenCode"
        expanded
        onToggle={() => undefined}
        onPolicyChange={() => undefined}
      >
        <textarea aria-label="Instructions editor" defaultValue="# Saved Profile content" />
      </ProfileComposerSection>
    );

    expect(screen.queryByText(/Saved in this Profile/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Instructions editor" })).toHaveValue(
      "# Saved Profile content"
    );
    expect(document.querySelector(".profile-composer-section")).toHaveClass(
      "is-resource-disabled"
    );
  });

  it("uses arrow keys to move directly between policy choices", () => {
    const onPolicyChange = vi.fn();
    render(
      <ProfileComposerSection
        id="profile-skills"
        icon={<BookOpen />}
        title="Skills"
        description="Choose skills"
        count={1}
        enabledCount={1}
        chipNames={["Reviewer"]}
        policy="manage"
        policyLabel="Skills application policy for OpenCode"
        expanded={false}
        onToggle={() => undefined}
        onPolicyChange={onPolicyChange}
      >
        <div>Skills panel</div>
      </ProfileComposerSection>
    );

    const policy = screen.getByRole("radiogroup", {
      name: "Skills application policy for OpenCode"
    });
    const apply = within(policy).getByRole("radio", { name: "Use Profile" });
    const disable = within(policy).getByRole("radio", { name: "Turn off" });
    apply.focus();

    fireEvent.keyDown(policy, { key: "ArrowRight" });

    expect(onPolicyChange).toHaveBeenCalledWith("disable");
    expect(disable).toHaveFocus();
  });
});
