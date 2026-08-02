// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SkillImportConflictDialog,
  type PendingSkillImport
} from "../../src/renderer/components/SkillImportConflictDialog";

afterEach(cleanup);

const snapshot = (id: string, contentHash: string, skillMarkdown: string) => ({
  id,
  name: "review-skill",
  description: "Review changes",
  version: "1.0.0",
  contentHash,
  modifiedAt: "2026-07-20T10:00:00.000Z",
  sourceType: "local" as const,
  source: `/tmp/${id}`,
  skillMarkdown
});

const pending: PendingSkillImport = {
  preview: {
    source: {
      kind: "local",
      input: { sourcePath: "/tmp/incoming" }
    },
    incoming: snapshot("incoming", "incoming-hash", "# Incoming"),
    conflicts: [{
      existing: snapshot("existing", "existing-hash", "# Existing"),
      match: "name",
      contentIdentical: false,
      sourceUpdateAvailable: false,
      identical: false,
      changes: [{
        path: "SKILL.md",
        before: "# Existing\n",
        after: "# Incoming\n",
        diff: "--- SKILL.md\n+++ SKILL.md\n@@ -1 +1 @@\n-# Existing\n+# Incoming\n"
      }]
    }],
    suggestedDuplicateId: "review-skill-copy"
  },
  resolve: vi.fn()
};

describe("SkillImportConflictDialog", () => {
  it("opens the shared diff workspace and returns to the import decision", () => {
    const onDismiss = vi.fn();
    render(
      <SkillImportConflictDialog
        pending={pending}
        dialogRef={{ current: null }}
        initialFocusRef={{ current: null }}
        onDismiss={onDismiss}
        onConfirm={vi.fn()}
      />
    );

    const parent = screen.getByRole("dialog", { name: "Review duplicate Skill" });
    expect(parent.querySelector('[data-file-icon="markdown"]')).toBeInTheDocument();
    const expand = within(parent).getByRole("button", { name: "Maximize preview" });
    fireEvent.click(expand);

    expect(screen.getByRole("dialog", { name: "Full-screen preview" }))
      .toBeInTheDocument();
    expect(parent).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Full-screen preview" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Review duplicate Skill" }))
      .toBeInTheDocument();
    expect(expand).toHaveFocus();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("maximizes an identical read-only SKILL.md preview through the same workspace", () => {
    const identicalPending: PendingSkillImport = {
      ...pending,
      preview: {
        ...pending.preview,
        conflicts: [{
          ...pending.preview.conflicts[0]!,
          contentIdentical: true,
          identical: true,
          changes: []
        }]
      }
    };
    render(
      <SkillImportConflictDialog
        pending={identicalPending}
        dialogRef={{ current: null }}
        initialFocusRef={{ current: null }}
        onDismiss={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const parent = screen.getByRole("dialog", { name: "Review duplicate Skill" });
    fireEvent.click(within(parent).getByRole("button", { name: "Maximize preview" }));

    const workspace = screen.getByRole("dialog", { name: "Full-screen preview" });
    expect(workspace).toHaveClass("is-maximized");
    expect(within(workspace).getByRole("button", { name: "SKILL.md" })).toBeEnabled();
    expect(workspace).toHaveTextContent("Incoming");
  });
});
