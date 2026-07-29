// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillMergeDiffSection } from "../../src/renderer/components/SkillMergeDiffSection";
import type { SkillMergeComparison } from "../../src/shared/types";

afterEach(cleanup);

const comparison: SkillMergeComparison = {
  leftId: "library-copy",
  rightId: "incoming-copy",
  identical: false,
  changes: [{
    path: "SKILL.md",
    before: "# Library\n",
    after: "# Incoming\n",
    diff: "--- SKILL.md\n+++ SKILL.md\n@@ -1 +1 @@\n-# Library\n+# Incoming\n"
  }]
};

describe("SkillMergeDiffSection", () => {
  it("reports its expanded state and restores focus after the workspace closes", () => {
    const onExpandedChange = vi.fn();
    render(
      <SkillMergeDiffSection
        comparison={comparison}
        compareEntries={[]}
        compareId="incoming-copy"
        keepId="library-copy"
        onCompareChange={vi.fn()}
        onExpandedChange={onExpandedChange}
      />
    );

    const expand = screen.getByRole("button", { name: "Expand preview" });
    fireEvent.click(expand);
    expect(screen.getByRole("dialog", { name: "Expanded diff preview" }))
      .toBeInTheDocument();
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Expanded diff preview" })).toBeNull();
    expect(expand).toHaveFocus();
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });
});
