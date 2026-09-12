// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillFileBrowserDialog } from "../../src/renderer/components/SkillFileBrowserDialog";

afterEach(cleanup);

describe("SkillFileBrowserDialog", () => {
  it("does not read a previous Skill's selection when switching to a slow or empty tree", async () => {
    const onReadFile = vi.fn().mockImplementation(async (_id, path) => ({ path, kind: "text", content: "Previous contents" }));
    let resolveTree!: (nodes: []) => void;
    const onListFiles = vi.fn().mockResolvedValueOnce([{ path: "old.md", name: "old.md", kind: "file" }])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveTree = resolve; }))
      .mockRejectedValueOnce(new Error("Tree unavailable"))
      .mockResolvedValueOnce([{ path: "new.md", name: "new.md", kind: "file" }]);
    const props = {
      dialogRef: createRef<HTMLElement>(), initialFocusRef: createRef<HTMLButtonElement>(),
      onListFiles, onReadFile, onClose: vi.fn()
    };
    const skill = { id: "old", name: "Example", description: "", path: "/tmp/example", sourceType: "local" as const,
      updatePolicy: "untracked" as const, contentHash: "hash", updatedAt: "2026-09-12T00:00:00Z" };
    const { rerender } = render(<SkillFileBrowserDialog {...props} skill={skill} />);
    expect(await screen.findByText("Previous contents")).toBeInTheDocument();
    rerender(<SkillFileBrowserDialog {...props} skill={{ ...skill, id: "empty" }} />);
    expect(screen.queryByText("Previous contents")).not.toBeInTheDocument();
    expect(onReadFile).not.toHaveBeenCalledWith("empty", "old.md");
    await act(async () => resolveTree([]));
    expect(screen.queryByText("Previous contents")).not.toBeInTheDocument();
    rerender(<SkillFileBrowserDialog {...props} skill={{ ...skill, id: "failure" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Tree unavailable");
    expect(screen.getByText("Could not load files")).toBeInTheDocument();
    expect(screen.queryByText("No previewable files")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onReadFile).toHaveBeenCalledWith("failure", "new.md"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not report an incomplete inventory as not installed and retains known copies", async () => {
    const props = {
      skill: { id: "example", name: "Example", description: "", path: "/tmp/example", sourceType: "local" as const,
        updatePolicy: "untracked" as const, contentHash: "hash", updatedAt: "2026-09-12T00:00:00Z" },
      dialogRef: createRef<HTMLElement>(), initialFocusRef: createRef<HTMLButtonElement>(),
      onListFiles: vi.fn().mockResolvedValue([]), onReadFile: vi.fn(), onClose: vi.fn()
    };
    const { rerender } = render(<SkillFileBrowserDialog {...props} inventoryNotice="Checking local Skills" />);
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Checking local Skills");
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent("Not installed");
    rerender(<SkillFileBrowserDialog {...props} inventoryNotice="Scan incomplete"
      installations={[{ agents: "Codex", path: "/tmp/codex/example", method: "Copied", status: "Up to date" }]} />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Scan incomplete");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("/tmp/codex/example");
    rerender(<SkillFileBrowserDialog {...props} />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("No detected copies");
  });

  it("retries the selected nested file without resetting to SKILL.md", async () => {
    const onListFiles = vi.fn().mockResolvedValue([
      { path: "SKILL.md", name: "SKILL.md", kind: "file" },
      { path: "references/guide.md", name: "guide.md", kind: "file" }
    ]);
    const onReadFile = vi.fn().mockResolvedValueOnce({ path: "SKILL.md", kind: "text", content: "# Main" })
      .mockRejectedValueOnce(new Error("File unavailable"))
      .mockResolvedValueOnce({ path: "references/guide.md", kind: "text", content: "# Guide" });
    render(<SkillFileBrowserDialog
      skill={{ id: "example", name: "Example", description: "", path: "/tmp/example", sourceType: "local",
        updatePolicy: "untracked", contentHash: "hash", updatedAt: "2026-09-12T00:00:00Z" }}
      dialogRef={createRef<HTMLElement>()} initialFocusRef={createRef<HTMLButtonElement>()}
      onListFiles={onListFiles} onReadFile={onReadFile} onClose={vi.fn()} />);
    await screen.findByText("# Main");
    fireEvent.click(screen.getByRole("button", { name: "guide.md" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("# Guide")).toBeInTheDocument();
    expect(onReadFile).toHaveBeenLastCalledWith("example", "references/guide.md");
    expect(onListFiles).toHaveBeenCalledOnce();
  });
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
