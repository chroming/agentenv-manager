// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillTagEditorDialog } from "../../src/renderer/components/SkillTags";
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
