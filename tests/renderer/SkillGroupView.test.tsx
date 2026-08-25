// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillGroupView } from "../../src/renderer/components/SkillGroupView";
import type { SkillGroup, SkillLibraryEntry } from "../../src/shared/types";

afterEach(cleanup);

const skill = (id: string): SkillLibraryEntry => ({
  id,
  name: id,
  description: `${id} description`,
  contentHash: `${id}-hash`,
  globallyEnabled: true,
  path: `/library/${id}`,
  sourceType: "local"
} as SkillLibraryEntry);

const group = (id: string, name: string, skillIds: string[]): SkillGroup => ({
  formatVersion: 1,
  id,
  name,
  description: `${name} description`,
  skillIds,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z"
});

describe("SkillGroupView", () => {
  it("uses one searchable resource list and keeps low-frequency actions in overflow", () => {
    const onOpenSkill = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(
      <SkillGroupView
        active
        groups={[
          group("review-pack", "Review pack", ["review"]),
          group("release-pack", "Release pack", ["release"])
        ]}
        skills={[skill("review"), skill("release")]}
        onOpenSkill={onOpenSkill}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "New group" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Skills to Review pack" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Organize reusable Skills for faster Profile setup.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle Review pack" }));
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.queryByText("review-hash")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "review" }));
    expect(onOpenSkill).toHaveBeenCalledWith(expect.objectContaining({ id: "review" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for review" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from group" }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: "review-pack",
      skillIds: []
    }));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Skill Groups" }), {
      target: { value: "release" }
    });
    expect(screen.queryByText("Review pack")).not.toBeInTheDocument();
    expect(screen.getByText("Release pack")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Release pack" }));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("uses a single-line description field and opens the shared editor from Add Skills", () => {
    render(
      <SkillGroupView
        active
        groups={[group("review-pack", "Review pack", ["review"])]}
        skills={[skill("review"), skill("release")]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Skills to Review pack" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Skill Group" });
    expect(within(dialog).getByRole("textbox", { name: "Description" }).tagName).toBe("INPUT");
    expect(within(dialog).getByRole("checkbox", { name: "release" })).not.toBeChecked();
  });

  it("persists a selected Group icon through the shared icon picker", async () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(
      <SkillGroupView
        active
        groups={[group("review-pack", "Review pack", ["review"])]}
        skills={[skill("review")]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions for Review pack" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Skill Group" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose Group icon" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "Icons for Review pack" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose Group icon" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Design" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: "review-pack",
      iconKey: "palette"
    })));
  });
});
