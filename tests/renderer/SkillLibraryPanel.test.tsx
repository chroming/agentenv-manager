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
    const onImportUnmanaged = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const onScanGitHubSkills = vi.fn().mockResolvedValue({
      owner: "acme",
      repo: "agent-skills",
      ref: "main",
      rootPath: "skills",
      truncated: false,
      candidates: [
        {
          id: "github-reviewer",
          name: "GitHub Reviewer",
          description: "Review from GitHub",
          remotePath: "skills/reviewer",
          sourceUrl: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
          ref: "main",
          revision: "revision-1",
          status: "ready"
        },
        {
          id: "release-check",
          name: "Release Check",
          description: "Check a release from GitHub",
          remotePath: "skills/release-check",
          sourceUrl: "https://github.com/acme/agent-skills/tree/main/skills/release-check",
          ref: "main",
          revision: "revision-1",
          status: "ready"
        }
      ]
    });
    const onImportGitHubSkills = vi.fn().mockResolvedValue({ imported: [], failed: [] });
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
    const onImportExternal = vi.fn().mockResolvedValue(true);
    const onSetUpdatePolicy = vi.fn();
    let resolveAvailability: ((succeeded: boolean) => void) | undefined;
    const onSetAvailability = vi.fn(
      () => new Promise<boolean>((resolve) => (resolveAvailability = resolve))
    );
    const onSetIcon = vi.fn();
    const onManageTargetSkill = vi.fn();
    const onConsolidateSkillGroup = vi.fn();
    const onAutoConsolidateSkillGroups = vi.fn().mockResolvedValue(undefined);
    const onIgnoreSkillGroup = vi.fn();
    const onUnignoreSkillGroup = vi.fn();
    const onSetSharedSkillRetention = vi.fn().mockResolvedValue(true);
    const onRetireSharedSkill = vi.fn().mockResolvedValue(true);
    const onOpenProfiles = vi.fn();
    const onRestoreCleanup = vi.fn();
    const onCloseTool = vi.fn();
    const onRefreshInventory = vi.fn().mockResolvedValue(undefined);
    const onViewStateChange = vi.fn();
    const onSelectLocalSkillFolder = vi.fn().mockResolvedValue(
      "/tmp/opencode/skills/target-only-reviewer"
    );

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
            updatePolicy: "tracked",
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
            updatePolicy: "tracked",
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
            updatePolicy: "untracked",
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
            foundIn: ["opencode", "codex"],
            status: "managed",
            libraryId: "shared-reviewer",
            skillKey: "shared-reviewer",
            contentHash: "shared-hash",
            installMethod: "linked",
            contentMatchesLibrary: true
          },
          {
            id: "compat-reviewer",
            name: "Compatibility Reviewer",
            description: "Shared migration source",
            path: "/tmp/home/.agents/skills/compat-reviewer",
            foundIn: ["opencode", "codex"],
            status: "library",
            libraryId: "compat-reviewer",
            skillKey: "compat-reviewer",
            contentHash: "compat-hash",
            contentMatchesLibrary: true,
            locationRole: "compatibility-runtime",
            sharedLocation: true
          },
          {
            id: "compat-reviewer",
            name: "Compatibility Reviewer",
            description: "Managed OpenCode copy",
            path: "/tmp/opencode/skills/compat-reviewer",
            foundIn: ["opencode"],
            status: "managed",
            libraryId: "compat-reviewer",
            skillKey: "compat-reviewer",
            contentHash: "compat-hash",
            contentMatchesLibrary: true,
            locationRole: "preferred-runtime",
            sharedLocation: false
          },
          {
            id: "compat-reviewer",
            name: "Compatibility Reviewer",
            description: "Managed Codex copy",
            path: "/tmp/codex/skills/compat-reviewer",
            foundIn: ["codex"],
            status: "managed",
            libraryId: "compat-reviewer",
            skillKey: "compat-reviewer",
            contentHash: "compat-hash",
            contentMatchesLibrary: true,
            locationRole: "preferred-runtime",
            sharedLocation: false
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
            contentHash: "legacy-hash",
            contentMatchesLibrary: true
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
          },
          {
            id: "external-reviewer",
            name: "External Reviewer",
            description: "Installed with Skills CLI",
            path: "/tmp/opencode/skills/external-reviewer",
            foundIn: ["opencode"],
            status: "external",
            skillKey: "external-reviewer",
            contentHash: "external-hash",
            externalOwnership: {
              manager: "skills-cli",
              lockPath: "/tmp/home/.agents/.skill-lock.json",
              lockVersion: 3,
              canonicalPath: "/tmp/home/.agents/skills/external-reviewer",
              confidence: "confirmed",
              state: "healthy",
              upstream: {
                kind: "github",
                locator: "https://github.com/acme/skills",
                ref: "main",
                subpath: "skills/external-reviewer"
              }
            }
          },
          {
            id: "external-reviewer",
            name: "External Reviewer Local Copy",
            description: "Same identity without external ownership",
            path: "/tmp/codex/skills/external-reviewer",
            foundIn: ["codex"],
            status: "unmanaged",
            skillKey: "external-reviewer",
            contentHash: "local-copy-hash"
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
        installedTargetIds={["opencode", "codex"]}
        preparedTargetsBySkill={{
          "compat-reviewer": [
            { targetId: "opencode", targetName: "compat-reviewer", disposition: "install" },
            { targetId: "codex", targetName: "compat-reviewer", disposition: "omit" }
          ]
        }}
        activeTool={activeTool}
        isRefreshingInventory={false}
        onCloseTool={onCloseTool}
        onRefreshInventory={onRefreshInventory}
        onSelectLocalSkillFolder={onSelectLocalSkillFolder}
        onImportUnmanaged={onImportUnmanaged}
        onImportExternal={onImportExternal}
        onScanGitHubSkills={onScanGitHubSkills}
        onImportGitHubSkills={onImportGitHubSkills}
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
        onSetUpdatePolicy={onSetUpdatePolicy}
        onSetAvailability={onSetAvailability}
        onSetIcon={onSetIcon}
        onManageTargetSkill={onManageTargetSkill}
        onConsolidateSkillGroup={onConsolidateSkillGroup}
        onAutoConsolidateSkillGroups={onAutoConsolidateSkillGroups}
        onIgnoreSkillGroup={onIgnoreSkillGroup}
        onUnignoreSkillGroup={onUnignoreSkillGroup}
        onSetSharedSkillRetention={onSetSharedSkillRetention}
        onRetireSharedSkill={onRetireSharedSkill}
        onOpenProfiles={onOpenProfiles}
        onRestoreCleanup={onRestoreCleanup}
        updateCheckStatus={{ state: "success", message: "2 updates available" }}
        viewState={{ ...defaultSkillLibraryViewState, scrollTop: 180 }}
        onViewStateChange={onViewStateChange}
      />
    );

    const { rerender } = render(renderPanel());

    const sharedIcon = screen.getByRole("button", { name: "Change icon for Shared Reviewer" });
    expect(sharedIcon).toHaveAttribute("data-icon", "folder");
    fireEvent.click(sharedIcon);
    const iconMenu = screen.getByRole("menu", { name: "Icons for Shared Reviewer" });
    fireEvent.click(within(iconMenu).getByRole("menuitemradio", { name: "Rocket" }));
    expect(onSetIcon).toHaveBeenCalledWith({ id: "shared-reviewer", iconKey: "rocket" });
    expect(
      screen.getByRole("button", { name: "Change icon for GitHub Reviewer" })
    ).toHaveAttribute("data-icon", "github");

    fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), {
      target: { value: "github" }
    });
    expect(onViewStateChange).toHaveBeenCalledWith({
      ...defaultSkillLibraryViewState,
      search: "github",
      scrollTop: 0
    });

    expect(screen.getByRole("region", { name: "Skill library" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Import skills" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Environment skills" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Library storage settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Library item shared-reviewer" })).toHaveTextContent(
      "Daily Coding"
    );
    const sharedDescription = screen.getByText("Review code");
    expect(sharedDescription).not.toHaveAttribute("title");
    fireEvent.mouseEnter(sharedDescription);
    const descriptionTooltip = screen.getByRole("tooltip");
    expect(descriptionTooltip).toHaveTextContent("Review code");
    fireEvent.mouseLeave(sharedDescription);
    fireEvent.mouseEnter(descriptionTooltip);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Review code");
    fireEvent.mouseLeave(descriptionTooltip);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    const githubRow = screen.getByRole("group", { name: "Library item github-reviewer" });
    expect(
      within(githubRow).getByRole("button", { name: "Review update github-reviewer" })
    ).toHaveTextContent("Update");
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
    expect(copiedLocalRow).toHaveTextContent("Not tracked");
    expect(copiedLocalRow).toHaveTextContent("1 out of sync");
    expect(within(copiedLocalRow).queryByRole("button", { name: /Check update/ })).toBeNull();
    fireEvent.click(
      within(copiedLocalRow).getByRole("button", { name: "Sync install of copied-local" })
    );
    expect(onSyncSkillInstalls).toHaveBeenCalledWith("copied-local");
    fireEvent.click(
      within(copiedLocalRow).getByRole("button", { name: "More actions for copied-local" })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Update settings" }));
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Update settings" }));
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Update settings" }));
    const updateCheckSwitch = screen.getByRole("switch", {
      name: "Track updates for shared-reviewer"
    });
    expect(updateCheckSwitch).toHaveAttribute("aria-checked", "true");
    fireEvent.click(updateCheckSwitch);
    expect(onSetUpdatePolicy).toHaveBeenCalledWith({
      id: "shared-reviewer",
      policy: "untracked"
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Review update shared-reviewer" }));
    expect(onPreviewLibrarySkillUpdate).toHaveBeenCalledWith("shared-reviewer");
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Preview update/ }));
    expect(onPreviewLibrarySkillUpdate).toHaveBeenCalledTimes(2);
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Disable globally/ }));
    const disableDialog = screen.getByRole("dialog", { name: "Disable library skill" });
    expect(disableDialog).toHaveTextContent("1 Profile");
    expect(disableDialog).toHaveTextContent("removed the next time that Profile is applied");
    fireEvent.click(within(disableDialog).getByRole("button", { name: "Disable globally" }));
    expect(onSetAvailability).toHaveBeenCalledWith({ id: "shared-reviewer", enabled: false });
    expect(within(sharedRow).getByText("Disabling...")).toBeInTheDocument();
    expect(within(disableDialog).getByRole("button", { name: "Disabling..." })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Disable library skill" })).toBeInTheDocument();
    resolveAvailability?.(true);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Disable library skill" })).not.toBeInTheDocument()
    );
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
        "/tmp/opencode/skills/target-only-reviewer"
      )
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "back up this Target copy"
    );
    const localImportButton = screen.getByRole("button", { name: "Import & manage" });
    fireEvent.click(localImportButton);
    await waitFor(() =>
      expect(screen.getByLabelText("Local skill folder path")).toHaveValue(
        "/tmp/opencode/skills/target-only-reviewer"
      )
    );
    fireEvent.click(localImportButton);
    await waitFor(() => expect(screen.getByLabelText("Local skill folder path")).toHaveValue(""));
    expect(onImportUnmanaged).toHaveBeenCalledWith(
      "/tmp/opencode/skills/target-only-reviewer"
    );

    fireEvent.click(screen.getByRole("tab", { name: "GitHub" }));
    fireEvent.change(screen.getByLabelText("GitHub skill URL"), {
      target: { value: "https://github.com/acme/agent-skills/tree/main/skills/reviewer" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^Scan$/ }));
    await screen.findByRole("checkbox", { name: "Select GitHub Reviewer" });
    const selectAllGitHub = screen.getByRole("checkbox", {
      name: "Select all discovered skills"
    }) as HTMLInputElement;
    expect(screen.getByRole("checkbox", { name: "Select GitHub Reviewer" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Release Check" })).toBeChecked();
    expect(selectAllGitHub).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("2 selected");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Release Check" }));
    expect(selectAllGitHub).not.toBeChecked();
    expect(selectAllGitHub.indeterminate).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("1 selected");
    fireEvent.click(screen.getByRole("button", { name: "Import 1" }));
    await waitFor(() =>
      expect(onImportGitHubSkills).toHaveBeenCalledWith([
        {
          url: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
          id: "github-reviewer",
          ref: "main",
          remotePath: "skills/reviewer"
        }
      ])
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseTool).toHaveBeenCalledTimes(2);

    rerender(renderPanel("discoveries"));
    const discoveries = screen.getByRole("region", { name: "Environment skills" });
    fireEvent.click(within(discoveries).getByRole("button", { name: "Refresh local skills" }));
    expect(onRefreshInventory).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onCloseTool).toHaveBeenCalledTimes(3);
    expect(discoveries).toHaveTextContent("Managed");
    expect(discoveries).toHaveTextContent("Not in Library");
    expect(discoveries).toHaveTextContent("Multiple versions");
    expect(discoveries).toHaveTextContent("Managed elsewhere");
    expect(discoveries).toHaveTextContent("Shared: OpenCode + Codex");
    const sharedMigrationGroup = screen.getByRole("group", {
      name: "Cleanup group compat-reviewer"
    });
    expect(sharedMigrationGroup).toHaveTextContent("Shared copy can be replaced");
    expect(sharedMigrationGroup).toHaveTextContent("Shared compatibility copy");
    expect(sharedMigrationGroup).toHaveTextContent("All consumer Targets are ready");
    fireEvent.click(
      within(sharedMigrationGroup).getByRole("button", {
        name: "More cleanup actions for compat-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Keep shared" }));
    expect(onSetSharedSkillRetention).toHaveBeenCalledWith({
      skillKey: "compat-reviewer",
      paths: ["/tmp/home/.agents/skills/compat-reviewer"],
      retained: true
    });
    const removeSharedButton = within(sharedMigrationGroup).getByRole("button", {
      name: "Review replacement compat-reviewer"
    });
    await waitFor(() => expect(removeSharedButton).toBeEnabled());
    fireEvent.click(removeSharedButton);
    const retireDialog = screen.getByRole("dialog", { name: "Replace shared Skill copy" });
    expect(retireDialog).toHaveTextContent("The Library copy is kept");
    expect(retireDialog).toHaveTextContent("OpenCodeInstall as compat-reviewer");
    expect(retireDialog).toHaveTextContent("CodexDo not install");
    expect(retireDialog).toHaveTextContent("/tmp/home/.agents/skills/compat-reviewer");
    fireEvent.click(within(retireDialog).getByRole("button", { name: "Replace shared copy" }));
    await waitFor(() => expect(onRetireSharedSkill).toHaveBeenCalledWith({
      skillKey: "compat-reviewer",
      libraryId: "compat-reviewer",
      paths: ["/tmp/home/.agents/skills/compat-reviewer"]
    }));
    const changedManagedGroup = screen.getByRole("group", {
      name: "Cleanup group copied-local"
    });
    fireEvent.click(
      within(changedManagedGroup).getByRole("button", { name: "Review drift copied-local" })
    );
    const differencesDialog = screen.getByRole("dialog", { name: "Review skill cleanup" });
    expect(differencesDialog).toHaveTextContent("Keep Library version");
    expect(differencesDialog).toHaveTextContent("Use a local version");
    fireEvent.click(within(differencesDialog).getByRole("radio", { name: /Use a local version/ }));
    fireEvent.click(within(differencesDialog).getByRole("button", { name: "Apply cleanup" }));
    expect(onConsolidateSkillGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        skillKey: "copied-local",
        libraryAction: "replace"
      })
    );
    let resolveAutoCleanup: (() => void) | undefined;
    onAutoConsolidateSkillGroups.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveAutoCleanup = resolve;
      })
    );
    const takeOverAllButton = within(discoveries).getByRole("button", {
      name: "Manage 3 ready skills"
    });
    fireEvent.click(takeOverAllButton);
    const bulkCleanupDialog = screen.getByRole("dialog", { name: "Manage ready copies" });
    expect(bulkCleanupDialog).toHaveTextContent("Copied Local");
    expect(bulkCleanupDialog).toHaveTextContent("Legacy Reviewer");
    fireEvent.click(
      within(bulkCleanupDialog).getByRole("button", { name: "Manage 3 skills" })
    );
    expect(onAutoConsolidateSkillGroups).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ skillKey: "copied-local" }),
        expect.objectContaining({ skillKey: "legacy-reviewer" }),
        expect.objectContaining({ skillKey: "target-only-reviewer" })
      ])
    );
    expect(takeOverAllButton).toHaveTextContent("Managing...");
    expect(screen.getByRole("button", { name: "Close library tool" })).toBeDisabled();
    resolveAutoCleanup?.();
    const externalGroup = screen.getByRole("group", {
      name: "Cleanup group external-reviewer"
    });
    expect(externalGroup).toHaveTextContent("Managed elsewhere");
    await waitFor(() =>
      expect(
        within(externalGroup).getByRole("button", { name: "Review ownership external-reviewer" })
      ).toBeEnabled()
    );
    fireEvent.click(
      within(externalGroup).getByRole("button", { name: "Review ownership external-reviewer" })
    );
    let externalDialog = screen.getByRole("dialog", { name: "Import external skill" });
    expect(externalDialog).toHaveTextContent("Skills CLI files and lock data stay unchanged");
    expect(externalDialog).toHaveTextContent("/tmp/opencode/skills/external-reviewer");
    expect(externalDialog).not.toHaveTextContent("/tmp/codex/skills/external-reviewer");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Import external skill" })).not.toBeInTheDocument();
    fireEvent.click(
      within(externalGroup).getByRole("button", { name: "Review ownership external-reviewer" })
    );
    externalDialog = screen.getByRole("dialog", { name: "Import external skill" });
    fireEvent.click(within(externalDialog).getByRole("button", { name: "Import copy" }));
    await waitFor(() =>
      expect(onImportExternal).toHaveBeenCalledWith(
        expect.objectContaining({ id: "external-reviewer", status: "external" })
      )
    );
    const cleanupHistory = screen.getByRole("region", { name: "Cleanup history" });
    expect(cleanupHistory).toHaveTextContent("shared-reviewer");
    expect(cleanupHistory).not.toHaveClass("resource-section");
    expect(discoveries.querySelector(".target-discovery-section")).toContainElement(cleanupHistory);
    expect(
      screen.getByRole("region", { name: "Cleanup history" }).querySelector(".cleanup-history-row")
    ).toHaveClass("resource-row");
    fireEvent.click(screen.getByRole("button", { name: "Restore cleanup shared-reviewer" }));
    expect(onRestoreCleanup).toHaveBeenCalledWith("cleanup-1");
    expect(screen.getByRole("group", { name: "Cleanup group target-only-reviewer" })).toHaveTextContent(
      "2 locations"
    );
    const mixedGroup = screen.getByRole("group", { name: "Cleanup group target-only-reviewer" });
    expect(mixedGroup).toHaveTextContent("Not in Library");
    expect(within(mixedGroup).queryByText("Ignored", { exact: true })).not.toBeInTheDocument();
    expect(
      within(mixedGroup).getByRole("button", { name: "Add to Library target-only-reviewer" })
    ).toBeInTheDocument();
    fireEvent.click(
      within(mixedGroup).getByRole("button", {
        name: "More cleanup actions for target-only-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Details" }));
    const detailsDialog = screen.getByRole("dialog", {
      name: "Skill details target-only-reviewer"
    });
    expect(detailsDialog).toHaveTextContent("Found on disk");
    expect(detailsDialog).toHaveTextContent("/tmp/opencode/skills/target-only-reviewer");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Skill details target-only-reviewer" })
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(mixedGroup).getByRole("button", {
        name: "More cleanup actions for target-only-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Restore ignored" }));
    expect(onUnignoreSkillGroup).toHaveBeenCalledWith("target-only-reviewer");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Close library tool" })).toBeEnabled()
    );

    const conflictGroup = screen.getByRole("group", { name: "Cleanup group conflict-reviewer" });
    expect(conflictGroup).toHaveTextContent("Multiple versions");
    fireEvent.click(
      within(conflictGroup).getByRole("button", {
        name: "More cleanup actions for conflict-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Ignore" }));
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
      within(conflictGroup).getByRole("button", { name: "Add to Library conflict-reviewer" })
    );
    let conflictDialog = screen.getByRole("dialog", { name: "Review skill cleanup" });
    expect(conflictDialog).toHaveTextContent("Version to keep in Library");
    expect(conflictDialog).toHaveTextContent("Choose the copy whose contents you want to preserve");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Review skill cleanup" })).not.toBeInTheDocument();
    expect(onCloseTool).toHaveBeenCalledTimes(3);
    fireEvent.click(
      within(conflictGroup).getByRole("button", { name: "Add to Library conflict-reviewer" })
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
    fireEvent.click(
      within(conflictDialog).getByRole("button", { name: "Add to Library" })
    );
    expect(onConsolidateSkillGroup).toHaveBeenCalledWith({
      skillKey: "conflict-reviewer",
      libraryId: "conflict-reviewer",
      canonicalPath: "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer",
      libraryAction: "create",
      mode: "target-copies",
      sharedLocations: undefined,
      locations: [
        {
          targetId: "opencode",
          path: "/tmp/opencode/skills/a-very-long-parent-directory/conflict-reviewer",
          contentHash: "opencode-conflict-hash"
        },
        {
          targetId: "codex",
          path: "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer",
          contentHash: "codex-conflict-hash"
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
