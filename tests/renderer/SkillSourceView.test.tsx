// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillSourceView } from "../../src/renderer/components/SkillSourceView";
import type { SkillSourceGroupView } from "../../src/shared/types";

afterEach(cleanup);

const group: SkillSourceGroupView = {
  formatVersion: 1,
  sourceId: "source-engineering",
  sourceKind: "repository",
  automaticChecks: true,
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
      upstreamUpdatedAt: "2026-07-22T00:00:00.000Z",
      libraryId: "review",
      libraryName: "review",
      libraryVersion: "1.0.0",
      libraryUpdatedAt: "2026-07-20T00:00:00.000Z",
      globallyEnabled: true,
      updatePolicy: "tracked",
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
  it("changes source monitoring without running a source scan", async () => {
    const onSetMonitored = vi.fn().mockResolvedValue(undefined);
    const onCheckGroup = vi.fn().mockResolvedValue(undefined);
    render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={onCheckGroup}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onSetMonitored={onSetMonitored}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Source actions for acme/skills · /engineering"
    }));
    fireEvent.click(screen.getByRole("menuitem", {
      name: "Exclude from routine checks"
    }));
    await waitFor(() => expect(onSetMonitored).toHaveBeenCalledWith("source-engineering", false));
    expect(onCheckGroup).not.toHaveBeenCalled();
  });

  it("shows source-level counts and routes each remote state to one explicit action", async () => {
    const onCheckGroup = vi.fn().mockResolvedValue(undefined);
    const onAdd = vi.fn().mockResolvedValue(true);
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onReviewUpdates = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn();
    render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={onCheckGroup}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onReviewUpdates={onReviewUpdates}
        onDelete={onDelete}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Source summary")).toHaveTextContent("Total4Changes 3");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Merge selected/ })).not.toBeInTheDocument();
    expect(document.querySelector(".skill-source-counts .is-change")).toHaveClass("has-value");
    fireEvent.click(screen.getByRole("button", { name: "Update all skills" }));
    expect(onReviewUpdates).toHaveBeenCalledWith(["review"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Update all skills" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand source" }));

    const candidates = document.querySelector<HTMLElement>(".skill-source-candidates");
    expect(candidates).not.toBeNull();
    expect(
      [...candidates!.querySelectorAll(".skill-source-candidate-field-label")]
        .map((label) => label.textContent)
    ).toEqual(group.candidates.flatMap(() => ["Upstream", "Library"]));
    expect(candidates).toHaveTextContent("2026");
    fireEvent.click(within(candidates!).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(group, group.candidates[0]));
    fireEvent.click(within(candidates!).getByRole("button", { name: "Update review" }));
    expect(
      within(candidates!).queryByRole("button", { name: /^Review$/ })
    ).not.toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith("review");
    await waitFor(() =>
      expect(within(candidates!).getByRole("button", { name: "Update review" })).toBeEnabled()
    );
    fireEvent.click(within(candidates!).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("docs");

    expect(screen.queryByRole("button", { name: "Check" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "Source actions for acme/skills · /engineering"
    }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Check source" }));
    await waitFor(() => expect(onCheckGroup).toHaveBeenCalledWith(group.sourceId));
  });

  it("filters by source and Skill name without discarding the mounted view", () => {
    const { rerender } = render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Search sources and skills"), {
      target: { value: "testing" }
    });
    expect(screen.getByText("acme/skills · /engineering")).toBeInTheDocument();
    rerender(
      <SkillSourceView
        active={false}
        groups={[group]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
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

  it("keeps repository scopes visibly distinct when source names share a prefix", () => {
    const secondGroup: SkillSourceGroupView = {
      ...group,
      sourceId: "source-product",
      canonicalLink: "https://github.com/acme/skills/tree/main/product",
      directory: "product",
      counts: { total: 1, updates: 0, new: 0, removed: 0 },
      candidates: []
    };
    render(
      <SkillSourceView
        active
        groups={[group, secondGroup]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    expect(screen.getByText("main · /engineering")).toBeInTheDocument();
    expect(screen.getByText("main · /product")).toBeInTheDocument();
  });

  it("keeps routine-check scope separate from source type and result filters", () => {
    const manualLocalGroup: SkillSourceGroupView = {
      ...group,
      sourceId: "source-local",
      sourceKind: "local",
      automaticChecks: false,
      canonicalLink: "file:///tmp/project-skills",
      repository: "/tmp/project-skills",
      ref: "",
      directory: "",
      displayName: "Local project skills",
      checkedAt: undefined,
      observationState: "error",
      error: "Folder is unavailable",
      counts: { total: 1, updates: 0, new: 0, removed: 0 },
      candidates: []
    };
    const props = {
      active: true,
      groups: [group, manualLocalGroup],
      loading: false,
      onCheckGroup: vi.fn().mockResolvedValue(undefined),
      onCheckMonitored: vi.fn().mockResolvedValue(undefined),
      onRename: vi.fn().mockResolvedValue(undefined),
      onPreviewMerge: vi.fn(),
      onMerge: vi.fn(),
      onAdd: vi.fn().mockResolvedValue(true),
      onUpdate: vi.fn(),
      onReviewUpdates: vi.fn(),
      onDelete: vi.fn(),
      onOpenSource: vi.fn(),
      onCopySource: vi.fn()
    };
    const { rerender } = render(
      <SkillSourceView {...props} scopeFilter="monitored" />
    );

    expect(screen.getByText("acme/skills · /engineering")).toBeInTheDocument();
    expect(screen.queryByText("Local project skills")).not.toBeInTheDocument();

    rerender(<SkillSourceView {...props} scopeFilter="manual" />);
    expect(screen.queryByText("acme/skills · /engineering")).not.toBeInTheDocument();
    expect(screen.getByText("Local project skills")).toBeInTheDocument();

    rerender(
      <SkillSourceView
        {...props}
        scopeFilter="all"
        sourceKindFilter="local"
        resultFilter="failed"
      />
    );
    expect(screen.queryByText("acme/skills · /engineering")).not.toBeInTheDocument();
    expect(screen.getByText("Local project skills")).toBeInTheDocument();
  });

  it("exposes the shared Online and Local source filter grammar", () => {
    const onSourceKindFilterChange = vi.fn();
    const onResultFilterChange = vi.fn();
    render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        sourceKindFilter="all"
        resultFilter="all"
        onSourceKindFilterChange={onSourceKindFilterChange}
        onResultFilterChange={onResultFilterChange}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    const filters = screen.getByRole("button", { name: "Filters" });
    fireEvent.click(filters);
    fireEvent.change(screen.getByRole("combobox", { name: "Source type filter" }), {
      target: { value: "online" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Source result filter" }), {
      target: { value: "changes" }
    });

    expect(onSourceKindFilterChange).toHaveBeenCalledWith("online");
    expect(onResultFilterChange).toHaveBeenCalledWith("changes");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Source filters" })).not.toBeInTheDocument();
    expect(filters).toHaveFocus();
  });

  it("selects consecutive source groups by dragging through the selection rail", () => {
    const groups = ["frontend", "backend", "platform"].map((name, index) => ({
      ...group,
      sourceId: `source-${name}`,
      canonicalLink: `https://github.com/acme/skills/tree/main/${name}`,
      directory: name,
      counts: { total: 1, updates: 0, new: 0, removed: 0 },
      candidates: [],
      displayName: name
    }));
    render(
      <SkillSourceView
        active
        groups={groups}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onReviewUpdates={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    const checkboxes = screen.getAllByRole("checkbox");
    const rows = document.querySelectorAll<HTMLElement>(".skill-source-group");
    fireEvent.pointerDown(checkboxes[0]!.closest("label")!, { button: 0 });
    fireEvent.pointerEnter(rows[1]!);
    fireEvent.pointerUp(window);

    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Merge selected (2)" })).toBeEnabled();
  });

  it("uses an explicit merge selection mode and exits it with Escape", () => {
    const secondGroup = {
      ...group,
      sourceId: "source-backend",
      canonicalLink: "https://github.com/acme/skills/tree/main/backend",
      directory: "backend"
    };
    render(
      <SkillSourceView
        active
        groups={[group, secondGroup]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Merge selected (0)" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeEnabled();
  });

  it("expands from the source row without stealing nested actions", () => {
    const onOpenSource = vi.fn();
    render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={onOpenSource}
        onCopySource={vi.fn()}
      />
    );

    const row = document.querySelector<HTMLElement>(".skill-source-group-row")!;
    fireEvent.click(row);
    expect(screen.getByRole("button", { name: "Collapse source" })).toBeInTheDocument();
    fireEvent.click(document.querySelector<HTMLButtonElement>(".skill-source-link")!);
    expect(onOpenSource).toHaveBeenCalledWith(group.canonicalLink);
    expect(screen.getByRole("button", { name: "Collapse source" })).toBeInTheDocument();
  });

  it("shows local progress while checking monitored sources", async () => {
    let finishCheck!: () => void;
    const onCheckAll = vi.fn(() => new Promise<void>((resolve) => {
      finishCheck = resolve;
    }));
    render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={onCheckAll}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    const checkMonitored = screen.getByRole("button", { name: "Check for updates" });
    expect(
      screen.queryByRole("button", { name: /^Check monitored$/ })
    ).not.toBeInTheDocument();
    fireEvent.click(checkMonitored);
    expect(checkMonitored).toHaveAttribute("aria-busy", "true");
    expect(checkMonitored.querySelector(".is-spinning")).not.toBeNull();
    finishCheck();
    await waitFor(() => expect(checkMonitored).toHaveAttribute("aria-busy", "false"));
  });

  it("unignores a source candidate without importing it", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const onSetCandidateIgnored = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onSetCandidateIgnored={onSetCandidateIgnored}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={onAdd}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand source" }));
    fireEvent.click(screen.getByRole("button", {
      name: "Ignore testing for this source"
    }));
    await waitFor(() => expect(onSetCandidateIgnored).toHaveBeenCalledWith({
      sourceId: group.sourceId,
      sourceSubpath: "testing",
      ignored: true
    }));

    const ignoredGroup: SkillSourceGroupView = {
      ...group,
      counts: { ...group.counts, new: 0 },
      candidates: group.candidates.map((candidate) =>
        candidate.sourceSubpath === "testing"
          ? { ...candidate, state: "ignored" as const }
          : candidate
      )
    };
    rerender(
      <SkillSourceView
        active
        groups={[ignoredGroup]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onSetCandidateIgnored={onSetCandidateIgnored}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={onAdd}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    expect(screen.getByText("Ignored")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unignore" }));
    await waitFor(() => expect(onSetCandidateIgnored).toHaveBeenLastCalledWith({
      sourceId: group.sourceId,
      sourceSubpath: "testing",
      ignored: false
    }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("animates the action that is waiting for an update preview", async () => {
    let finishUpdate!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>((resolve) => {
      finishUpdate = resolve;
    }));
    render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={onUpdate}
        onReviewUpdates={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand source" }));
    const review = screen.getByRole("button", { name: "Update review" });
    fireEvent.click(review);
    expect(review.querySelector(".is-spinning")).not.toBeNull();

    finishUpdate();
    await waitFor(() => expect(review.querySelector(".is-spinning")).toBeNull());
  });

  it("keeps source-check progress on the command that owns it", () => {
    const props = {
      active: true,
      groups: [group],
      loading: false,
      onCheckGroup: vi.fn().mockResolvedValue(undefined),
      onCheckMonitored: vi.fn().mockResolvedValue(undefined),
      onRename: vi.fn().mockResolvedValue(undefined),
      onPreviewMerge: vi.fn(),
      onMerge: vi.fn(),
      onAdd: vi.fn().mockResolvedValue(true),
      onUpdate: vi.fn(),
      onReviewUpdates: vi.fn(),
      onDelete: vi.fn(),
      onOpenSource: vi.fn(),
      onCopySource: vi.fn()
    };
    const { rerender } = render(
      <SkillSourceView
        {...props}
        updateActivity={{ kind: "check-source", sourceId: group.sourceId }}
      />
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Source actions for acme/skills · /engineering"
    }));
    expect(screen.getByRole("menuitem", { name: "Check source" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Check for updates" })).toHaveAttribute("aria-busy", "false");

    rerender(<SkillSourceView {...props} updateActivity={{ kind: "check-sources" }} />);
    expect(screen.getByRole("menuitem", { name: "Check source" })).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "Check for updates" })).toHaveAttribute("aria-busy", "true");
  });

  it("requires an explicit preview before merging selected source scopes", async () => {
    const secondGroup: SkillSourceGroupView = {
      ...group,
      sourceId: "source-backend",
      canonicalLink: "https://github.com/acme/skills/tree/main/engineering/backend",
      directory: "engineering/backend",
      candidates: []
    };
    const onPreviewMerge = vi.fn().mockResolvedValue({
      id: "merge-preview",
      sourceIds: [group.sourceId, secondGroup.sourceId],
      sources: [group, secondGroup],
      mergedSource: {
        formatVersion: 1,
        canonicalLink: "https://github.com/acme/skills/tree/main/engineering",
        repository: group.repository,
        ref: "main",
        directory: "engineering"
      },
      affectedSkillCount: 4,
      discoveredSkillCount: 5,
      mergesIntoExistingSource: false,
      warnings: [],
      blockers: []
    });
    const onMerge = vi.fn().mockResolvedValue({
      source: group,
      mergedSourceCount: 2,
      affectedSkillCount: 4,
      backupPath: "/tmp/source-merge"
    });
    render(
      <SkillSourceView
        active
        groups={[group, secondGroup]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={onPreviewMerge}
        onMerge={onMerge}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Merge selected (2)" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm source merge" });
    expect(dialog.querySelector(".profile-dialog-header")).not.toBeNull();
    expect(dialog.querySelector(".preview-actions")).not.toBeNull();
    expect(screen.getByLabelText("Merged source directory")).toHaveValue("engineering");
    await waitFor(() => expect(onPreviewMerge).toHaveBeenCalledWith({
      sourceIds: [group.sourceId, secondGroup.sourceId],
      directory: "engineering"
    }));
    expect(within(dialog).getByText("4")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm merge" }));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith("merge-preview"));
    expect(screen.queryByRole("dialog", { name: "Confirm source merge" })).not.toBeInTheDocument();
  });

  it("renames a source without changing its repository link", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <SkillSourceView
        active
        groups={[group]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={onRename}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Source actions for acme/skills · /engineering"
    }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename source" }));
    const dialog = screen.getByRole("dialog", { name: "Rename source" });
    expect(dialog.querySelector(".profile-dialog-header")).not.toBeNull();
    expect(dialog.querySelector(".preview-actions")).not.toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Source name"), {
      target: { value: "Engineering Skills" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith({
      sourceId: group.sourceId,
      name: "Engineering Skills"
    }));
  });

  it("keeps zero change counts neutral", () => {
    render(
      <SkillSourceView
        active
        groups={[{ ...group, counts: { total: 1, updates: 0, new: 0, removed: 0 } }]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={vi.fn()}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    expect(document.querySelector(".skill-source-counts .is-update")).toBeNull();
    expect(document.querySelector(".skill-source-counts .is-new")).toBeNull();
    expect(document.querySelector(".skill-source-counts .is-removed")).toBeNull();
  });

  it("summarizes repository merge failures while retaining the full error", async () => {
    const secondGroup: SkillSourceGroupView = {
      ...group,
      sourceId: "source-backend",
      canonicalLink: "https://github.com/acme/skills/tree/main/engineering/backend",
      directory: "engineering/backend",
      candidates: []
    };
    const onPreviewMerge = vi.fn().mockRejectedValue(new Error(
      "Error invoking remote method 'skills:preview-source-merge': Repository access failed over HTTPS and SSH. Host key verification failed"
    ));
    render(
      <SkillSourceView
        active
        groups={[group, secondGroup]}
        loading={false}
        onCheckGroup={vi.fn().mockResolvedValue(undefined)}
        onCheckMonitored={vi.fn().mockResolvedValue(undefined)}
        onRename={vi.fn().mockResolvedValue(undefined)}
        onPreviewMerge={onPreviewMerge}
        onMerge={vi.fn()}
        onAdd={vi.fn().mockResolvedValue(true)}
        onUpdate={vi.fn()}
        onReviewUpdates={vi.fn()}
        onDelete={vi.fn()}
        onOpenSource={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Merge selected (2)" }));

    expect(await screen.findByText(
      "Could not access this repository. Check your Git credentials or SSH key."
    )).toBeInTheDocument();
    expect(screen.getByLabelText("Full merge error")).toHaveTextContent(
      "Could not access this repository"
    );
  });
});
