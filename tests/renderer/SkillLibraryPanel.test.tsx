// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillLibraryPanel } from "../../src/renderer/components/SkillLibraryPanel";
import { defaultSkillLibraryViewState } from "../../src/renderer/libraryViewState";

afterEach(() => {
  cleanup();
});

describe("SkillLibraryPanel", () => {
  it("keeps the skill list clean and routes secondary workflows through drawers and row actions", async () => {
    const onImportUnmanaged = vi.fn();
    const onImportGitHubSkill = vi.fn();
    const onPreviewLibrarySkillUpdate = vi.fn();
    const onCloseUpdatePreview = vi.fn();
    const onUpdateLibrarySkill = vi.fn();
    const onUpdateAllLibrarySkills = vi.fn();
    const onPreviewAllLibrarySkillUpdates = vi.fn();
    const onCloseBulkUpdatePreview = vi.fn();
    const onSyncSkillInstalls = vi.fn();
    const onRemoveLibrarySkill = vi.fn();
    const onReviewSkillUsage = vi.fn();
    const onCheckUpdates = vi.fn();
    const onOpenSource = vi.fn();
    const onSetUpdateSource = vi.fn();
    const onSetUpdateCheckEnabled = vi.fn();
    const onManageTargetSkill = vi.fn();
    const onConsolidateSkillGroup = vi.fn();
    const onIgnoreSkillGroup = vi.fn();
    const onUnignoreSkillGroup = vi.fn();
    const onRestoreCleanup = vi.fn();
    const onCloseTool = vi.fn();
    const onViewStateChange = vi.fn();
    const onSelectLocalSkillFolder = vi.fn().mockResolvedValue("/tmp/local-skills/path-reviewer");

    const renderPanel = (
      activeTool?: "import" | "discoveries",
      bulkUpdatePlans?: Array<{
        id: string;
        name: string;
        sourceType: "local";
        updateAvailable: boolean;
        changes: Array<{ path: string; before: string; after: string; diff: string }>;
        errors: string[];
      }>,
      showSelectedUpdatePlan = false
    ) => (
      <SkillLibraryPanel
        librarySkills={[
          {
            id: "shared-reviewer",
            name: "Shared Reviewer",
            description: "Review code",
            path: "/tmp/skills-library/shared-reviewer",
            sourceType: "local",
            source: "/tmp/source/shared-reviewer",
            updateCheckEnabled: true,
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
            updateCheckEnabled: true,
            remoteRef: "main",
            remoteRevision: "revision-1",
            contentHash: "def456",
            updatedAt: "2026-07-02T00:00:00.000Z"
          },
          {
            id: "copied-local",
            name: "Copied Local",
            description: "Copied into the library",
            path: "/tmp/skills-library/copied-local",
            sourceType: "local",
            updateCheckEnabled: false,
            contentHash: "ghi789",
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
            libraryId: "shared-reviewer",
            skillKey: "shared-reviewer",
            contentHash: "shared-hash",
            installMethod: "linked",
            contentMatchesLibrary: true
          },
          {
            id: "copied-local",
            name: "Copied Local",
            description: "Managed target install",
            path: "/tmp/opencode/skills/copied-local",
            foundIn: ["opencode"],
            status: "managed",
            libraryId: "copied-local",
            skillKey: "copied-local",
            contentHash: "copied-hash",
            installMethod: "copied",
            contentMatchesLibrary: false
          },
          {
            id: "legacy-reviewer",
            name: "Legacy Reviewer",
            description: "Found on disk",
            path: "/tmp/opencode/skills/legacy-reviewer",
            foundIn: ["opencode"],
            status: "library",
            libraryId: "legacy-reviewer",
            skillKey: "legacy-reviewer",
            contentHash: "legacy-hash"
          },
          {
            id: "target-only-reviewer",
            name: "Target Only Reviewer",
            description: "Found on disk",
            path: "/tmp/opencode/skills/target-only-reviewer",
            foundIn: ["opencode"],
            status: "unmanaged",
            skillKey: "target-only-reviewer",
            contentHash: "target-only-hash"
          },
          {
            id: "target-only-reviewer",
            name: "Target Only Reviewer",
            description: "Found on disk",
            path: "/tmp/codex/skills/target-only-reviewer",
            foundIn: ["codex"],
            status: "ignored",
            libraryId: undefined,
            skillKey: "target-only-reviewer",
            contentHash: "target-only-hash",
            ignoreRuleId: "ignore-target-only-reviewer"
          },
          {
            id: "conflict-reviewer",
            name: "Conflict Reviewer With A Deliberately Long Display Name",
            description: "Preserve the OpenCode variant with its full review workflow and detailed instructions.",
            path: "/tmp/opencode/skills/a-very-long-parent-directory/conflict-reviewer",
            foundIn: ["opencode"],
            status: "unmanaged",
            skillKey: "conflict-reviewer",
            contentHash: "opencode-conflict-hash"
          },
          {
            id: "conflict-reviewer",
            name: "Conflict Reviewer With A Deliberately Long Display Name",
            description: "Preserve the Codex variant with its alternate review workflow and detailed instructions.",
            path: "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer",
            foundIn: ["codex"],
            status: "unmanaged",
            skillKey: "conflict-reviewer",
            contentHash: "codex-conflict-hash"
          }
        ]}
        cleanupBackups={[
          {
            id: "cleanup-1",
            libraryId: "shared-reviewer",
            createdAt: "2026-07-10T08:00:00.000Z",
            locationCount: 2
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
        selectedUpdatePlan={showSelectedUpdatePlan ? {
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
        } : undefined}
        bulkUpdatePlans={bulkUpdatePlans}
        skillUsage={{ "shared-reviewer": ["Daily Coding"] }}
        activeTool={activeTool}
        onCloseTool={onCloseTool}
        onSelectLocalSkillFolder={onSelectLocalSkillFolder}
        onImportUnmanaged={onImportUnmanaged}
        onImportGitHubSkill={onImportGitHubSkill}
        onPreviewLibrarySkillUpdate={onPreviewLibrarySkillUpdate}
        onCloseUpdatePreview={onCloseUpdatePreview}
        onUpdateLibrarySkill={onUpdateLibrarySkill}
        onUpdateAllLibrarySkills={onUpdateAllLibrarySkills}
        onPreviewAllLibrarySkillUpdates={onPreviewAllLibrarySkillUpdates}
        onCloseBulkUpdatePreview={onCloseBulkUpdatePreview}
        onSyncSkillInstalls={onSyncSkillInstalls}
        onRemoveLibrarySkill={onRemoveLibrarySkill}
        onReviewSkillUsage={onReviewSkillUsage}
        onCheckUpdates={onCheckUpdates}
        onOpenSource={onOpenSource}
        onSetUpdateSource={onSetUpdateSource}
        onSetUpdateCheckEnabled={onSetUpdateCheckEnabled}
        onManageTargetSkill={onManageTargetSkill}
        onConsolidateSkillGroup={onConsolidateSkillGroup}
        onIgnoreSkillGroup={onIgnoreSkillGroup}
        onUnignoreSkillGroup={onUnignoreSkillGroup}
        onRestoreCleanup={onRestoreCleanup}
        updateCheckStatus={{ state: "success", message: "2 updates available" }}
        viewState={{ ...defaultSkillLibraryViewState, scrollTop: 180 }}
        onViewStateChange={onViewStateChange}
      />
    );

    const { rerender } = render(renderPanel());

    fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), {
      target: { value: "github" }
    });
    expect(onViewStateChange).toHaveBeenCalledWith({
      ...defaultSkillLibraryViewState,
      search: "github",
      scrollTop: 0
    });

    expect(screen.getByRole("region", { name: "Skill library" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "GitHub skill import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Environment skills" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Library storage settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Library item shared-reviewer" })).toHaveTextContent(
      "Daily Coding"
    );
    const sharedDescription = screen.getByText("Review code");
    expect(sharedDescription).not.toHaveAttribute("title");
    fireEvent.mouseEnter(sharedDescription);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Review code");
    fireEvent.mouseLeave(sharedDescription);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Library item github-reviewer" })).toHaveTextContent(
      "Update available"
    );
    const githubRow = screen.getByRole("group", { name: "Library item github-reviewer" });
    const githubSource = within(githubRow).getByLabelText("Full source for github-reviewer");
    expect(githubSource).not.toHaveAttribute("title");
    fireEvent.mouseEnter(githubSource);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "https://github.com/acme/agent-skills/tree/main/skills/reviewer"
    );
    fireEvent.mouseLeave(githubSource);
    fireEvent.click(
      within(githubRow).getByRole("button", { name: "Open GitHub source for github-reviewer" })
    );
    expect(onOpenSource).toHaveBeenCalledWith(
      "https://github.com/acme/agent-skills/tree/main/skills/reviewer"
    );
    const localSource = within(
      screen.getByRole("group", { name: "Library item shared-reviewer" })
    ).getByLabelText("Full source for shared-reviewer");
    fireEvent.focus(localSource);
    expect(screen.getByRole("tooltip")).toHaveTextContent("/tmp/source/shared-reviewer");
    fireEvent.blur(localSource);
    const copiedLocalRow = screen.getByRole("group", { name: "Library item copied-local" });
    expect(copiedLocalRow).toHaveTextContent("Checks off");
    expect(copiedLocalRow).toHaveTextContent("Needs sync");
    expect(within(copiedLocalRow).queryByRole("button", { name: /Check update/ })).toBeNull();
    fireEvent.click(
      within(copiedLocalRow).getByRole("button", { name: "Sync install of copied-local" })
    );
    expect(onSyncSkillInstalls).toHaveBeenCalledWith("copied-local");
    fireEvent.click(
      within(copiedLocalRow).getByRole("button", { name: "More actions for copied-local" })
    );
    expect(screen.getByLabelText("Update source for copied-local")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check updates" }));
    expect(onCheckUpdates).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update all skills" }));
    expect(onPreviewAllLibrarySkillUpdates).toHaveBeenCalledWith([
      "github-reviewer",
      "shared-reviewer"
    ]);

    const sharedRow = screen.getByRole("group", { name: "Library item shared-reviewer" });
    expect(sharedRow).toHaveTextContent("Live link");
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText("Update source for shared-reviewer")).not.toBeInTheDocument();
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Update source for shared-reviewer")).not.toBeInTheDocument();
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.change(screen.getByLabelText("Update source for shared-reviewer"), {
      target: { value: "/tmp/source/shared-reviewer" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save source" }));
    expect(onSetUpdateSource).toHaveBeenCalledWith({
      id: "shared-reviewer",
      sourceType: "local",
      source: "/tmp/source/shared-reviewer"
    });

    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    const updateCheckSwitch = screen.getByRole("switch", {
      name: "Update checks for shared-reviewer"
    });
    expect(updateCheckSwitch).toHaveAttribute("aria-checked", "true");
    fireEvent.click(updateCheckSwitch);
    expect(onSetUpdateCheckEnabled).toHaveBeenCalledWith({
      id: "shared-reviewer",
      enabled: false
    });

    fireEvent.click(screen.getByRole("button", { name: "Review update shared-reviewer" }));
    expect(onPreviewLibrarySkillUpdate).toHaveBeenCalledWith("shared-reviewer");
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Preview update/ }));
    expect(onPreviewLibrarySkillUpdate).toHaveBeenCalledTimes(2);
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove from library/ }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete library skill" });
    expect(deleteDialog).toHaveTextContent("Shared Reviewer");
    expect(deleteDialog).toHaveTextContent("used by Daily Coding");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Review profiles" }));
    expect(onReviewSkillUsage).toHaveBeenCalledWith("shared-reviewer");
    expect(onRemoveLibrarySkill).not.toHaveBeenCalled();
    fireEvent.click(
      within(copiedLocalRow).getByRole("button", { name: "More actions for copied-local" })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove from library/ }));
    const installedDeleteDialog = screen.getByRole("dialog", { name: "Delete library skill" });
    expect(installedDeleteDialog).toHaveTextContent("1 managed target install");
    fireEvent.click(
      within(installedDeleteDialog).getByRole("button", { name: "Remove skill and installs" })
    );
    expect(onRemoveLibrarySkill).toHaveBeenCalledWith("copied-local");
    rerender(renderPanel(undefined, undefined, true));
    expect(screen.getByRole("dialog", { name: "Update preview for shared-reviewer" })).toHaveTextContent(
      "SKILL.md"
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply update shared-reviewer" }));
    expect(onUpdateLibrarySkill).toHaveBeenCalledTimes(1);

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
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseTool).toHaveBeenCalledTimes(1);

    rerender(renderPanel("discoveries"));
    const discoveries = screen.getByRole("region", { name: "Environment skills" });
    fireEvent.mouseDown(document.body);
    expect(onCloseTool).toHaveBeenCalledTimes(2);
    expect(discoveries).toHaveTextContent("Managed");
    expect(discoveries).toHaveTextContent("Imported");
    expect(discoveries).toHaveTextContent("Restore ignored");
    expect(screen.getByRole("region", { name: "Cleanup history" })).toHaveTextContent(
      "shared-reviewer"
    );
    expect(
      screen.getByRole("region", { name: "Cleanup history" }).querySelector(".cleanup-history-row")
    ).toHaveClass("resource-row");
    fireEvent.click(screen.getByRole("button", { name: "Restore cleanup shared-reviewer" }));
    expect(onRestoreCleanup).toHaveBeenCalledWith("cleanup-1");
    expect(screen.getByRole("group", { name: "Cleanup group target-only-reviewer" })).toHaveTextContent(
      "2 locations"
    );
    const mixedGroup = screen.getByRole("group", { name: "Cleanup group target-only-reviewer" });
    expect(mixedGroup).toHaveTextContent("Unmanaged");
    expect(within(mixedGroup).queryByText("Ignored", { exact: true })).not.toBeInTheDocument();
    expect(
      within(mixedGroup).getByRole("button", { name: "Add to Library target-only-reviewer" })
    ).toBeInTheDocument();
    expect(
      within(mixedGroup).queryByRole("button", { name: "Ignore group target-only-reviewer" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unignore group target-only-reviewer" }));
    expect(onUnignoreSkillGroup).toHaveBeenCalledWith("target-only-reviewer");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Cleanup group legacy-reviewer" })).getByRole(
        "button",
        { name: "Use Library version legacy-reviewer" }
      )
    );
    const cleanupDialog = screen.getByRole("dialog", { name: "Review skill cleanup" });
    expect(cleanupDialog).toHaveTextContent("Existing Library version");
    expect(cleanupDialog).not.toHaveTextContent("Canonical copy");
    fireEvent.click(within(cleanupDialog).getByRole("button", { name: "Back up and manage" }));
    expect(onConsolidateSkillGroup).toHaveBeenCalledWith({
      skillKey: "legacy-reviewer",
      libraryId: "legacy-reviewer",
      canonicalPath: "/tmp/opencode/skills/legacy-reviewer",
      locations: [
        { targetId: "opencode", path: "/tmp/opencode/skills/legacy-reviewer" }
      ]
    });

    const conflictGroup = screen.getByRole("group", { name: "Cleanup group conflict-reviewer" });
    expect(conflictGroup).toHaveTextContent("Conflict");
    fireEvent.click(
      within(conflictGroup).getByRole("button", { name: "Ignore group conflict-reviewer" })
    );
    expect(onIgnoreSkillGroup).toHaveBeenCalledWith("conflict-reviewer");
    fireEvent.focus(
      within(conflictGroup).getByLabelText("Full cleanup locations conflict-reviewer")
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer"
    );
    fireEvent.blur(
      within(conflictGroup).getByLabelText("Full cleanup locations conflict-reviewer")
    );
    fireEvent.click(
      within(conflictGroup).getByRole("button", { name: "Resolve conflict conflict-reviewer" })
    );
    let conflictDialog = screen.getByRole("dialog", { name: "Review skill cleanup" });
    expect(conflictDialog).toHaveTextContent("Version to keep in Library");
    expect(conflictDialog).toHaveTextContent("Choose the copy whose contents you want to preserve");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Review skill cleanup" })).not.toBeInTheDocument();
    expect(onCloseTool).toHaveBeenCalledTimes(2);
    fireEvent.click(
      within(conflictGroup).getByRole("button", { name: "Resolve conflict conflict-reviewer" })
    );
    conflictDialog = screen.getByRole("dialog", { name: "Review skill cleanup" });
    const codexVersion = within(conflictDialog).getByRole("radio", { name: /Codex/ });
    fireEvent.click(codexVersion);
    const codexLocation = within(conflictDialog).getByRole("checkbox", { name: /Codex/ });
    expect(codexLocation).toBeChecked();
    expect(codexLocation).toBeDisabled();
    fireEvent.focus(
      within(conflictDialog).getByLabelText(
        "Full source path /tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer"
      )
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer"
    );
    fireEvent.click(within(conflictDialog).getByRole("button", { name: "Back up and manage" }));
    expect(onConsolidateSkillGroup).toHaveBeenCalledWith({
      skillKey: "conflict-reviewer",
      libraryId: "conflict-reviewer",
      canonicalPath: "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer",
      locations: [
        {
          targetId: "opencode",
          path: "/tmp/opencode/skills/a-very-long-parent-directory/conflict-reviewer"
        },
        {
          targetId: "codex",
          path: "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer"
        }
      ]
    });

    rerender(
      renderPanel(undefined, [
        {
          id: "shared-reviewer",
          name: "Shared Reviewer",
          sourceType: "local",
          updateAvailable: true,
          changes: [{ path: "SKILL.md", before: "old", after: "new", diff: "diff" }],
          errors: []
        },
        {
          id: "broken-reviewer",
          name: "Broken Reviewer",
          sourceType: "local",
          updateAvailable: false,
          changes: [],
          errors: ["Source unavailable"]
        }
      ])
    );
    const bulkDialog = screen.getByRole("dialog", { name: "Review all skill updates" });
    const partialApply = within(bulkDialog).getByRole("button", { name: "Apply 1 updates" });
    expect(partialApply).toBeEnabled();
    fireEvent.click(partialApply);
    expect(onUpdateAllLibrarySkills).toHaveBeenCalledWith(["shared-reviewer"]);
  });
});
