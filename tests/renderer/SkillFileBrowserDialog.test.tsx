// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillFileBrowserDialog } from "../../src/renderer/components/SkillFileBrowserDialog";

afterEach(cleanup);

describe("SkillFileBrowserDialog", () => {
  it("keeps provenance and usage reachable without hovering and preserves file selection", async () => {
    const onUpdateSettings = vi.fn();
    const onReviewProfiles = vi.fn();
    const onReadFile = vi.fn().mockResolvedValue({ path: "SKILL.md", kind: "text", content: "# Example", sizeBytes: 9 });
    render(<SkillFileBrowserDialog
      skill={{ id: "example", name: "Example", description: "Review changes", path: "/tmp/library/example", sourceType: "github",
        source: "https://github.com/example/skills/tree/main/review", updatePolicy: "tracked", contentHash: "abc123", remoteRevision: "oldrevision",
        updatedAt: "2026-09-10T00:00:00Z" }}
      update={{ id: "example", name: "Example", sourceType: "github", latestRevision: "newrevision", updateAvailable: true }}
      profileNames={["Daily", "Review"]}
      installations={[{ agents: "Codex", path: "/tmp/agent/skills/example", method: "Copied", status: "Changes pending" }]}
      onUpdateSettings={onUpdateSettings} onReviewProfiles={onReviewProfiles}
      dialogRef={createRef<HTMLElement>()} initialFocusRef={createRef<HTMLButtonElement>()}
      onListFiles={vi.fn().mockResolvedValue([{ path: "SKILL.md", name: "SKILL.md", kind: "file", sizeBytes: 9 }])}
      onReadFile={onReadFile} onClose={vi.fn()}
    />);
    await waitFor(() => expect(onReadFile).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    const details = screen.getByRole("tabpanel", { name: "Details" });
    expect(details).toHaveTextContent("oldrevision");
    expect(details).toHaveTextContent("newrevision");
    expect(details).toHaveTextContent("Daily Review");
    expect(details).toHaveTextContent("Codex · Copied · Changes pending");
    expect(details).toHaveTextContent("/tmp/agent/skills/example");
    expect(details.querySelectorAll("dd.selectable").length).toBeGreaterThan(5);
    fireEvent.click(screen.getByRole("button", { name: "Update settings" }));
    expect(onUpdateSettings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Review Profiles" }));
    expect(onReviewProfiles).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Maximize preview" }));
    expect(screen.getByRole("dialog")).toHaveClass("is-maximized");
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(await screen.findByText("# Example")).toBeInTheDocument();
    expect(onReadFile).toHaveBeenCalledOnce();
  });

  it("opens SKILL.md by default and lets the user browse nested files", async () => {
    const onReadFile = vi.fn().mockImplementation(async (_id: string, path: string) => ({
      path,
      kind: "text" as const,
      sizeBytes: 20,
      content: path === "SKILL.md" ? "# Review Skill\n" : "# Checklist\n"
    }));
    render(
      <SkillFileBrowserDialog
        skill={{
          id: "review",
          name: "Review",
          description: "Review changes",
          path: "/tmp/library/review",
          sourceType: "local",
          updatePolicy: "untracked",
          contentHash: "abc",
          updatedAt: "2026-07-23T00:00:00.000Z"
        }}
        dialogRef={createRef<HTMLElement>()}
        initialFocusRef={createRef<HTMLButtonElement>()}
        onListFiles={vi.fn().mockResolvedValue([
          {
            kind: "directory",
            name: "references",
            path: "references",
            children: [{
              kind: "file",
              name: "checklist.md",
              path: "references/checklist.md",
              sizeBytes: 12
            }]
          },
          {
            kind: "file",
            name: "SKILL.md",
            path: "SKILL.md",
            sizeBytes: 15
          }
        ])}
        onReadFile={onReadFile}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Files in Review" });
    await waitFor(() => expect(onReadFile).toHaveBeenCalledWith("review", "SKILL.md"));
    expect(dialog.querySelector('[data-file-icon="docs"]')).toBeInTheDocument();
    expect(dialog.querySelectorAll('[data-file-icon="markdown"]')).toHaveLength(2);
    await waitFor(() =>
      expect(dialog.querySelector(".skill-file-preview__content")).toHaveTextContent("Review Skill")
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "checklist.md" }));
    await waitFor(() =>
      expect(onReadFile).toHaveBeenLastCalledWith("review", "references/checklist.md")
    );
    await waitFor(() =>
      expect(dialog.querySelector(".skill-file-preview__content")).toHaveTextContent("Checklist")
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Maximize preview" }));
    expect(dialog).toHaveClass("is-maximized");
    expect(within(dialog).getByRole("button", { name: "Restore preview size" })).toBeEnabled();
    expect(dialog.querySelector(".skill-file-preview__content")).toHaveTextContent("Checklist");
    expect(onReadFile).toHaveBeenCalledTimes(2);
  });

  it("shows a non-destructive state for binary files", async () => {
    render(
      <SkillFileBrowserDialog
        skill={{
          id: "review",
          name: "Review",
          description: "Review changes",
          path: "/tmp/library/review",
          sourceType: "local",
          updatePolicy: "untracked",
          contentHash: "abc",
          updatedAt: "2026-07-23T00:00:00.000Z"
        }}
        dialogRef={createRef<HTMLElement>()}
        initialFocusRef={createRef<HTMLButtonElement>()}
        onListFiles={vi.fn().mockResolvedValue([
          { kind: "file", name: "asset.bin", path: "asset.bin", sizeBytes: 3 }
        ])}
        onReadFile={vi.fn().mockResolvedValue({
          path: "asset.bin",
          kind: "binary",
          sizeBytes: 3
        })}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText("Binary files cannot be previewed")).toBeInTheDocument();
  });
});
