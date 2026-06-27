// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillLibraryPanel } from "../../src/renderer/components/SkillLibraryPanel";

afterEach(() => {
  cleanup();
});

describe("SkillLibraryPanel", () => {
  it("keeps the skill list clean and routes secondary workflows through drawers and row actions", async () => {
    const onImportUnmanaged = vi.fn();
    const onImportGitHubSkill = vi.fn();
    const onPreviewLibrarySkillUpdate = vi.fn();
    const onUpdateLibrarySkill = vi.fn();
    const onUpdateAllLibrarySkills = vi.fn();
    const onCheckUpdates = vi.fn();
    const onSetUpdateSource = vi.fn();
    const onManageTargetSkill = vi.fn();
    const onCloseTool = vi.fn();
    const onSelectLocalSkillFolder = vi.fn().mockResolvedValue("/tmp/local-skills/path-reviewer");

    const renderPanel = (activeTool?: "import" | "discoveries") => (
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
          },
          {
            id: "shared-reviewer",
            name: "Shared Reviewer",
            sourceType: "local",
            currentRevision: "abc123",
            latestRevision: "abc124",
            updateAvailable: true
          },
          {
            id: "broken-reviewer",
            name: "Broken Reviewer",
            sourceType: "github",
            updateAvailable: false,
            error: "Network failed"
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
        skillUsage={{ "shared-reviewer": ["Daily Coding"] }}
        activeTool={activeTool}
        onCloseTool={onCloseTool}
        onSelectLocalSkillFolder={onSelectLocalSkillFolder}
        onImportUnmanaged={onImportUnmanaged}
        onImportGitHubSkill={onImportGitHubSkill}
        onPreviewLibrarySkillUpdate={onPreviewLibrarySkillUpdate}
        onUpdateLibrarySkill={onUpdateLibrarySkill}
        onUpdateAllLibrarySkills={onUpdateAllLibrarySkills}
        onCheckUpdates={onCheckUpdates}
        onSetUpdateSource={onSetUpdateSource}
        onManageTargetSkill={onManageTargetSkill}
      />
    );

    const { rerender } = render(renderPanel());

    expect(screen.getByRole("region", { name: "Skill library" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "GitHub skill import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Environment skills" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Library storage settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Library item shared-reviewer" })).toHaveTextContent(
      "Daily Coding"
    );
    expect(screen.getByRole("group", { name: "Library item github-reviewer" })).toHaveTextContent(
      "Update available"
    );

    fireEvent.click(screen.getByRole("button", { name: "Check updates" }));
    expect(onCheckUpdates).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update all skills" }));
    expect(onUpdateAllLibrarySkills).toHaveBeenCalledWith(["github-reviewer", "shared-reviewer"]);

    const sharedRow = screen.getByRole("group", { name: "Library item shared-reviewer" });
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
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

    rerender(renderPanel("import"));
    fireEvent.click(screen.getByRole("button", { name: "Choose local skill folder" }));
    expect(onSelectLocalSkillFolder).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText("Local skill folder path")).toHaveValue(
        "/tmp/local-skills/path-reviewer"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Import local skill" }));
    expect(onImportUnmanaged).toHaveBeenCalledWith("/tmp/local-skills/path-reviewer");

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

    rerender(renderPanel("discoveries"));
    const discoveries = screen.getByRole("region", { name: "Environment skills" });
    expect(discoveries).toHaveTextContent("Managed");
    expect(discoveries).toHaveTextContent("Imported");
    expect(discoveries).toHaveTextContent("Unmanaged");
    fireEvent.click(screen.getByRole("button", { name: "Manage legacy-reviewer" }));
    expect(onManageTargetSkill).toHaveBeenCalledWith({
      targetId: "opencode",
      targetName: "legacy-reviewer",
      libraryId: "legacy-reviewer"
    });
    fireEvent.click(screen.getByRole("button", { name: "Import target-only-reviewer" }));
    expect(onImportUnmanaged).toHaveBeenCalledWith("/tmp/opencode/skills/target-only-reviewer");
  });
});
