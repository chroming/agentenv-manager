// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    render(
      <SkillGroupView
        active
        groups={[
          group("review-pack", "Review pack", ["review"]),
          group("release-pack", "Release pack", ["release"])
        ]}
        skills={[skill("review"), skill("release")]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "New group" })).toBeInTheDocument();
    expect(screen.queryByText("Organize reusable Skills for faster Profile setup.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle Review pack" }));
    expect(screen.getByText("review")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Skill Groups" }), {
      target: { value: "release" }
    });
    expect(screen.queryByText("Review pack")).not.toBeInTheDocument();
    expect(screen.getByText("Release pack")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Release pack" }));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });
});
