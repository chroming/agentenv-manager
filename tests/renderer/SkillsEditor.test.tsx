// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillsEditor } from "../../src/renderer/components/SkillsEditor";
import type { ProfileResources, SkillLibraryEntry } from "../../src/shared/types";

const skills: SkillLibraryEntry[] = [
  {
    id: "review",
    name: "Code Review",
    description: "Review code",
    version: "1.2.0",
    path: "/library/review",
    sourceType: "github",
    source: "https://github.com/acme/skills/tree/main/review",
    updatePolicy: "tracked",
    contentHash: "abcdef123456",
    updatedAt: "2026-07-19T00:00:00Z"
  },
  {
    id: "docs",
    name: "Docs",
    description: "Write docs",
    path: "/library/docs",
    sourceType: "local",
    updatePolicy: "untracked",
    contentHash: "123456abcdef",
    updatedAt: "2026-07-19T00:00:00Z"
  },
  {
    id: "hidden",
    name: "Hidden",
    description: "Disabled globally",
    path: "/library/hidden",
    sourceType: "local",
    globallyEnabled: false,
    updatePolicy: "untracked",
    contentHash: "hidden",
    updatedAt: "2026-07-19T00:00:00Z"
  }
];

const resources: ProfileResources = {
  skills: [{ libraryId: "review", targetName: "review", enabled: true }],
  mcpByTarget: {}
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SkillsEditor v2", () => {
  it("shows Library metadata and toggles a Profile Skill", () => {
    const onChange = vi.fn();
    render(<SkillsEditor value={resources} librarySkills={skills} onChange={onChange} />);

    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.getByText(/v1\.2\.0 · GitHub · \/library\/review/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Disable Code Review" }));
    expect(onChange).toHaveBeenCalledWith({
      ...resources,
      skills: [{ libraryId: "review", targetName: "review", enabled: false }]
    });
  });

  it("adds selected globally available Skills from Library", () => {
    const onChange = vi.fn();
    render(<SkillsEditor value={resources} librarySkills={skills} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("dialog", { name: "Add library skills" })).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Docs" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1" }));

    expect(onChange).toHaveBeenCalledWith({
      ...resources,
      skills: [
        ...resources.skills,
        { libraryId: "docs", targetName: "docs", enabled: true }
      ]
    });
  });

  it("offers Relink for a missing Library reference", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        value={{
          skills: [{ libraryId: "missing", targetName: "missing", enabled: true }],
          mcpByTarget: {}
        }}
        librarySkills={skills}
        onChange={onChange}
      />
    );

    expect(screen.getByText("Missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Relink" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Code Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Relink skill" }));
    expect(onChange).toHaveBeenCalledWith({
      skills: [{ libraryId: "review", targetName: "missing", enabled: true }],
      mcpByTarget: {}
    });
  });

  it("checks only enabled tracked Skills", () => {
    const onCheck = vi.fn();
    render(
      <SkillsEditor
        value={{
          skills: [
            { libraryId: "review", targetName: "review", enabled: true },
            { libraryId: "docs", targetName: "docs", enabled: true }
          ],
          mcpByTarget: {}
        }}
        librarySkills={skills}
        onCheckSkillUpdates={onCheck}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Check profile skill updates" }));
    expect(onCheck).toHaveBeenCalledWith(["review"]);
  });

  it("opens the update preview for an available update", () => {
    const onPreview = vi.fn();
    render(
      <SkillsEditor
        value={resources}
        librarySkills={skills}
        skillUpdates={[{
          id: "review",
          name: "Code Review",
          sourceType: "github",
          updateAvailable: true
        }]}
        onPreviewSkillUpdate={onPreview}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onPreview).toHaveBeenCalledWith("review");
  });
});
