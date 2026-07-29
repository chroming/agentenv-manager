// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewDialog } from "../../src/renderer/components/PreviewDialog";
import type { ActivationPreview } from "../../src/shared/types";

const preview: ActivationPreview = {
  id: "preview-1",
  profileId: "daily-coding",
  profileContentHash: "profile-hash",
  libraryVersions: { skills: {} },
  targetId: "opencode",
  createdAt: "2026-06-30T00:00:00.000Z",
  issues: [],
  changes: [
    {
      path: "/tmp/home/.config/opencode/opencode.jsonc",
      before: "{}\n",
      after: '{\n  "mcp": {}\n}\n',
      diff: "--- opencode.jsonc\n+++ opencode.jsonc\n@@\n-{}\n+{\"mcp\":{}}\n"
    }
  ],
  resourceChanges: [],
  liveFingerprints: {},
  resourceFingerprints: {},
  sourceFingerprints: {},
  targetState: { managedMcpNames: [] }
};

afterEach(() => {
  cleanup();
});

describe("PreviewDialog", () => {
  it("presents a true no-op as current state with one Close action", () => {
    render(
      <PreviewDialog
        preview={{
          ...preview,
          changes: [],
          resourceChanges: [],
          sharedSkillPreparationChanged: false,
          targetStateChanged: false,
          operation: "apply"
        }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("No changes to apply")).toBeInTheDocument();
    expect(screen.getByText("This Agent already matches the Profile.")).toBeInTheDocument();
    expect(screen.getByText("No files or AgentEnv state will change.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "After applying" })).not.toBeInTheDocument();
  });

  it("renders a structured syntax-highlighted diff", async () => {
    render(<PreviewDialog preview={preview} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.getByText("1 before · 3 after")).toBeInTheDocument();

    const diff = await screen.findByRole("table", {
      name: "Formatted diff for /tmp/home/.config/opencode/opencode.jsonc"
    });

    expect(within(diff).getByText("-")).toBeInTheDocument();
    expect(within(diff).getByText("+")).toBeInTheDocument();
    expect(diff).toHaveTextContent("{\"mcp\":{}}");
    expect(diff.querySelector(".diff-row--deletion")).toBeTruthy();
    expect(diff.querySelector(".diff-row--addition")).toBeTruthy();
    expect(diff.querySelector(".syntax-token")).toBeTruthy();
  });

  it("keeps each configuration diff attached to its semantic change row", () => {
    render(<PreviewDialog preview={preview} onCancel={vi.fn()} onConfirm={vi.fn()} />);

    const details = screen.getAllByText("opencode.jsonc")[0].closest("details");
    expect(details).not.toHaveAttribute("open");

    fireEvent.click(details!.querySelector("summary")!);

    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("table", {
      name: "Formatted diff for /tmp/home/.config/opencode/opencode.jsonc"
    })).toBeInTheDocument();
  });

  it("shows install, replace, and remove resource operations explicitly", () => {
    render(
      <PreviewDialog
        preview={{
          ...preview,
          resourceChanges: [
            { kind: "skill", action: "install", name: "new-skill", path: "/skills/new-skill" },
            { kind: "skill", action: "replace", name: "shared", path: "/skills/shared" },
            { kind: "agent", action: "remove", name: "old.md", path: "/agents/old.md" }
          ]
        }}
      />
    );

    const plan = screen.getByRole("region", { name: "Planned changes" });
    expect(plan).toHaveTextContent("new-skill");
    expect(plan).toHaveTextContent("shared");
    expect(plan).toHaveTextContent("old.md");
    expect(plan.querySelectorAll(".apply-preview-change-row")).toHaveLength(3);
    expect(within(plan).getByText("Skills")).toBeInTheDocument();
    expect(within(plan).getByText("Instructions")).toBeInTheDocument();
  });

  it("describes shared Skill changes as migration preparation rather than immediate installs", () => {
    render(
      <PreviewDialog
        preview={{
          ...preview,
          sharedSkillPreparationChanged: true,
          sharedSkillPreparations: [
            {
              skillKey: "reviewer",
              libraryId: "reviewer",
              sharedPaths: ["/tmp/home/.agents/skills/reviewer"],
              targetName: "reviewer",
              disposition: "install",
              profileId: "daily-coding",
              profileHash: "profile-hash"
            }
          ]
        }}
      />
    );

    expect(screen.getByText("Shared Skill migration plan")).toBeInTheDocument();
    const outcome = screen.getByText("Keep enabled as reviewer after shared cleanup");
    expect(outcome).toBeInTheDocument();
    expect(outcome.closest("article")).toHaveClass("apply-preview-change-row");
    expect(screen.getByText("Prepare")).toBeInTheDocument();
    expect(screen.queryByText(/preparation|migration decision/i)).not.toBeInTheDocument();
  });

  it("does not include Agent-controlled MCPs in the effective payload", () => {
    render(
      <PreviewDialog
        targetNames={{ "claude-code": "Claude Code" }}
        preview={{
          ...preview,
          targetId: "claude-code",
          effectivePayload: {
            instructions: 1,
            skills: 0,
            mcpServers: 0,
            total: 1
          }
        }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const payload = screen.getByRole("region", { name: "After applying" });
    expect(payload).toHaveTextContent("1Instruction files");
    expect(payload).toHaveTextContent("0Skills");
    expect(payload).toHaveTextContent("0MCP overrides");
  });

  it("presents a Skill outside AgentEnv as an explicit backup replacement", () => {
    const path = "/Users/test/.claude/skills/internal-cli";
    render(
      <PreviewDialog
        targetNames={{ "claude-code": "Claude Code" }}
        preview={{
          ...preview,
          targetId: "claude-code",
          issues: [{
            id: `unmanaged-skill-replacement:${path}`,
            code: "outside-skill-replacement",
            disposition: "review",
            resolution: "backup-replace",
            resourceKind: "skill",
            resourceId: "internal-cli",
            path,
            message: "Existing unmanaged Skill internal-cli will be backed up and replaced"
          }],
          resourceChanges: [
            { kind: "skill", action: "replace", name: "internal-cli", path }
          ]
        }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText('Bring Skill "internal-cli" under AgentEnv')).toBeInTheDocument();
    const issueLocation = screen.getByLabelText("Full issue detail");
    fireEvent.focus(issueLocation);
    expect(screen.getByText(path)).toBeInTheDocument();
    expect(screen.getByText("Review required")).toBeInTheDocument();
    expect(screen.queryByText("Blocking issues")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("lets the user keep a reviewed Skill path outside AgentEnv with local progress", async () => {
    const path = "/Users/test/.claude/skills/internal-cli";
    let finish!: () => void;
    const onKeepSkillOutside = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const issue = {
      id: `outside-skill-replacement:${path}`,
      code: "outside-skill-replacement" as const,
      disposition: "review" as const,
      resolution: "backup-replace" as const,
      resourceKind: "skill" as const,
      resourceId: "internal-cli",
      path,
      message: "Existing Skill internal-cli will be backed up and brought under AgentEnv"
    };
    render(
      <PreviewDialog
        preview={{ ...preview, issues: [issue] }}
        onKeepSkillOutside={onKeepSkillOutside}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const keepButton = screen.getByRole("button", { name: "Keep outside" });
    fireEvent.click(keepButton);

    expect(onKeepSkillOutside).toHaveBeenCalledWith(issue);
    expect(keepButton).toHaveAttribute("aria-busy", "true");
    expect(keepButton).toBeDisabled();

    finish();
    await waitFor(() => expect(keepButton).toHaveAttribute("aria-busy", "false"));
  });

  it("puts true blockers before the change plan", () => {
    render(
      <PreviewDialog
        preview={{
          ...preview,
          issues: [{
            id: "missing-library-skill:missing-skill",
            code: "missing-library-skill",
            disposition: "block",
            resolution: "edit-profile",
            resourceKind: "skill",
            resourceId: "missing-skill",
            message: "Library Skill does not exist: missing-skill"
          }],
          resourceChanges: [
            { kind: "skill", action: "install", name: "missing-skill", path: "/skills/missing-skill" }
          ]
        }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Preview" });
    const blocker = within(dialog).getByText("Blocking issues").closest("section")!;
    const changes = within(dialog).getByRole("region", { name: "Planned changes" });
    expect(screen.getByText("Cannot apply")).toBeInTheDocument();
    expect(blocker.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the exact Local Skills collection from an actionable blocker", () => {
    const onReviewSkillCollection = vi.fn();
    const issue = {
      id: "shared-skill-conflict:/Users/test/.agents/skills/superpowers",
      code: "shared-skill-conflict" as const,
      disposition: "block" as const,
      resolution: "review-local-skills" as const,
      resourceKind: "skill" as const,
      resourceId: "/Users/test/.agents/skills/superpowers",
      path: "/Users/test/.agents/skills/superpowers",
      message: "14 Skills are loaded through collection without exact Library copies",
      detail: "Choose the Library versions for this collection, or keep the collection outside AgentEnv."
    };

    render(
      <PreviewDialog
        preview={{ ...preview, issues: [issue] }}
        onReviewSkillCollection={onReviewSkillCollection}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Review collection" }));
    expect(onReviewSkillCollection).toHaveBeenCalledWith(issue);
  });

  it("separates preserved resources from non-blocking review notes", () => {
    render(
      <PreviewDialog
        preview={{
          ...preview,
          issues: [
            {
              id: "unmanaged-skill-preserved:/skills/local-only",
              code: "kept-outside-skill",
              disposition: "notice",
              resolution: "preserve",
              resourceKind: "skill",
              resourceId: "local-only",
              path: "/skills/local-only",
              message: "Unmanaged local Skill local-only will be preserved"
            },
            {
              id: "globally-disabled-skill:dormant",
              code: "globally-disabled-skill",
              disposition: "notice",
              resolution: "automatic",
              resourceKind: "skill",
              resourceId: "dormant",
              message: "Library Skill dormant is globally disabled and will not be applied"
            }
          ]
        }}
      />
    );

    expect(screen.getByText("Preserved outside this Profile")).toBeInTheDocument();
    expect(screen.getByText("Review notes")).toBeInTheDocument();
    expect(screen.getByText("Preserved outside this Profile").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Review notes").parentElement).toHaveTextContent("1");
  });

  it("dismisses modal previews with Escape and backdrop clicks", async () => {
    const onCancel = vi.fn();
    render(<PreviewDialog preview={preview} onCancel={onCancel} onConfirm={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "Preview" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    const backdrop = dialog.parentElement;
    expect(backdrop).toHaveClass("preview-modal-backdrop");
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("moves focus into the modal and restores the invoking control on close", () => {
    const PreviewHarness = () => {
      const [isOpen, setIsOpen] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>
            Open preview
          </button>
          {isOpen ? (
            <PreviewDialog
              preview={preview}
              onCancel={() => setIsOpen(false)}
              onConfirm={vi.fn()}
            />
          ) : null}
        </>
      );
    };

    render(<PreviewHarness />);
    const invokingControl = screen.getByRole("button", { name: "Open preview" });
    invokingControl.focus();

    fireEvent.click(invokingControl);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Preview" })).not.toBeInTheDocument();
    expect(invokingControl).toHaveFocus();
  });

  it("wraps Tab from the last modal control to the first", () => {
    render(<PreviewDialog preview={preview} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    const firstControl = dialog.querySelector<HTMLElement>("summary")!;
    const lastControl = within(dialog).getByRole("button", { name: "Confirm" });
    lastControl.focus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(firstControl).toHaveFocus();
  });

  it("wraps Shift+Tab from the first modal control to the last", () => {
    render(<PreviewDialog preview={preview} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    const firstControl = dialog.querySelector<HTMLElement>("summary")!;
    const lastControl = within(dialog).getByRole("button", { name: "Confirm" });
    firstControl?.focus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(lastControl).toHaveFocus();
  });

  it("keeps focus inside when the focused Confirm becomes disabled", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const renderDialog = (confirmDisabled: boolean) => (
      <PreviewDialog
        preview={preview}
        confirmDisabled={confirmDisabled}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
    const { rerender } = render(renderDialog(false));
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    const firstControl = dialog.querySelector<HTMLElement>("summary")!;
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    confirm.focus();

    rerender(renderDialog(true));
    fireEvent.keyDown(document, { key: "Tab" });

    expect(firstControl).toHaveFocus();

    rerender(renderDialog(false));
    within(dialog).getByRole("button", { name: "Confirm" }).focus();
    rerender(renderDialog(true));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("closes only the topmost modal and restores focus inside the outer dialog", () => {
    const outerCancel = vi.fn();
    const innerCancel = vi.fn();
    const NestedPreviewHarness = () => {
      const [isOuterOpen, setIsOuterOpen] = useState(false);
      const [isInnerOpen, setIsInnerOpen] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setIsOuterOpen(true)}>
            Open outer preview
          </button>
          {isOuterOpen ? (
            <PreviewDialog
              preview={preview}
              title="Outer preview"
              cancelLabel="Close outer"
              confirmLabel="Open inner preview"
              onCancel={() => {
                outerCancel();
                setIsOuterOpen(false);
              }}
              onConfirm={() => setIsInnerOpen(true)}
            />
          ) : null}
          {isInnerOpen ? (
            <PreviewDialog
              preview={preview}
              title="Inner preview"
              cancelLabel="Close inner"
              confirmLabel="Confirm inner"
              onCancel={() => {
                innerCancel();
                setIsInnerOpen(false);
              }}
              onConfirm={vi.fn()}
            />
          ) : null}
        </>
      );
    };

    render(<NestedPreviewHarness />);
    const outerTrigger = screen.getByRole("button", { name: "Open outer preview" });
    outerTrigger.focus();
    fireEvent.click(outerTrigger);
    const outerConfirm = screen.getByRole("button", { name: "Open inner preview" });
    outerConfirm.focus();
    fireEvent.click(outerConfirm);

    expect(screen.getAllByRole("dialog", { name: "Preview" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Close inner" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(innerCancel).toHaveBeenCalledTimes(1);
    expect(outerCancel).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog", { name: "Preview" })).toHaveLength(1);
    expect(screen.getByText("Outer preview")).toBeInTheDocument();
    expect(outerConfirm).toHaveFocus();
  });
});
