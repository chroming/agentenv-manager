// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SkillCollectionDialog,
  type CollectionResolutionStrategy,
  useSkillCollectionActions
} from "../../src/renderer/components/SkillCollectionCleanup";
import type { SkillCollectionLinkGroup } from "../../src/shared/skillCleanup";

afterEach(cleanup);

const collection = {
  path: "/tmp/.agents/skills/suite",
  canonicalPath: "/tmp/source/skills",
  name: "suite",
  consumerTargetIds: ["codex"],
  state: "conflict",
  libraryReadyCount: 1,
  conflictCount: 1,
  items: [
    {
      name: "different",
      skillKey: "different",
      path: "/tmp/source/skills/different",
      libraryId: "different",
      contentMatchesLibrary: false,
      foundIn: ["codex"]
    },
    {
      name: "missing",
      skillKey: "missing",
      path: "/tmp/source/skills/missing",
      foundIn: ["codex"]
    },
    {
      name: "ready",
      skillKey: "ready",
      path: "/tmp/source/skills/ready",
      libraryId: "ready",
      contentMatchesLibrary: true,
      foundIn: ["codex"]
    }
  ]
} as SkillCollectionLinkGroup;

describe("SkillCollectionDialog", () => {
  it("supports per-Skill review and one strategy for every unresolved Skill", () => {
    const onProcessItem = vi.fn();
    const onApplyStrategy = vi.fn<
      (value: SkillCollectionLinkGroup, strategy: CollectionResolutionStrategy) => void
    >();
    render(
      <SkillCollectionDialog
        collection={collection}
        dialogRef={{ current: null }}
        initialFocusRef={{ current: null }}
        onClose={vi.fn()}
        onChangeRetention={vi.fn()}
        onProcessItem={onProcessItem}
        onApplyStrategy={onApplyStrategy}
        onMove={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Review Skill collection suite" });
    expect(within(dialog).getByRole("status", { name: "different: Needs review" }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("status", { name: "missing: Ready to add" }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("status", { name: "ready: Ready" }))
      .toBeInTheDocument();

    const row = within(dialog)
      .getByRole("status", { name: "different: Needs review" })
      .closest(".skill-collection-member")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Review" }));
    expect(onProcessItem).toHaveBeenCalledWith(collection.items[0]);

    fireEvent.change(within(dialog).getByRole("combobox", {
      name: "Collection version strategy"
    }), { target: { value: "use-collection" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply to 2" }));
    expect(onApplyStrategy).toHaveBeenCalledWith(collection, "use-collection");
  });

  it("applies a batch strategy per Skill and refreshes the collection once", async () => {
    const onSetSkillPathPolicies = vi.fn().mockResolvedValue(true);
    const onImportUnmanaged = vi.fn().mockResolvedValue(true);
    const onResolveCollectionConflict = vi.fn().mockResolvedValue(true);
    const onRefreshInventory = vi.fn().mockResolvedValue(undefined);

    const Harness = () => {
      const { applyStrategy } = useSkillCollectionActions({
        onSetSkillPathPolicies,
        onImportUnmanaged,
        onResolveCollectionConflict,
        onRefreshInventory,
        onClose: vi.fn()
      });
      return (
        <button
          type="button"
          onClick={() => void applyStrategy(collection, "keep-library")}
        >
          Resolve
        </button>
      );
    };

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(onRefreshInventory).toHaveBeenCalledTimes(1));
    expect(onSetSkillPathPolicies).toHaveBeenCalledWith({
      items: [{
        path: "/tmp/source/skills/different",
        skillKey: "different"
      }],
      mode: "use-library"
    });
    expect(onImportUnmanaged).toHaveBeenCalledWith(
      "/tmp/source/skills/missing",
      "copy-only",
      true
    );
    expect(onResolveCollectionConflict).not.toHaveBeenCalled();
  });

  it("uses collection copies for every difference without opening per-item review", async () => {
    const onResolveCollectionConflict = vi.fn().mockResolvedValue(true);
    const onRefreshInventory = vi.fn().mockResolvedValue(undefined);
    const Harness = () => {
      const { applyStrategy } = useSkillCollectionActions({
        onImportUnmanaged: vi.fn().mockResolvedValue(true),
        onResolveCollectionConflict,
        onRefreshInventory,
        onClose: vi.fn()
      });
      return (
        <button
          type="button"
          onClick={() => void applyStrategy(collection, "use-collection")}
        >
          Resolve
        </button>
      );
    };

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(onRefreshInventory).toHaveBeenCalledTimes(1));
    expect(onResolveCollectionConflict).toHaveBeenCalledWith(
      collection.items[0],
      "use-collection",
      true
    );
  });
});
