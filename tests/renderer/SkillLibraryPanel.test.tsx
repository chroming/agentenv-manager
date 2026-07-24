// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SkillLibraryPanel,
  type SkillImportQueueOptions
} from "../../src/renderer/components/SkillLibraryPanel";
import { defaultSkillLibraryViewState } from "../../src/renderer/libraryViewState";
import type {
  GitHubSkillImportInput,
  RepositorySkillImportInput
} from "../../src/shared/types";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "agentEnv");
});

describe("SkillLibraryPanel", () => {
  it("keeps the skill list clean and routes secondary workflows through drawers and row actions", async () => {
    const onImportUnmanaged = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const onScanGitHubSkills = vi.fn().mockResolvedValue({
      owner: "acme",
      repo: "agent-skills",
      ref: "main",
      rootPath: "skills",
      sourceScope: {
        formatVersion: 1,
        canonicalLink: "https://github.com/acme/agent-skills/tree/main/skills",
        repository: "https://github.com/acme/agent-skills.git",
        ref: "main",
        directory: "skills"
      },
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
    let continueFirstReview: (() => void) | undefined;
    let continueFirstWrite: (() => void) | undefined;
    let continueSecondReview: (() => void) | undefined;
    let continueSecondWrite: (() => void) | undefined;
    const firstReview = new Promise<void>((resolve) => (continueFirstReview = resolve));
    const firstWrite = new Promise<void>((resolve) => (continueFirstWrite = resolve));
    const secondReview = new Promise<void>((resolve) => (continueSecondReview = resolve));
    const secondWrite = new Promise<void>((resolve) => (continueSecondWrite = resolve));
    const onImportGitHubSkills = vi.fn().mockImplementation(async (
      inputs: GitHubSkillImportInput[],
      options?: SkillImportQueueOptions
    ) => {
      const gates = [
        { review: firstReview, write: firstWrite },
        { review: secondReview, write: secondWrite }
      ];
      for (const [index, input] of inputs.entries()) {
        options?.onProgress?.({ sourceUrl: input.url, status: "reviewing" });
        await gates[index]?.review;
        options?.onProgress?.({ sourceUrl: input.url, status: "importing" });
        await gates[index]?.write;
        options?.onProgress?.({
          sourceUrl: input.url,
          status: index === 0 ? "imported" : "failed",
          error: index === 0 ? undefined : "GitHub request failed"
        });
      }
      return {
        imported: inputs.slice(0, 1).map((input, index) => ({
          id: input.id,
          name: index === 0 ? "GitHub Reviewer" : "Release Check",
          description: index === 0 ? "Review from GitHub" : "Check a release from GitHub",
          path: `/tmp/skills-library/${input.id}`,
          sourceType: "github" as const,
          source: input.url,
          updatePolicy: "tracked" as const,
          contentHash: `imported-hash-${index}`,
          updatedAt: "2026-07-17T00:00:00.000Z"
        })),
        failed: [{
          id: inputs[1]?.id ?? "release-check",
          sourceUrl: inputs[1]?.url ?? "",
          error: "GitHub request failed"
        }]
      };
    });
    const onScanRepositorySkills = vi.fn();
    const onImportRepositorySkills = vi.fn();
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
    const onCopySource = vi.fn();
    const onSaveUpdateSettings = vi.fn().mockResolvedValue(true);
    const onImportExternal = vi.fn().mockResolvedValue(true);
    let resolveAvailability: ((succeeded: boolean) => void) | undefined;
    const onSetAvailability = vi.fn(
      () => new Promise<boolean>((resolve) => (resolveAvailability = resolve))
    );
    const onSetIcon = vi.fn();
    const onManageTargetSkill = vi.fn();
    const onConsolidateSkillGroup = vi.fn().mockResolvedValue(true);
    const onAutoConsolidateSkillGroups = vi.fn().mockResolvedValue(undefined);
    const onIgnoreSkillGroup = vi.fn();
    const onUnignoreSkillGroup = vi.fn();
    const onSetSharedSkillRetention = vi.fn().mockResolvedValue(true);
    const onRetireSharedSkill = vi.fn().mockResolvedValue(true);
    const onOpenProfiles = vi.fn();
    const onRestoreCleanup = vi.fn();
    const onPreviewSkillMerge = vi.fn();
    const onMergeLibrarySkills = vi.fn().mockResolvedValue(true);
    const onCloseTool = vi.fn();
    const onRefreshInventory = vi.fn().mockResolvedValue(undefined);
    const onViewStateChange = vi.fn();
    const onListSkillFiles = vi.fn().mockResolvedValue([
      { kind: "file" as const, name: "SKILL.md", path: "SKILL.md", sizeBytes: 16 }
    ]);
    const onReadSkillFile = vi.fn().mockResolvedValue({
      path: "SKILL.md",
      kind: "text" as const,
      sizeBytes: 16,
      content: "# Shared Reviewer\n"
    });
    const onSelectLocalSkillSource = vi.fn().mockResolvedValue({
      kind: "folder" as const,
      path: "/tmp/opencode/skills/target-only-reviewer",
      rootPath: "/tmp/opencode/skills/target-only-reviewer"
    });

    const renderPanel = (
      activeTool?: "import" | "discoveries",
      bulkUpdatePlans?: Array<{
        id: string;
        previewId: string;
        name: string;
        sourceType: "local";
        updateAvailable: boolean;
        changes: Array<{ path: string; before: string; after: string; diff: string }>;
        errors: string[];
        impact: {
          profileNames: string[];
          linkedInstallCount: number;
          linkedTargetIds: string[];
          copiedInstallCount: number;
          copiedTargetIds: string[];
        };
      }>,
      showSelectedUpdatePlan = false,
      bulkUpdateFailures: Array<{ id: string; error: string }> = []
    ) => (
      <SkillLibraryPanel
        sourceGroups={[]}
        libraryMode="skills"
        onLibraryModeChange={vi.fn()}
        onCheckSourceGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitoredSourceGroups={vi.fn().mockResolvedValue(undefined)}
        onPreviewSourceMerge={vi.fn()}
        onMergeSources={vi.fn()}
        onSetSourceName={vi.fn()}
        targetNames={{ opencode: "OpenCode", codex: "Codex" }}
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
            updatedAt: "2026-07-02T00:00:00.000Z",
            upstream: {
              kind: "github",
              locator: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
              ref: "main",
              subpath: "skills/reviewer",
              updatedAt: "2026-07-18T08:30:00.000Z"
            }
          },
          {
            id: "represented-external",
            name: "Represented External",
            description: "External content already represented in Library",
            path: "/tmp/skills-library/represented-external",
            sourceType: "local",
            source: "/tmp/source/represented-external",
            updatePolicy: "untracked",
            contentHash: "represented-external-hash",
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
          },
          {
            id: "internal-review",
            name: "Internal Review",
            description: "Review internal code",
            path: "/tmp/skills-library/internal-review",
            sourceType: "git",
            source: "git@code.example:platform/agent-skills.git",
            updatePolicy: "tracked",
            remoteRef: "release/v2",
            remoteRevision: "tree-123",
            contentHash: "tree-123",
            updatedAt: "2026-07-17T00:00:00.000Z",
            upstream: {
              kind: "git",
              locator: "git@code.example:platform/agent-skills.git",
              ref: "release/v2",
              subpath: "skills/engineering/review"
            }
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
            contentHash: "opencode-conflict-hash",
            modifiedAt: "2026-07-18T08:00:00.000Z"
          },
          {
            id: "conflict-reviewer",
            name: "Conflict Reviewer With A Deliberately Long Display Name",
            description: "Preserve the Codex variant with its alternate review workflow and detailed instructions.",
            path: "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer",
            foundIn: ["codex"],
            status: "unmanaged",
            skillKey: "conflict-reviewer",
            contentHash: "codex-conflict-hash",
            modifiedAt: "2026-07-20T09:30:00.000Z"
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
            id: "represented-external",
            name: "Represented External",
            description: "External content already represented in Library",
            path: "/tmp/opencode/skills/represented-external",
            foundIn: ["opencode"],
            status: "external",
            libraryId: "represented-external",
            contentMatchesLibrary: true,
            skillKey: "represented-external",
            contentHash: "represented-external-hash",
            externalOwnership: {
              manager: "skills-cli",
              lockPath: "/tmp/home/.agents/.skill-lock.json",
              lockVersion: 3,
              canonicalPath: "/tmp/home/.agents/skills/represented-external",
              confidence: "confirmed",
              state: "healthy",
              upstream: {
                kind: "github",
                locator: "https://github.com/acme/skills",
                ref: "main",
                subpath: "skills/represented-external"
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
          previewId: "preview-shared-reviewer",
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
          errors: [],
          impact: {
            profileNames: ["Daily Coding"],
            linkedInstallCount: 1,
            linkedTargetIds: ["opencode"],
            copiedInstallCount: 0,
            copiedTargetIds: []
          }
        } : undefined}
        bulkUpdatePlans={bulkUpdatePlans}
        bulkUpdateFailures={bulkUpdateFailures}
        skillUsage={{ "shared-reviewer": ["Daily Coding"] }}
        installedTargetIds={["opencode", "codex"]}
        preparedTargetsBySkill={{
          "compat-reviewer": [
            {
              targetId: "opencode",
              targetName: "compat-reviewer",
              disposition: "install",
              libraryId: "compat-reviewer",
              sharedPaths: ["/tmp/home/.agents/skills/compat-reviewer"]
            },
            {
              targetId: "codex",
              targetName: "compat-reviewer",
              disposition: "omit",
              libraryId: "compat-reviewer",
              sharedPaths: ["/tmp/home/.agents/skills/compat-reviewer"]
            }
          ]
        }}
        activeTool={activeTool}
        isRefreshingInventory={false}
        onCloseTool={onCloseTool}
        onRefreshInventory={onRefreshInventory}
        onSelectLocalSkillSource={onSelectLocalSkillSource}
        onReleaseSkillArchive={vi.fn().mockResolvedValue(undefined)}
        onListSkillFiles={onListSkillFiles}
        onReadSkillFile={onReadSkillFile}
        onImportUnmanaged={onImportUnmanaged}
        onImportExternal={onImportExternal}
        onScanGitHubSkills={onScanGitHubSkills}
        onImportGitHubSkills={onImportGitHubSkills}
        onScanRepositorySkills={onScanRepositorySkills}
        onImportRepositorySkills={onImportRepositorySkills}
        onCancelRepositoryOperations={vi.fn().mockResolvedValue(undefined)}
        onPreviewLibrarySkillUpdate={onPreviewLibrarySkillUpdate}
        onCloseUpdatePreview={onCloseUpdatePreview}
        onUpdateLibrarySkill={onUpdateLibrarySkill}
        onUpdateAllLibrarySkills={onUpdateAllLibrarySkills}
        onPreviewAllLibrarySkillUpdates={onPreviewAllLibrarySkillUpdates}
        onCloseBulkUpdatePreview={onCloseBulkUpdatePreview}
        onSyncSkillInstalls={onSyncSkillInstalls}
        onRemoveLibrarySkill={onRemoveLibrarySkill}
        onPreviewSkillMerge={onPreviewSkillMerge}
        onMergeLibrarySkills={onMergeLibrarySkills}
        onReviewSkillUsage={onReviewSkillUsage}
        onCheckUpdates={onCheckUpdates}
        onOpenSource={onOpenSource}
        onCopySource={onCopySource}
        onSaveUpdateSettings={onSaveUpdateSettings}
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
    ).toHaveAttribute("data-icon", "source");
    expect(screen.getByRole("button", { name: "Change icon for GitHub Reviewer" }).querySelector("img"))
      .toHaveAttribute("src", "https://github.com/favicon.ico");
    fireEvent.click(screen.getByRole("button", { name: "Change icon for GitHub Reviewer" }));
    const sourceIconMenu = screen.getByRole("menu", { name: "Icons for GitHub Reviewer" });
    expect(within(sourceIconMenu).getAllByRole("menuitemradio").length).toBeGreaterThan(30);
    fireEvent.click(within(sourceIconMenu).getByRole("menuitemradio", { name: "Use source icon" }));
    expect(onSetIcon).toHaveBeenCalledWith({ id: "github-reviewer", iconKey: undefined });
    expect(screen.getByLabelText("Source details for github-reviewer"))
      .toHaveTextContent(/Updated Jul 18, 2026/);

    fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), {
      target: { value: "github" }
    });
    expect(onViewStateChange).toHaveBeenCalledWith({
      ...defaultSkillLibraryViewState,
      search: "github",
      scrollTop: 0
    });
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("group", { name: "Skill filters" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Skill usage filter" }), {
      target: { value: "referenced" }
    });
    expect(onViewStateChange).toHaveBeenCalledWith({
      ...defaultSkillLibraryViewState,
      usageFilter: "referenced",
      scrollTop: 0
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Skill filters" })).not.toBeInTheDocument();

    expect(screen.getByRole("region", { name: "Skill library" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Import skills" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Environment skills" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Library storage settings" })).not.toBeInTheDocument();
    const sharedRow = screen.getByRole("group", { name: "Library item shared-reviewer" });
    expect(sharedRow).toHaveTextContent("1 profile");
    expect(sharedRow).toHaveTextContent("2 Agents");
    fireEvent.click(within(sharedRow).getByText("Shared Reviewer"));
    const filesDialog = await screen.findByRole("dialog", { name: "Files in Shared Reviewer" });
    expect(onListSkillFiles).toHaveBeenCalledWith("shared-reviewer");
    await waitFor(() =>
      expect(onReadSkillFile).toHaveBeenCalledWith("shared-reviewer", "SKILL.md")
    );
    await waitFor(() =>
      expect(filesDialog.querySelector(".skill-file-preview__content"))
        .toHaveTextContent("Shared Reviewer")
    );
    fireEvent.click(within(filesDialog).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("Review code"));
    expect(screen.queryByRole("dialog", { name: "Files in Shared Reviewer" }))
      .not.toBeInTheDocument();
    expect(onListSkillFiles).toHaveBeenCalledTimes(1);
    const sharedUsage = within(sharedRow).getByLabelText("Usage details for shared-reviewer");
    fireEvent.mouseEnter(sharedUsage);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Daily Coding");
    expect(screen.getByRole("tooltip")).toHaveTextContent("OpenCode, Codex");
    fireEvent.mouseLeave(sharedUsage);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    const sharedDescription = screen.getByText("Review code");
    expect(sharedDescription).not.toHaveAttribute("title");
    fireEvent.focus(sharedDescription);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.contextMenu(sharedRow, { clientX: 320, clientY: 240 });
    const rowMenu = screen.getByRole("menu", { name: "Actions for shared-reviewer" });
    fireEvent.click(within(rowMenu).getByRole("menuitem", { name: "Update settings" }));
    const settingsDialog = await screen.findByRole("dialog", {
      name: "Update settings for shared-reviewer"
    });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: "Close" }));
    const githubRow = screen.getByRole("group", { name: "Library item github-reviewer" });
    expect(
      within(githubRow).getByRole("button", { name: "Review update github-reviewer" })
    ).toHaveTextContent("Review");
    const githubSource = within(githubRow).getByLabelText("Full source for github-reviewer");
    expect(githubSource).not.toHaveAttribute("title");
    fireEvent.mouseEnter(githubSource);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "https://github.com/acme/agent-skills/tree/main/skills/reviewer"
    );
    fireEvent.mouseLeave(githubSource);
    fireEvent.click(
      within(githubRow).getByRole("button", { name: "Open repository source for github-reviewer" })
    );
    expect(onOpenSource).toHaveBeenCalledWith(
      "https://github.com/acme/agent-skills/tree/main/skills/reviewer"
    );
    const repositoryRow = screen.getByRole("group", { name: "Library item internal-review" });
    expect(within(repositoryRow).getByLabelText("Full source for internal-review")).toHaveTextContent(
      "code.example/platform/agent-skills/skills/engineering/review"
    );
    fireEvent.click(
      within(repositoryRow).getByRole("button", { name: "Copy repository source for internal-review" })
    );
    expect(onCopySource).toHaveBeenCalledWith("git@code.example:platform/agent-skills.git");
    fireEvent.click(within(repositoryRow).getByRole("button", { name: "More actions for internal-review" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update settings" }));
    expect(screen.getByLabelText("Update source type for internal-review")).toHaveValue("git");
    expect(screen.getByLabelText("Update source ref for internal-review")).toHaveValue("release/v2");
    expect(screen.getByLabelText("Update source directory for internal-review")).toHaveValue(
      "skills/engineering/review"
    );
    fireEvent.change(screen.getByLabelText("Update source ref for internal-review"), {
      target: { value: "main" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(onSaveUpdateSettings).toHaveBeenCalledWith({
      policy: {
        id: "internal-review",
        policy: "tracked"
      },
      source: {
        id: "internal-review",
        sourceType: "git",
        source: "git@code.example:platform/agent-skills.git",
        ref: "main",
        directory: "skills/engineering/review"
      }
    }));
    expect(onSaveUpdateSettings).toHaveBeenLastCalledWith({
      policy: {
        id: "internal-review",
        policy: "tracked"
      },
      source: {
        id: "internal-review",
        sourceType: "git",
        source: "git@code.example:platform/agent-skills.git",
        ref: "main",
        directory: "skills/engineering/review"
      }
    });
    const localSource = within(
      screen.getByRole("group", { name: "Library item shared-reviewer" })
    ).getByLabelText("Full source for shared-reviewer");
    fireEvent.mouseEnter(localSource);
    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toHaveTextContent("/tmp/source/shared-reviewer")
    );
    fireEvent.mouseLeave(localSource);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    const copiedLocalRow = screen.getByRole("group", { name: "Library item copied-local" });
    expect(copiedLocalRow).toHaveTextContent("Local import");
    expect(copiedLocalRow).toHaveTextContent("Needs sync");
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
    fireEvent.click(screen.getByRole("button", { name: "Review all updates" }));
    expect(onPreviewAllLibrarySkillUpdates).toHaveBeenCalledWith([
      "github-reviewer",
      "shared-reviewer"
    ]);

    expect(sharedRow).toHaveTextContent("2 Agents");
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText("Update source for shared-reviewer")).not.toBeInTheDocument();
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Update source for shared-reviewer")).not.toBeInTheDocument();
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update settings" }));
    fireEvent.change(screen.getByLabelText("Update source for shared-reviewer"), {
      target: { value: "/tmp/source/shared-reviewer-v2" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(onSaveUpdateSettings).toHaveBeenLastCalledWith({
      policy: {
        id: "shared-reviewer",
        policy: "tracked"
      },
      source: {
        id: "shared-reviewer",
        sourceType: "local",
        source: "/tmp/source/shared-reviewer-v2"
      }
    }));
    expect(onSaveUpdateSettings).toHaveBeenLastCalledWith({
      policy: {
        id: "shared-reviewer",
        policy: "tracked"
      },
      source: {
        id: "shared-reviewer",
        sourceType: "local",
        source: "/tmp/source/shared-reviewer-v2"
      }
    });

    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update settings" }));
    const updateCheckSwitch = screen.getByRole("switch", {
      name: "Track updates for shared-reviewer"
    });
    expect(updateCheckSwitch).toHaveAttribute("aria-checked", "true");
    fireEvent.click(updateCheckSwitch);
    expect(onSaveUpdateSettings).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(onSaveUpdateSettings).toHaveBeenLastCalledWith({
      policy: {
        id: "shared-reviewer",
        policy: "untracked"
      }
    }));
    expect(onSaveUpdateSettings).toHaveBeenLastCalledWith({
      policy: {
        id: "shared-reviewer",
        policy: "untracked"
      }
    });

    fireEvent.click(screen.getByRole("button", { name: "Review update shared-reviewer" }));
    expect(onPreviewLibrarySkillUpdate).toHaveBeenCalledWith("shared-reviewer");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Review update shared-reviewer" })).toBeEnabled()
    );
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Review update/ }));
    expect(onPreviewLibrarySkillUpdate).toHaveBeenCalledTimes(2);
    fireEvent.click(within(sharedRow).getByRole("button", { name: "More actions for shared-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Disable globally/ }));
    const disableDialog = screen.getByRole("dialog", { name: "Disable library skill" });
    expect(disableDialog).toHaveTextContent("1 Profile");
    expect(disableDialog).toHaveTextContent("Remove managed installs on next Apply");
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
    expect(installedDeleteDialog).toHaveTextContent("1 managed Agent install");
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
    const importDialog = screen.getByRole("dialog", { name: "Import skills" });
    expect(importDialog).toHaveClass("ui-modal", "library-import-dialog");
    expect(within(importDialog).getByRole("button", { name: "Close import" }))
      .toHaveClass("ui-icon-button");
    expect(within(importDialog).getByRole("button", { name: "Close" }))
      .toHaveClass("ui-button");
    fireEvent.click(screen.getByRole("button", { name: "Choose local Skill source" }));
    expect(onSelectLocalSkillSource).toHaveBeenCalled();
    await waitFor(() => expect(onRefreshInventory).toHaveBeenCalledWith(false));
    await waitFor(() =>
      expect(screen.getByLabelText("Local Skill source path")).toHaveValue(
        "/tmp/opencode/skills/target-only-reviewer"
      )
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "back up this Agent copy"
    );
    const localImportButton = screen.getByRole("button", { name: "Import & manage" });
    fireEvent.click(localImportButton);
    await waitFor(() =>
      expect(screen.getByLabelText("Local Skill source path")).toHaveValue(
        "/tmp/opencode/skills/target-only-reviewer"
      )
    );
    fireEvent.click(localImportButton);
    await waitFor(() => expect(screen.getByLabelText("Local Skill source path")).toHaveValue(""));
    expect(onImportUnmanaged).toHaveBeenCalledWith(
      "/tmp/opencode/skills/target-only-reviewer"
    );
    expect(onCloseTool).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Repository" }));
    expect(screen.getByRole("dialog", { name: "Import skills" })).toBeInTheDocument();
    expect(screen.getByText("Advanced", { exact: true }).closest("details"))
      .toHaveClass("repository-advanced");
    fireEvent.change(screen.getByLabelText("Repository address"), {
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Release Check" }));
    expect(selectAllGitHub).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Import 2" }));
    await waitFor(() =>
      expect(onImportGitHubSkills).toHaveBeenCalledWith(
        [
          {
            url: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
            id: "github-reviewer",
            ref: "main",
            remotePath: "skills/reviewer",
            sourceCollection: {
              formatVersion: 1,
              canonicalLink: "https://github.com/acme/agent-skills/tree/main/skills",
              repository: "https://github.com/acme/agent-skills.git",
              ref: "main",
              directory: "skills",
              sourceSubpath: "reviewer"
            }
          },
          {
            url: "https://github.com/acme/agent-skills/tree/main/skills/release-check",
            id: "release-check",
            ref: "main",
            remotePath: "skills/release-check",
            sourceCollection: {
              formatVersion: 1,
              canonicalLink: "https://github.com/acme/agent-skills/tree/main/skills",
              repository: "https://github.com/acme/agent-skills.git",
              ref: "main",
              directory: "skills",
              sourceSubpath: "release-check"
            }
          }
        ],
        expect.objectContaining({
          onProgress: expect.any(Function),
          shouldStop: expect.any(Function)
        })
      )
    );
    expect(screen.getByRole("button", { name: "Stop import" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "GitHub Reviewer: reviewing" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Release Check: waiting" })).toBeInTheDocument();
    continueFirstReview?.();
    await screen.findByRole("status", { name: "GitHub Reviewer: importing" });
    expect(screen.getByRole("status", { name: "Release Check: waiting" })).toBeInTheDocument();
    continueFirstWrite?.();
    await screen.findByRole("status", { name: "GitHub Reviewer: imported" });
    await screen.findByRole("status", { name: "Release Check: reviewing" });
    continueSecondReview?.();
    await screen.findByRole("status", { name: "Release Check: importing" });
    continueSecondWrite?.();
    expect(screen.getByRole("status", { name: "GitHub Reviewer: imported" })).toBeInTheDocument();
    await screen.findByRole("status", { name: "Release Check: failed" });
    const importFailure = screen.getByLabelText("Import failure for Release Check");
    expect(importFailure).toHaveClass("github-import-state__failure");
    expect(importFailure.querySelector("svg")).not.toBeNull();
    fireEvent.mouseEnter(importFailure);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("GitHub request failed");
    expect(screen.getByText("1 imported · 1 failed")).toBeInTheDocument();
    const firstQueueOptions = onImportGitHubSkills.mock.calls[0]?.[1] as SkillImportQueueOptions;
    act(() => firstQueueOptions.onProgress?.({
      sourceUrl: "https://github.com/acme/agent-skills/tree/main/skills/release-check",
      status: "skipped"
    }));
    expect(screen.getByRole("button", { name: "Import Release Check" })).toBeInTheDocument();
    onImportGitHubSkills.mockImplementationOnce(async (inputs, options) => {
      const input = inputs[0]!;
      options?.onProgress?.({ sourceUrl: input.url, status: "reviewing" });
      options?.onProgress?.({ sourceUrl: input.url, status: "importing" });
      options?.onProgress?.({ sourceUrl: input.url, status: "imported" });
      return {
        imported: [{
          id: input.id!,
          name: "Release Check",
          description: "Check a release from GitHub",
          path: `/tmp/skills-library/${input.id}`,
          sourceType: "github" as const,
          source: input.url,
          updatePolicy: "tracked" as const,
          contentHash: "release-check-hash",
          updatedAt: "2026-07-17T00:00:00.000Z"
        }],
        failed: []
      };
    });
    fireEvent.click(screen.getByRole("button", { name: "Import Release Check" }));
    await screen.findByRole("status", { name: "Release Check: imported" });
    expect(onImportGitHubSkills).toHaveBeenCalledTimes(2);
    expect(screen.getByText("All 2 skills imported")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import Release Check" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Import skills" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCloseTool).toHaveBeenCalledTimes(2);

    rerender(renderPanel("discoveries"));
    const discoveries = screen.getByRole("region", { name: "Environment skills" });
    fireEvent.click(within(discoveries).getByRole("button", { name: "Refresh local skills" }));
    expect(onRefreshInventory).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(document.body);
    expect(onCloseTool).toHaveBeenCalledTimes(3);
    expect(discoveries).toHaveTextContent("Managed");
    expect(discoveries).toHaveTextContent("Needs your decision");
    expect(discoveries).toHaveTextContent("Ready to clean up");
    expect(discoveries).toHaveTextContent("Kept outside AgentEnv");
    expect(discoveries).toHaveTextContent("External");
    expect(discoveries).toHaveTextContent("Shared: OpenCode + Codex");
    const sharedMigrationGroup = screen.getByRole("group", {
      name: "Cleanup group compat-reviewer"
    });
    expect(sharedMigrationGroup).toHaveTextContent("Ready");
    expect(sharedMigrationGroup).toHaveTextContent("All consumer Agents are ready");
    fireEvent.click(
      within(sharedMigrationGroup).getByRole("button", {
        name: "More cleanup actions for compat-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Keep shared copy" }));
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
    onRetireSharedSkill.mockClear();
    const changedManagedGroup = screen.getByRole("group", {
      name: "Cleanup group copied-local"
    });
    expect(changedManagedGroup).toHaveTextContent("Library / copied-local · 1 managed installs");
    expect(changedManagedGroup).toHaveTextContent("Ready");
    expect(
      within(changedManagedGroup).queryByRole("button", { name: "Review drift copied-local" })
    ).not.toBeInTheDocument();
    let resolveAutoCleanup: (() => void) | undefined;
    onAutoConsolidateSkillGroups.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveAutoCleanup = resolve;
      })
    );
    const takeOverAllButton = within(discoveries).getByRole("button", {
      name: "Clean up 4 ready Skills"
    });
    expect(takeOverAllButton.closest(".cleanup-bucket-heading--ready")).not.toBeNull();
    expect(takeOverAllButton.closest(".cleanup-bucket-actions")).not.toBeNull();
    expect(takeOverAllButton).toHaveClass(
      "ui-button",
      "ui-button--compact",
      "ui-button--primary"
    );
    expect(takeOverAllButton).toHaveTextContent("Clean up 4");
    fireEvent.click(takeOverAllButton);
    const bulkCleanupDialog = screen.getByRole("dialog", { name: "Clean up local Skills" });
    expect(bulkCleanupDialog).toHaveTextContent("Repair managed links");
    expect(bulkCleanupDialog).toHaveTextContent("Add to Library and link copies");
    expect(bulkCleanupDialog).toHaveTextContent("Copied Local");
    expect(bulkCleanupDialog).toHaveTextContent("Legacy Reviewer");
    expect(bulkCleanupDialog).toHaveTextContent("Replace shared copies");
    expect(bulkCleanupDialog).toHaveTextContent("compat-reviewer");
    fireEvent.click(
      within(bulkCleanupDialog).getByRole("button", { name: "Clean up 4 skills" })
    );
    await waitFor(() =>
      expect(onAutoConsolidateSkillGroups).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ skillKey: "copied-local" }),
          expect.objectContaining({ skillKey: "legacy-reviewer" }),
          expect.objectContaining({ skillKey: "target-only-reviewer" })
        ])
      )
    );
    expect(takeOverAllButton).toHaveTextContent("Cleaning up...");
    expect(screen.getByRole("button", { name: "Close library tool" })).toBeDisabled();
    resolveAutoCleanup?.();
    const externalGroup = screen.getByRole("group", {
      name: "Cleanup group external-reviewer"
    });
    expect(externalGroup).toHaveTextContent("External");
    await waitFor(() =>
      expect(
        within(externalGroup).getByRole("button", { name: "Review ownership external-reviewer" })
      ).toBeEnabled()
    );
    expect(onRetireSharedSkill).toHaveBeenCalledWith({
      skillKey: "compat-reviewer",
      libraryId: "compat-reviewer",
      paths: ["/tmp/home/.agents/skills/compat-reviewer"]
    });
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
    expect(
      screen.queryByRole("group", { name: "Cleanup group represented-external" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Kept outside AgentEnv" }));
    const representedExternalGroup = screen.getByRole("group", {
      name: "Cleanup group represented-external"
    });
    expect(representedExternalGroup).toHaveTextContent("External");
    const reviewRepresented = within(representedExternalGroup).getByRole("button", {
      name: "Review ownership represented-external"
    });
    fireEvent.click(reviewRepresented);
    externalDialog = screen.getByRole("dialog", { name: "Import external skill" });
    expect(externalDialog).toHaveTextContent("Review the matching Library copy");
    fireEvent.click(within(externalDialog).getByRole("button", { name: "Review Library copy" }));
    await waitFor(() =>
      expect(onImportExternal).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "represented-external",
          status: "external",
          contentMatchesLibrary: true
        })
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
    expect(mixedGroup).toHaveTextContent("Ready");
    expect(within(mixedGroup).queryByText("Ignored", { exact: true })).not.toBeInTheDocument();
    expect(
      within(mixedGroup).queryByRole("button", { name: "Add to Library target-only-reviewer" })
    ).not.toBeInTheDocument();
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
    expect(within(detailsDialog).getAllByRole("region", { name: /Version / })).toHaveLength(1);
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
    expect(conflictGroup).toHaveTextContent("2 versions");
    expect(conflictGroup).toHaveTextContent("2 different content versions · 2 locations");
    expect(conflictGroup).toHaveTextContent("Modified");
    fireEvent.click(
      within(conflictGroup).getByRole("button", {
        name: "More cleanup actions for conflict-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Details" }));
    const conflictDetails = screen.getByRole("dialog", {
      name: "Skill details conflict-reviewer"
    });
    expect(within(conflictDetails).getAllByRole("region", { name: /Version / })).toHaveLength(2);
    expect(conflictDetails).toHaveTextContent("Modified");
    fireEvent.click(within(conflictDetails).getByRole("button", { name: "Close" }));
    fireEvent.click(
      within(conflictGroup).getByRole("button", {
        name: "More cleanup actions for conflict-reviewer"
      })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Ignore" }));
    expect(onIgnoreSkillGroup).toHaveBeenCalledWith("conflict-reviewer");
    const conflictLocations = within(conflictGroup).getByLabelText(
      "Full cleanup locations conflict-reviewer"
    );
    const closeCountBeforeTooltipClick = onCloseTool.mock.calls.length;
    fireEvent.focus(conflictLocations);
    const conflictLocationsTooltip = screen.getByRole("tooltip");
    expect(conflictLocationsTooltip).toHaveTextContent(
      "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer"
    );
    fireEvent.mouseEnter(conflictLocationsTooltip);
    fireEvent.mouseDown(conflictLocationsTooltip);
    fireEvent.click(conflictLocationsTooltip);
    expect(onCloseTool).toHaveBeenCalledTimes(closeCountBeforeTooltipClick);
    expect(screen.getByRole("region", { name: "Environment skills" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Environment skills" })).toBeInTheDocument();
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
    expect(conflictDialog).toHaveTextContent("Modified");
    const codexVersion = within(conflictDialog).getByRole("radio", { name: /Codex/ });
    fireEvent.click(codexVersion);
    const codexLocation = within(conflictDialog).getByRole("checkbox", { name: /Codex/ });
    expect(codexLocation).toBeChecked();
    expect(codexLocation).toBeDisabled();
    const fullSourcePath = within(conflictDialog).getByLabelText(
      "Full source path /tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer"
    );
    Object.defineProperties(fullSourcePath, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 420 }
    });
    fireEvent.focus(fullSourcePath);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "/tmp/codex/skills/another-very-long-parent-directory/conflict-reviewer"
    );
    fireEvent.click(
      within(conflictDialog).getByRole("button", { name: "Add to Library" })
    );
    expect(within(conflictDialog).getByRole("button", { name: "Applying..." })).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(within(conflictDialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
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
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Review skill cleanup" })).not.toBeInTheDocument()
    );

    rerender(
      renderPanel(undefined, [
        {
          id: "shared-reviewer",
          previewId: "preview-shared-reviewer",
          name: "Shared Reviewer",
          sourceType: "local",
          updateAvailable: true,
          changes: [{ path: "SKILL.md", before: "old", after: "new", diff: "diff" }],
          errors: [],
          impact: {
            profileNames: ["Daily Coding"],
            linkedInstallCount: 1,
            linkedTargetIds: ["opencode"],
            copiedInstallCount: 0,
            copiedTargetIds: []
          }
        },
        {
          id: "broken-reviewer",
          previewId: "preview-broken-reviewer",
          name: "Broken Reviewer",
          sourceType: "local",
          updateAvailable: false,
          changes: [],
          errors: ["Source unavailable"],
          impact: {
            profileNames: [],
            linkedInstallCount: 0,
            linkedTargetIds: [],
            copiedInstallCount: 0,
            copiedTargetIds: []
          }
        }
      ], false, [{ id: "missing-reviewer", error: "Source directory is unavailable" }])
    );
    const bulkDialog = screen.getByRole("dialog", { name: "Review all skill updates" });
    expect(bulkDialog).toHaveTextContent("1 update previews could not be prepared");
    expect(bulkDialog).toHaveTextContent("missing-reviewer");
    expect(bulkDialog).toHaveTextContent("Source directory is unavailable");
    fireEvent.click(within(bulkDialog).getByRole("button", { name: "Retry failed previews" }));
    expect(onPreviewAllLibrarySkillUpdates).toHaveBeenCalledWith([
      "shared-reviewer",
      "broken-reviewer",
      "missing-reviewer"
    ]);
    const partialApply = within(bulkDialog).getByRole("button", { name: "Apply 1 updates" });
    expect(partialApply).toBeEnabled();
    fireEvent.click(partialApply);
    expect(onUpdateAllLibrarySkills).toHaveBeenCalledWith([
      expect.objectContaining({ id: "shared-reviewer", previewId: "preview-shared-reviewer" })
    ]);
  }, 15_000);

  it("falls back from a private GitHub URL to SSH-backed System Git and preserves its directory scope", async () => {
    const scanResult = {
      repository: "https://github.com/acme/agent-skills.git",
      ref: "main",
      directory: "skills/engineering",
      transport: "system-git" as const,
      accessTransport: "ssh" as const,
      sourceScope: {
        formatVersion: 1 as const,
        canonicalLink: "https://github.com/acme/agent-skills/tree/main/skills/engineering",
        repository: "https://github.com/acme/agent-skills.git",
        ref: "main",
        directory: "skills/engineering"
      },
      truncated: false,
      candidates: [
        {
          id: "review-internal",
          name: "Internal Review",
          description: "Company review workflow",
          directory: "skills/engineering/review",
          source: {
            kind: "git" as const,
            locator: "https://github.com/acme/agent-skills.git",
            ref: "main",
            subpath: "skills/engineering/review"
          },
          contentRevision: "tree-123",
          resolvedCommit: "commit-123",
          status: "ready" as const
        }
      ]
    };
    let rejectFirstScan: ((reason: Error) => void) | undefined;
    const onScanRepositorySkills = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectFirstScan = reject;
      }))
      .mockResolvedValue(scanResult);
    const onCancelRepositoryOperations = vi.fn().mockImplementation(async () => {
      rejectFirstScan?.(new Error("Git command was cancelled"));
    });
    const onScanGitHubSkills = vi.fn().mockRejectedValue(
      new Error("GitHub request failed (404 Not Found): private repository")
    );
    let completeRepositoryImport: (() => void) | undefined;
    const onImportRepositorySkills = vi.fn().mockImplementation((
      inputs: RepositorySkillImportInput[],
      options?: SkillImportQueueOptions
    ) => {
      const sourceUrl = `${inputs[0].repository}\0${inputs[0].ref}\0${inputs[0].directory}`;
      options?.onProgress?.({ sourceUrl, status: "importing" });
      return new Promise((resolve) => {
        completeRepositoryImport = () => {
          options?.onProgress?.({ sourceUrl, status: "imported" });
          resolve({
            imported: [{
              id: "review-internal",
              name: "Internal Review",
              description: "Company review workflow",
              path: "/tmp/library/review-internal",
              sourceType: "git" as const,
              source: inputs[0].repository,
              updatePolicy: "tracked" as const,
              remoteRef: inputs[0].ref,
              contentHash: "tree-123",
              updatedAt: "2026-07-17T00:00:00.000Z"
            }],
            failed: []
          });
        };
      });
    });
    const noop = vi.fn();

    render(
      <SkillLibraryPanel
        sourceGroups={[]}
        libraryMode="skills"
        onLibraryModeChange={vi.fn()}
        onCheckSourceGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitoredSourceGroups={vi.fn().mockResolvedValue(undefined)}
        onPreviewSourceMerge={vi.fn()}
        onMergeSources={vi.fn()}
        onSetSourceName={vi.fn()}
        librarySkills={[]}
        skillUpdates={[]}
        skillInventory={[]}
        cleanupBackups={[]}
        skillUsage={{}}
        activeTool="import"
        onCloseTool={noop}
        onRefreshInventory={vi.fn().mockResolvedValue(undefined)}
        onSelectLocalSkillSource={vi.fn().mockResolvedValue(undefined)}
        onReleaseSkillArchive={vi.fn().mockResolvedValue(undefined)}
        onListSkillFiles={vi.fn().mockResolvedValue([])}
        onReadSkillFile={vi.fn().mockResolvedValue({
          path: "SKILL.md",
          kind: "text",
          sizeBytes: 0,
          content: ""
        })}
        onImportUnmanaged={vi.fn().mockResolvedValue(false)}
        onImportExternal={vi.fn().mockResolvedValue(false)}
        onScanGitHubSkills={onScanGitHubSkills}
        onImportGitHubSkills={vi.fn()}
        onScanRepositorySkills={onScanRepositorySkills}
        onImportRepositorySkills={onImportRepositorySkills}
        onCancelRepositoryOperations={onCancelRepositoryOperations}
        onManageTargetSkill={noop}
        onConsolidateSkillGroup={vi.fn().mockResolvedValue(false)}
        onAutoConsolidateSkillGroups={vi.fn().mockResolvedValue(undefined)}
        onSaveUpdateSettings={vi.fn().mockResolvedValue(true)}
        onSetAvailability={vi.fn().mockResolvedValue(true)}
        onSetIcon={noop}
        onPreviewLibrarySkillUpdate={noop}
        onCloseUpdatePreview={noop}
        onUpdateLibrarySkill={noop}
        onUpdateAllLibrarySkills={noop}
        onPreviewAllLibrarySkillUpdates={noop}
        onCloseBulkUpdatePreview={noop}
        onSyncSkillInstalls={noop}
        onRemoveLibrarySkill={noop}
        onPreviewSkillMerge={vi.fn()}
        onMergeLibrarySkills={vi.fn().mockResolvedValue(false)}
        onReviewSkillUsage={noop}
        onCheckUpdates={noop}
        onOpenSource={noop}
        onCopySource={noop}
        onIgnoreSkillGroup={noop}
        onUnignoreSkillGroup={noop}
        onSetSharedSkillRetention={vi.fn().mockResolvedValue(false)}
        onRetireSharedSkill={vi.fn().mockResolvedValue(false)}
        onOpenProfiles={noop}
        onRestoreCleanup={noop}
        viewState={defaultSkillLibraryViewState}
        onViewStateChange={noop}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Repository" }));
    fireEvent.change(screen.getByLabelText("Repository address"), {
      target: { value: "https://github.com/acme/agent-skills/tree/main/skills/engineering" }
    });
    const scanButton = screen.getByRole("button", { name: "Scan" });
    fireEvent.click(scanButton);
    const closeButton = screen.getByRole("button", { name: "Close" });
    await waitFor(() => expect(closeButton).toBeEnabled());
    fireEvent.click(closeButton);
    await waitFor(() => expect(onCancelRepositoryOperations).toHaveBeenCalledTimes(1));
    await screen.findByText("Git command was cancelled");
    await waitFor(() => expect(scanButton).toBeEnabled());
    fireEvent.click(scanButton);

    await screen.findByRole("checkbox", { name: "Select Internal Review" });
    expect(onScanGitHubSkills).toHaveBeenCalledWith(
      "https://github.com/acme/agent-skills/tree/main/skills/engineering"
    );
    expect(onScanRepositorySkills).toHaveBeenLastCalledWith({
      repository: "https://github.com/acme/agent-skills/tree/main/skills/engineering",
      ref: undefined,
      directory: undefined,
      transport: "system-git"
    });
    expect(screen.getByLabelText("Repository scan source")).toHaveTextContent("SSH fallback");
    fireEvent.click(screen.getByRole("button", { name: "Import 1" }));
    const importingButton = screen.getByRole("button", { name: "Importing..." });
    expect(importingButton).toHaveAttribute("aria-busy", "true");
    expect(importingButton.querySelector("svg")).toHaveClass("is-spinning");
    expect(
      screen.getByRole("status", { name: "Internal Review: importing" }).querySelector("svg")
    ).toHaveClass("is-spinning");
    await waitFor(() => expect(onImportRepositorySkills).toHaveBeenCalledWith([
      {
        repository: "https://github.com/acme/agent-skills.git",
        ref: "main",
        directory: "skills/engineering/review",
        transport: "system-git",
        id: "review-internal",
        sourceCollection: {
          formatVersion: 1,
          canonicalLink: "https://github.com/acme/agent-skills/tree/main/skills/engineering",
          repository: "https://github.com/acme/agent-skills.git",
          ref: "main",
          directory: "skills/engineering",
          sourceSubpath: "review"
        }
      }
    ], expect.objectContaining({
      onProgress: expect.any(Function),
      shouldStop: expect.any(Function)
    })));
    await act(async () => completeRepositoryImport?.());
    expect(await screen.findByText("All 1 skills imported")).toBeInTheDocument();
  });

  it("reviews same-name Library differences and keeps content and source choices independent", async () => {
    const preview = {
      name: "reviewer",
      entries: [
        {
          id: "reviewer-alpha",
          name: "reviewer",
          description: "Alpha",
          version: "1.0.0",
          contentHash: "alpha-hash",
          sourceType: "local" as const,
          source: "/tmp/alpha",
          modifiedAt: "2026-07-18T08:00:00.000Z",
          skillMarkdown: "# Alpha\n",
          globallyEnabled: true,
          updatePolicy: "untracked" as const,
          profileNames: ["Daily Coding"],
          installCount: 1
        },
        {
          id: "reviewer-beta",
          name: "reviewer",
          description: "Beta",
          version: "2.0.0",
          contentHash: "beta-hash",
          sourceType: "github" as const,
          source: "https://github.com/acme/reviewer",
          modifiedAt: "2026-07-20T09:30:00.000Z",
          skillMarkdown: "# Beta\n",
          globallyEnabled: true,
          updatePolicy: "tracked" as const,
          profileNames: [],
          installCount: 0
        }
      ],
      comparisons: [
        {
          leftId: "reviewer-alpha",
          rightId: "reviewer-beta",
          identical: false,
          changes: [
            {
              path: "SKILL.md",
              before: "# Alpha\n",
              after: "# Beta\n",
              diff: "--- before\n+++ after\n@@\n-# Alpha\n+# Beta\n"
            }
          ]
        }
      ],
      profileCount: 1,
      installCount: 1
    };
    const onPreviewSkillMerge = vi.fn().mockResolvedValue(preview);
    const onMergeLibrarySkills = vi.fn().mockResolvedValue(true);
    const noop = vi.fn();

    render(
      <SkillLibraryPanel
        sourceGroups={[]}
        libraryMode="skills"
        onLibraryModeChange={vi.fn()}
        onCheckSourceGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitoredSourceGroups={vi.fn().mockResolvedValue(undefined)}
        onPreviewSourceMerge={vi.fn()}
        onMergeSources={vi.fn()}
        onSetSourceName={vi.fn()}
        librarySkills={preview.entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          path: `/tmp/library/${entry.id}`,
          sourceType: entry.sourceType,
          source: entry.source,
          globallyEnabled: entry.globallyEnabled,
          updatePolicy: entry.updatePolicy,
          contentHash: entry.contentHash,
          updatedAt: "2026-07-16T00:00:00.000Z"
        }))}
        skillUpdates={[]}
        skillInventory={[]}
        cleanupBackups={[]}
        skillUsage={{ "reviewer-alpha": ["Daily Coding"] }}
        onRefreshInventory={vi.fn().mockResolvedValue(undefined)}
        onSelectLocalSkillSource={vi.fn().mockResolvedValue(undefined)}
        onReleaseSkillArchive={vi.fn().mockResolvedValue(undefined)}
        onListSkillFiles={vi.fn().mockResolvedValue([])}
        onReadSkillFile={vi.fn().mockResolvedValue({
          path: "SKILL.md",
          kind: "text",
          sizeBytes: 0,
          content: ""
        })}
        onImportUnmanaged={vi.fn().mockResolvedValue(false)}
        onImportExternal={vi.fn().mockResolvedValue(false)}
        onScanGitHubSkills={vi.fn()}
        onImportGitHubSkills={vi.fn()}
        onScanRepositorySkills={vi.fn()}
        onImportRepositorySkills={vi.fn()}
        onCancelRepositoryOperations={vi.fn().mockResolvedValue(undefined)}
        onManageTargetSkill={noop}
        onConsolidateSkillGroup={vi.fn().mockResolvedValue(false)}
        onAutoConsolidateSkillGroups={vi.fn().mockResolvedValue(undefined)}
        onSaveUpdateSettings={vi.fn().mockResolvedValue(true)}
        onSetAvailability={vi.fn().mockResolvedValue(true)}
        onSetIcon={noop}
        onPreviewLibrarySkillUpdate={noop}
        onCloseUpdatePreview={noop}
        onUpdateLibrarySkill={noop}
        onUpdateAllLibrarySkills={noop}
        onPreviewAllLibrarySkillUpdates={noop}
        onCloseBulkUpdatePreview={noop}
        onSyncSkillInstalls={noop}
        onRemoveLibrarySkill={noop}
        onPreviewSkillMerge={onPreviewSkillMerge}
        onMergeLibrarySkills={onMergeLibrarySkills}
        onReviewSkillUsage={noop}
        onCheckUpdates={noop}
        onOpenSource={noop}
        onCopySource={noop}
        onIgnoreSkillGroup={noop}
        onUnignoreSkillGroup={noop}
        onSetSharedSkillRetention={vi.fn().mockResolvedValue(true)}
        onRetireSharedSkill={vi.fn().mockResolvedValue(true)}
        onOpenProfiles={noop}
        onRestoreCleanup={noop}
        viewState={defaultSkillLibraryViewState}
        onViewStateChange={noop}
      />
    );

    const row = screen.getByRole("group", { name: "Library item reviewer-alpha" });
    fireEvent.click(within(row).getByRole("button", { name: "More actions for reviewer-alpha" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Merge duplicates" }));
    expect(await screen.findByRole("dialog", { name: "Merge same-name Skills" }))
      .toHaveTextContent("Modified");

    const dialog = await screen.findByRole("dialog", { name: "Merge same-name Skills" });
    expect(within(dialog).getByText("SKILL.md")).toBeInTheDocument();
    const keepGroup = within(dialog).getByRole("group", { name: "Keep Skill" });
    const sourceGroup = within(dialog).getByRole("group", { name: "Keep update source" });
    fireEvent.click(within(keepGroup).getByRole("radio", { name: /reviewer-beta/ }));
    fireEvent.click(within(sourceGroup).getByRole("radio", { name: /reviewer-alpha/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge Skills" }));

    await waitFor(() => expect(onMergeLibrarySkills).toHaveBeenCalledWith({
      ids: ["reviewer-alpha", "reviewer-beta"],
      keepId: "reviewer-beta",
      sourceId: "reviewer-alpha",
      expectedContentHashes: {
        "reviewer-alpha": "alpha-hash",
        "reviewer-beta": "beta-hash"
      }
    }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Merge same-name Skills" })).not.toBeInTheDocument()
    );
  });
});
