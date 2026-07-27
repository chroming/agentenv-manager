// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillUpdateDialog } from "../../src/renderer/components/SkillUpdateDialog";
import type { SkillUpdatePlan } from "../../src/shared/types";

afterEach(cleanup);

const planWithChanges = (count: number): SkillUpdatePlan => ({
  id: "claude-api",
  previewId: "preview-1",
  name: "claude-api",
  sourceType: "github",
  currentRevision: "2492a1a",
  latestRevision: "adba0a5",
  updateAvailable: true,
  changes: Array.from({ length: count }, (_, index) => ({
    path: index === 0 ? "SKILL.md" : `references/file-${index}.md`,
    before: `old ${index}\n`,
    after: `new ${index}\n`,
    diff: [
      `--- ${index === 0 ? "SKILL.md" : `references/file-${index}.md`}`,
      `+++ ${index === 0 ? "SKILL.md" : `references/file-${index}.md`}`,
      "@@ -1,1 +1,1 @@",
      `-old ${index}`,
      `+new ${index}`
    ].join("\n")
  })),
  errors: [],
  impact: {
    profileNames: [],
    linkedInstallCount: 0,
    linkedTargetIds: [],
    copiedInstallCount: 0,
    copiedTargetIds: []
  }
});

describe("SkillUpdateDialog", () => {
  it("renders a large change set as a file list and mounts diffs on demand", () => {
    render(
      <SkillUpdateDialog
        plan={planWithChanges(50)}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "Update preview for claude-api" }))
      .toHaveTextContent("50 file changes");
    const details = [...document.querySelectorAll<HTMLDetailsElement>(
      ".skill-update-dialog .update-change-list > details"
    )];
    expect(details).toHaveLength(50);
    expect(details[0]?.open).toBe(true);
    expect(details.slice(1).every((detail) => !detail.open)).toBe(true);
    expect(details[0]?.querySelector("summary")).toHaveTextContent("SKILL.md");
    expect(details[0]).toHaveTextContent("old 0");
    expect(document.querySelectorAll(".skill-update-dialog .diff-viewer")).toHaveLength(1);

    details[49]!.open = true;
    fireEvent(details[49]!, new Event("toggle"));
    expect(document.querySelectorAll(".skill-update-dialog .diff-viewer")).toHaveLength(2);
  });
});
