// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillTagCell, SkillTagEditorDialog } from "../../src/renderer/components/SkillTags";
import type { SkillLibraryEntry } from "../../src/shared/types";

afterEach(cleanup);

const skill: SkillLibraryEntry = {
  id: "reviewer",
  name: "Reviewer",
  description: "Review code",
  path: "/tmp/reviewer",
  sourceType: "local",
  updatePolicy: "untracked",
  contentHash: "hash",
  updatedAt: "2026-08-20T00:00:00.000Z",
  tags: ["Code Review"]
};

describe("SkillTagEditorDialog", () => {
  it("identifies fixed and AI tag origins in the Library cell", () => {
    render(<SkillTagCell skill={{ ...skill, tags: ["Fixed", "Suggested"], aiTags: ["Suggested"] }} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    const fixed = screen.getByRole("menuitem", { name: "Fixed" });
    const suggested = screen.getByRole("menuitem", { name: "Suggested" });
    expect(fixed).toHaveAttribute("title", "Fixed · Fixed tags");
    expect(suggested).toHaveAttribute("title", "Suggested · AI-generated tags");
    expect(fixed.querySelector('.lucide-pin')).not.toBeNull();
    expect(suggested.querySelector('.lucide-sparkles')).not.toBeNull();
  });
  it("converts an AI tag into a fixed tag only when saved", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<SkillTagEditorDialog availableTags={[]} skill={{ ...skill, tags: ["Review", "Testing"], aiTags: ["Review", "Testing"] }} onDismiss={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Make Review fixed" }));
    expect(within(screen.getByRole("region", { name: "Fixed tags" })).getByRole("button", { name: "Remove tag Review" })).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Make Testing fixed" })).toBeDisabled();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ id: "reviewer", tags: ["Review", "Testing"], fixedTags: ["Review"] }));
  });
  it("separates persisted AI and manual tags without changing tag labels", () => {
    render(<SkillTagEditorDialog availableTags={[]} skill={{ ...skill, tags: ["Manual", "Review"], aiTags: ["Review"] }} onDismiss={vi.fn()} onSave={vi.fn()} />);
    expect(within(screen.getByRole("region", { name: "Fixed tags" })).getByRole("button", { name: "Remove tag Manual" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "AI-generated tags" })).getByRole("button", { name: "Remove tag Review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("adds existing and custom tags, removes tags, and saves one normalized list", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onDismiss = vi.fn();
    render(
      <SkillTagEditorDialog
        availableTags={["Code Review", "Frontend"]}
        skill={skill}
        onDismiss={onDismiss}
        onSave={onSave}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Edit tags for reviewer" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Frontend" }));
    const input = within(dialog).getByRole("textbox", { name: "Add a tag" });
    fireEvent.change(input, { target: { value: "  Release   Work  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove tag Code Review" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      id: "reviewer",
      tags: ["Frontend", "Release Work"]
    }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
