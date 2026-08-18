// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildProfilesOnlyReviewItems,
  runProfilesOnlySharedCleanup,
  SharedSkillAreaModeActions
} from "../../src/renderer/components/SharedSkillAreaWorkflow";
import type { SkillCollectionLinkGroup } from "../../src/shared/skillCleanup";

afterEach(cleanup);

describe("SharedSkillAreaModeActions", () => {
  it("excludes retained shared collections from Profiles-only migration", () => {
    const retainedCollection: SkillCollectionLinkGroup = {
      path: "/home/test/.agents/skills/superpowers",
      canonicalPath: "/external/superpowers",
      name: "superpowers",
      items: [],
      consumerTargetIds: ["codex"],
      state: "unmanaged",
      libraryReadyCount: 0,
      conflictCount: 0
    };

    expect(buildProfilesOnlyReviewItems(
      [],
      [retainedCollection],
      { codex: "Codex" }
    )).toEqual([]);
  });

  it("does not execute Profiles-only migration for a retained collection", async () => {
    const moveCollection = vi.fn();
    const retainedCollection: SkillCollectionLinkGroup = {
      path: "/home/test/.agents/skills/superpowers",
      canonicalPath: "/external/superpowers",
      name: "superpowers",
      items: [],
      consumerTargetIds: ["codex"],
      state: "unmanaged",
      libraryReadyCount: 0,
      conflictCount: 0
    };

    await expect(runProfilesOnlySharedCleanup({
      groups: [],
      collections: [retainedCollection],
      blockedSkillKeys: [],
      shouldStop: () => false,
      updateProgress: vi.fn(),
      consolidate: vi.fn(),
      moveSkill: vi.fn(),
      retireSkill: vi.fn(),
      moveCollection
    })).resolves.toBe(true);
    expect(moveCollection).not.toHaveBeenCalled();
  });

  it("keeps folder behavior behind one Change action", () => {
    const onChange = vi.fn();
    const onMoveToProfiles = vi.fn();

    render(
      <SharedSkillAreaModeActions
        disabled={false}
        canMoveToProfiles
        canRestore={false}
        onChange={onChange}
        onMoveToProfiles={onMoveToProfiles}
        onShowRestorePoints={vi.fn()}
      />
    );

    expect(screen.queryByRole("radiogroup", { name: "Shared Skills behavior" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.getByRole("radiogroup", { name: "Shared Skills behavior" }))
      .toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Leave as-is/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Manage shared Skills/ }));
    expect(onChange).toHaveBeenCalledWith("managed");
    expect(screen.queryByRole("dialog", { name: "Shared Skills behavior" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    const moveButton = screen.getByRole("button", {
      name: "Move shared Skills to Profile control…"
    });
    expect(moveButton).toHaveClass("ui-button--warning");
    fireEvent.click(moveButton);
    expect(onMoveToProfiles).toHaveBeenCalledTimes(1);
  });

  it("shows migration recovery instead of a false symmetric policy switch", () => {
    const onShowRestorePoints = vi.fn();
    const onMoveToProfiles = vi.fn();

    render(
      <SharedSkillAreaModeActions
        mode="profiles-only"
        disabled={false}
        canMoveToProfiles
        canRestore
        onChange={vi.fn()}
        onMoveToProfiles={onMoveToProfiles}
        onShowRestorePoints={onShowRestorePoints}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.getByText("Profiles control these Skills")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "Move new shared Skills to Profile control…"
    }));
    expect(onMoveToProfiles).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore shared setup…" }));
    expect(onShowRestorePoints).toHaveBeenCalledTimes(1);
  });

  it("dismisses the behavior dialog with Escape", () => {
    render(
      <SharedSkillAreaModeActions
        mode="keep"
        disabled={false}
        canMoveToProfiles={false}
        canRestore={false}
        onChange={vi.fn()}
        onMoveToProfiles={vi.fn()}
        onShowRestorePoints={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Shared Skills behavior" }))
      .not.toBeInTheDocument();
  });
});
