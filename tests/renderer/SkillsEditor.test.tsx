// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("projects an Off policy as disabled switches without allowing child edits", () => {
    const onChange = vi.fn();
    render(
      <SkillsEditor
        value={resources}
        librarySkills={skills}
        policy="disable"
        onChange={onChange}
      />
    );

    const skillSwitch = screen.getByRole("switch", { name: "Enable Code Review" });
    expect(skillSwitch).toBeDisabled();
    expect(skillSwitch).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Add Skill" })).toBeDisabled();
    fireEvent.click(skillSwitch);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("projects an Agent policy from the current target snapshot", () => {
    render(
      <SkillsEditor
        value={resources}
        librarySkills={skills}
        policy="ignore"
        currentSkillStates={{ review: false }}
        currentStateAvailable
        onChange={vi.fn()}
      />
    );

    const skillSwitch = screen.getByRole("switch", { name: "Enable Code Review" });
    expect(skillSwitch).toBeDisabled();
    expect(skillSwitch).not.toBeChecked();
  });

  it("shows only an authored version in the Profile row and toggles a Skill", () => {
    const onChange = vi.fn();
    render(<SkillsEditor value={resources} librarySkills={skills} onChange={onChange} />);

    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();
    expect(screen.queryByText(/GitHub|Local/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/library\/review/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Disable Code Review" }));
    expect(onChange).toHaveBeenCalledWith({
      ...resources,
      skills: [{ libraryId: "review", targetName: "review", enabled: false }]
    });
  });

  it("does not present a content hash as a version for an unversioned Skill", () => {
    render(
      <SkillsEditor
        value={{
          skills: [{ libraryId: "docs", targetName: "docs", enabled: true }],
          mcpByTarget: {}
        }}
        librarySkills={skills}
        onChange={vi.fn()}
      />
    );

    const row = screen.getByRole("listitem", { name: "Profile Skill docs" });
    expect(row).not.toHaveTextContent("123456a");
    expect(row).not.toHaveTextContent("Local");
  });

  it("adds selected globally available Skills from Library", () => {
    const onChange = vi.fn();
    render(<SkillsEditor value={resources} librarySkills={skills} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Skill" }));
    const dialog = screen.getByRole("dialog", { name: "Add library skills" });
    expect(dialog).toHaveClass("resource-picker-dialog", "resource-picker-dialog--skills");
    expect(within(dialog).getByRole("group", { name: "Library Skills" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "More actions for missing" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Relink missing" }));
    fireEvent.click(screen.getByRole("radio", { name: "Code Review" }));
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

    const checkButton = screen.getByRole("button", { name: "Check Profile Skill updates" });
    expect(checkButton).toHaveClass("ui-button", "ui-button--secondary");
    expect(checkButton).toHaveTextContent("Check updates");
    fireEvent.click(checkButton);
    expect(onCheck).toHaveBeenCalledWith(["review"]);
  });

  it("does not show an unavailable update action when no Profile Skill is tracked", () => {
    render(
      <SkillsEditor
        value={{
          skills: [{ libraryId: "docs", targetName: "docs", enabled: true }],
          mcpByTarget: {}
        }}
        librarySkills={skills}
        onCheckSkillUpdates={vi.fn()}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Check Profile Skill updates" }))
      .not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "More actions for Code Review" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Review update" }));
    expect(onPreview).toHaveBeenCalledWith("review");
  });

  it("keeps row actions behind one stable overflow control", () => {
    render(<SkillsEditor value={resources} librarySkills={skills} onChange={vi.fn()} />);

    const row = screen.getByRole("listitem", { name: "Profile Skill review" });
    expect(row).toHaveClass("ui-resource-row", "ui-resource-row--compact");
    expect(within(row).getByRole("switch", { name: "Disable Code Review" }))
      .toBeInTheDocument();
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(row).getByRole("button", { name: "More actions for Code Review" }));
    expect(screen.getByRole("menuitem", { name: "Remove from Profile" })).toBeInTheDocument();
  });

  it("shows a Target-local override instead of an Apply pending state", () => {
    render(
      <SkillsEditor
        value={resources}
        librarySkills={skills}
        appliedSkillVersions={{}}
        skillReceipts={[{
          path: "/target/skills/review",
          libraryId: "review",
          targetName: "review",
          desired: "install",
          observed: "external",
          authority: "leave-unmanaged",
          action: "preserve",
          outcome: "external-active",
          requiresReview: false,
          localOverride: true
        }]}
        selectedTargetName="Codex"
        onChange={vi.fn()}
      />
    );

    const row = screen.getByRole("listitem", { name: "Profile Skill review" });
    expect(row).toHaveTextContent("External active");
    expect(row).not.toHaveTextContent("Apply pending");
  });

  it("shows that a disabled Profile Skill remains active at an unmanaged path", () => {
    render(
      <SkillsEditor
        value={{
          ...resources,
          skills: [{ libraryId: "review", targetName: "review", enabled: false }]
        }}
        librarySkills={skills}
        appliedSkillVersions={{}}
        skillReceipts={[{
          path: "/target/skills/review",
          libraryId: "review",
          targetName: "review",
          desired: "omit",
          observed: "external",
          authority: "leave-unmanaged",
          action: "preserve",
          outcome: "external-remains",
          requiresReview: false,
          localOverride: true
        }]}
        selectedTargetName="Codex"
        onChange={vi.fn()}
      />
    );

    const row = screen.getByRole("listitem", { name: "Profile Skill review" });
    expect(row).toHaveTextContent("External still active");
    expect(row).not.toHaveTextContent("Apply pending");
  });
});
