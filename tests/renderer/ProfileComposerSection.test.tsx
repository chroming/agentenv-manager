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
        chipNames={["Reviewer", "Planner"]}
        expanded
        onToggle={onToggle}
      >
        <button type="button">Edit skills</button>
      </ProfileComposerSection>
    );

    const trigger = screen.getByRole("button", { name: /^Skills\b/i });
    const panel = screen.getByRole("region");

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("id", "profile-skills-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "profile-skills-panel");
    expect(panel).toHaveAttribute("id", "profile-skills-panel");
    expect(panel).toHaveAttribute("aria-labelledby", "profile-skills-trigger");
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
        chipNames={["Context7", "Filesystem", "Context7", "GitHub", "Figma", "Slack"]}
        expanded={false}
        onToggle={() => undefined}
      >
        <div>Server editor</div>
      </ProfileComposerSection>
    );

    const summary = screen.getByLabelText("MCP Servers summary");
    const chips = within(summary).getAllByTestId("profile-composer-chip");

    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Context7",
      "Filesystem",
      "GitHub"
    ]);
    expect(within(summary).getByText("+2")).toBeInTheDocument();
    expect(screen.getByLabelText("6 resources")).toHaveTextContent("6");
  });

  it("hides the panel while collapsed", () => {
    render(
      <ProfileComposerSection
        id="profile-instructions"
        icon={<BookOpen />}
        title="Instructions"
        description="Set the operating guidance"
        count={1}
        chipNames={["AGENTS.md"]}
        expanded={false}
        onToggle={() => undefined}
      >
        <textarea aria-label="Instructions editor" />
      </ProfileComposerSection>
    );

    expect(screen.getByRole("button", { name: /Instructions/i })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Instructions editor" })).not.toBeInTheDocument();
    expect(document.getElementById("profile-instructions-panel")).toBeNull();
  });
});
