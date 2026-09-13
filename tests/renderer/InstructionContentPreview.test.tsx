// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstructionContentPreview } from "../../src/renderer/components/InstructionContentPreview";
import { InstructionDocumentDialog } from "../../src/renderer/components/InstructionDocumentDialog";

afterEach(cleanup);

describe("instruction reading surface", () => {
  it("renders Markdown without fetching images or executing HTML, and retains original source", () => {
    const content = '# Team rules\n\n- Test first\n\n![private](https://example.com/tracker.png)\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))';
    const { container } = render(<InstructionContentPreview content={content} path="AGENTS.md" />);
    expect(screen.getByRole("heading", { name: "Team rules" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("Test first");
    expect(container.querySelector("img, script, iframe")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector(".document-markdown--wrap")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Source code" }));
    expect(container.querySelector(".syntax-code-preview")).toHaveTextContent("# Team rules");
    expect(screen.getByRole("button", { name: "Source code" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Source code" }));
    expect(screen.getByRole("heading", { name: "Team rules" })).toBeInTheDocument();
  });

  it("does not render configuration files as Markdown", () => {
    const { container } = render(<InstructionContentPreview content='{"key":true}' path="settings.json" />);
    expect(container.querySelector(".syntax-code-preview")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("keeps reading, source, editing and maximizing in one dialog without saving on mode changes", () => {
    const onSave = vi.fn();
    render(<InstructionDocumentDialog open fileName="AGENTS.md" value="# Rules" resetKey="one"
      ariaLabel="Instruction" editorLabel="Content" onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Maximize preview" }));
    expect(screen.getByRole("dialog")).toHaveClass("is-maximized");
    expect(screen.getByRole("heading", { name: "Rules" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Content" })).toHaveValue("# Rules");
    expect(screen.getByRole("textbox", { name: "Content" })).toHaveAttribute("wrap", "soft");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Rules" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
