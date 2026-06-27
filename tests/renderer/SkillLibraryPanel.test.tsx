// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillLibraryPanel } from "../../src/renderer/components/SkillLibraryPanel";

afterEach(() => {
  cleanup();
});

describe("SkillLibraryPanel", () => {
  it("manages global library skills separately from profile resources", () => {
    const onImportUnmanaged = vi.fn();
    const onImportGitHubSkill = vi.fn();
    const onUpdateLibrarySkill = vi.fn();
    const onUpdateAllAvailable = vi.fn();
    const onCheckUpdates = vi.fn();
    const onSettingsChange = vi.fn();

    render(
      <SkillLibraryPanel
        librarySkills={[
          {
            id: "shared-reviewer",
            name: "Shared Reviewer",
            description: "Review code",
            path: "/tmp/skills-library/shared-reviewer",
            sourceType: "local",
            source: "/tmp/source/shared-reviewer",
            contentHash: "abc123",
            updatedAt: "2026-07-02T00:00:00.000Z"
          },
          {
            id: "github-reviewer",
            name: "GitHub Reviewer",
            description: "Review from GitHub",
            path: "/tmp/skills-library/github-reviewer",
            sourceType: "github",
            source: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
            remoteRef: "main",
            remoteRevision: "revision-1",
            contentHash: "def456",
            updatedAt: "2026-07-02T00:00:00.000Z"
          }
        ]}
        skillUpdates={[
          {
            id: "github-reviewer",
            name: "GitHub Reviewer",
            sourceType: "github",
            currentRevision: "revision-1",
            latestRevision: "revision-2",
            updateAvailable: true
          }
        ]}
        unmanagedSkills={[
          {
            id: "legacy-reviewer",
            name: "Legacy Reviewer",
            description: "Found on disk",
            path: "/tmp/opencode/skills/legacy-reviewer",
            foundIn: ["opencode"]
          }
        ]}
        skillSettings={{
          skillSyncMethod: "symlink",
          skillStorageLocation: "appData"
        }}
        skillUsage={{ "shared-reviewer": ["Daily Coding"] }}
        onImportUnmanaged={onImportUnmanaged}
        onImportGitHubSkill={onImportGitHubSkill}
        onUpdateLibrarySkill={onUpdateLibrarySkill}
        onUpdateAllAvailable={onUpdateAllAvailable}
        onCheckUpdates={onCheckUpdates}
        onSkillSettingsChange={onSettingsChange}
      />
    );

    expect(screen.getByRole("region", { name: "Skill library" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Library item shared-reviewer" })).toHaveTextContent(
      "Daily Coding"
    );
    expect(screen.getByRole("group", { name: "Library item github-reviewer" })).toHaveTextContent(
      "Update available"
    );

    fireEvent.click(screen.getByRole("button", { name: "Check updates" }));
    expect(onCheckUpdates).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update all" }));
    expect(onUpdateAllAvailable).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("GitHub skill URL"), {
      target: { value: "https://github.com/acme/agent-skills/tree/main/skills/reviewer" }
    });
    fireEvent.change(screen.getByLabelText("GitHub skill library id"), {
      target: { value: "github-reviewer" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Import from GitHub" }));
    expect(onImportGitHubSkill).toHaveBeenCalledWith({
      url: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
      id: "github-reviewer"
    });

    fireEvent.click(screen.getByRole("button", { name: "Update shared-reviewer" }));
    expect(onUpdateLibrarySkill).toHaveBeenCalledWith("shared-reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Import legacy-reviewer" }));
    expect(onImportUnmanaged).toHaveBeenCalledWith("/tmp/opencode/skills/legacy-reviewer");
    fireEvent.change(screen.getByLabelText("Skill sync method"), {
      target: { value: "copy" }
    });
    expect(onSettingsChange).toHaveBeenCalledWith({ skillSyncMethod: "copy" });
  });
});
