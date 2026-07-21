// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillSourceView } from "../../src/renderer/components/SkillSourceView";
import type { SkillSourceGroupView } from "../../src/shared/types";

afterEach(cleanup);

const group: SkillSourceGroupView = {
  formatVersion: 1,
  canonicalLink: "https://github.com/acme/skills/tree/main/engineering",
  repository: "https://github.com/acme/skills.git",
  ref: "main",
  directory: "engineering",
  checkedAt: "2026-07-21T00:00:00.000Z",
  observationState: "ready",
  counts: { total: 4, updates: 1, new: 1, removed: 1 },
  candidates: [
    {
      sourceSubpath: "testing",
      directory: "engineering/testing",
      name: "testing",
      description: "Test code",
      contentRevision: "testing-1",
      state: "new"
    },
    {
      sourceSubpath: "review",
      directory: "engineering/review",
      name: "review",
      description: "Review code",
      contentRevision: "review-2",
      libraryId: "review",
      libraryName: "review",
      libraryVersion: "1.0.0",
      state: "update"
    },
    {
      sourceSubpath: "docs",
      directory: "engineering/docs",
      name: "docs",
      description: "Write docs",
      contentRevision: "docs-1",
      libraryId: "docs",
      libraryName: "docs",
      state: "removed"
    },
    {
      sourceSubpath: "release",
      directory: "engineering/release",
      name: "release",
      description: "Release code",
      contentRevision: "release-1",
      libraryId: "release",
      libraryName: "release",
      state: "current"
    }
  ]
};

describe("SkillSourceView", () => {
  it("shows source-level counts and routes each remote state to one explicit action", async () => {
    const onCheckGroup = vi.fn().mockResolvedValue(undefined);
    const onAdd = vi.fn().mockResolvedValue(true);
    const onUpdate = vi.fn();
    const onDelete = vi.fn();
    render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={onCheckGroup}
        onCheckAll={vi.fn().mockResolvedValue(undefined)}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Source summary")).toHaveTextContent("4Total1Updates1New1Removed");
    fireEvent.click(screen.getByRole("button", { name: "Expand source" }));

    const candidates = document.querySelector<HTMLElement>(".skill-source-candidates");
    expect(candidates).not.toBeNull();
    fireEvent.click(within(candidates!).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(group, group.candidates[0]));
    fireEvent.click(within(candidates!).getByRole("button", { name: "Review update" }));
    expect(onUpdate).toHaveBeenCalledWith("review");
    fireEvent.click(within(candidates!).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("docs");

    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(onCheckGroup).toHaveBeenCalledWith(group.canonicalLink));
  });

  it("filters by source and Skill name without discarding the mounted view", () => {
    const { rerender } = render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckAll={vi.fn().mockResolvedValue(undefined)}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Search sources and skills"), {
      target: { value: "testing" }
    });
    expect(screen.getByText(group.canonicalLink)).toBeInTheDocument();
    rerender(
      <SkillSourceView
        active={false}
        groups={[group]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckAll={vi.fn().mockResolvedValue(undefined)}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Skills by source", { selector: "[aria-hidden='true']" }))
      .toHaveClass("is-inactive");
    expect(document.querySelector<HTMLInputElement>("[aria-label='Search sources and skills']"))
      .toHaveValue("testing");
  });
});
