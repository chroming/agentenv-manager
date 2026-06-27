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
    const onPreviewLibrarySkillUpdate = vi.fn();
    const onUpdateLibrarySkill = vi.fn();
    const onCheckUpdates = vi.fn();
    const onSetUpdateSource = vi.fn();
    const onManageTargetSkill = vi.fn();
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
        skillInventory={[
          {
            id: "shared-reviewer",
            name: "Shared Reviewer",
            description: "Review code",
            path: "/tmp/opencode/skills/shared-reviewer",
            foundIn: ["opencode"],
            status: "managed",
            libraryId: "shared-reviewer"
          },
          {
            id: "legacy-reviewer",
            name: "Legacy Reviewer",
            description: "Found on disk",
            path: "/tmp/opencode/skills/legacy-reviewer",
            foundIn: ["opencode"],
            status: "library",
            libraryId: "legacy-reviewer"
          },
          {
            id: "target-only-reviewer",
            name: "Target Only Reviewer",
            description: "Found on disk",
            path: "/tmp/opencode/skills/target-only-reviewer",
            foundIn: ["opencode"],
            status: "unmanaged"
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
        selectedUpdatePlan={{
          id: "shared-reviewer",
          name: "Shared Reviewer",
          sourceType: "local",
          source: "/tmp/source/shared-reviewer",
          currentRevision: "abc123",
          latestRevision: "abc124",
          updateAvailable: true,
          changes: [
            {
              path: "SKILL.md",
              before: "# v1\n",
              after: "# v2\n",
              diff: "--- before\n+++ after\n@@\n-# v1\n+# v2\n"
            }
          ],
          errors: []
        }}
        skillSettings={{
          skillSyncMethod: "symlink",
          skillStorageLocation: "appData"
        }}
        skillUsage={{ "shared-reviewer": ["Daily Coding"] }}
        onImportUnmanaged={onImportUnmanaged}
        onImportGitHubSkill={onImportGitHubSkill}
        onPreviewLibrarySkillUpdate={onPreviewLibrarySkillUpdate}
        onUpdateLibrarySkill={onUpdateLibrarySkill}
        onCheckUpdates={onCheckUpdates}
        onSetUpdateSource={onSetUpdateSource}
        onManageTargetSkill={onManageTargetSkill}
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
    expect(screen.queryByRole("button", { name: "Update all" })).not.toBeInTheDocument();

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

    expect(screen.getByRole("region", { name: "Environment skills" })).toHaveTextContent(
      "Managed"
    );
    expect(screen.getByRole("region", { name: "Environment skills" })).toHaveTextContent(
      "Imported"
    );
    expect(screen.getByRole("region", { name: "Environment skills" })).toHaveTextContent(
      "Unmanaged"
    );

    fireEvent.change(screen.getByLabelText("Update source for shared-reviewer"), {
      target: { value: "/tmp/source/shared-reviewer" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save source for shared-reviewer" }));
    expect(onSetUpdateSource).toHaveBeenCalledWith({
      id: "shared-reviewer",
      sourceType: "local",
      source: "/tmp/source/shared-reviewer"
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview update shared-reviewer" }));
    expect(onPreviewLibrarySkillUpdate).toHaveBeenCalledWith("shared-reviewer");
    expect(screen.getByRole("region", { name: "Update preview for shared-reviewer" })).toHaveTextContent(
      "SKILL.md"
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply update shared-reviewer" }));
    expect(onUpdateLibrarySkill).toHaveBeenCalledWith("shared-reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Manage legacy-reviewer" }));
    expect(onManageTargetSkill).toHaveBeenCalledWith({
      targetId: "opencode",
      targetName: "legacy-reviewer",
      libraryId: "legacy-reviewer"
    });
    fireEvent.click(screen.getByRole("button", { name: "Import target-only-reviewer" }));
    expect(onImportUnmanaged).toHaveBeenCalledWith("/tmp/opencode/skills/target-only-reviewer");
    fireEvent.change(screen.getByLabelText("Skill sync method"), {
      target: { value: "copy" }
    });
    expect(onSettingsChange).toHaveBeenCalledWith({ skillSyncMethod: "copy" });
  });
});
