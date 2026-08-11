// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillManagementMigrationDialog } from "../../src/renderer/components/SkillManagementMigrationDialog";

afterEach(cleanup);

describe("SkillManagementMigrationDialog", () => {
  it("explains the marker-only migration and preserved deployment topology", () => {
    render(
      <SkillManagementMigrationDialog
        busy={false}
        legacyMarkerCount={3}
        open
        onDismiss={vi.fn()}
        onReview={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Upgrade Skill management" });
    expect(dialog).toHaveTextContent("3 legacy ownership files need review");
    expect(dialog).toHaveTextContent("does not change Skill content, timestamps, or whether an existing install is a link or copy");
    expect(dialog.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });

  it("opens the existing Local Skills Manager workflow", () => {
    const onReview = vi.fn();
    render(
      <SkillManagementMigrationDialog
        busy={false}
        legacyMarkerCount={1}
        open
        onDismiss={vi.fn()}
        onReview={onReview}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Review local Skills" }));
    expect(onReview).toHaveBeenCalledOnce();
  });
});
