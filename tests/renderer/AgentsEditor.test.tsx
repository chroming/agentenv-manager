// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsEditor } from "../../src/renderer/components/AgentsEditor";

afterEach(cleanup);

describe("AgentsEditor", () => {
  it("does not show Profile instructions as current Agent content when the Agent state is unavailable", () => {
    render(
      <AgentsEditor
        label="AGENTS.md"
        path="/agent/AGENTS.md"
        policy="ignore"
        targetName="Codex"
        value="# Profile instructions"
        onSave={vi.fn()}
      />
    );

    expect(screen.queryByText("# Profile instructions")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Current Agent instructions unavailable"
    );
  });

  it("previews the portable AGENTS.md and edits it in the shared dialog", async () => {
    const onSave = vi.fn();
    render(
      <AgentsEditor
        label="agentenv-manager.md"
        path="/Users/example/.trae/rules/agentenv-manager.md"
        policy="manage"
        targetName="Trae CLI"
        value="# Guidance"
        onSave={onSave}
      />
    );

    expect(screen.getByLabelText("Preview of AGENTS.md")).toHaveTextContent("# Guidance");
    expect(screen.queryByText("/Users/example/.trae/rules/agentenv-manager.md"))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open AGENTS.md" }));
    const dialog = screen.getByRole("dialog", { name: "Instruction document" });
    expect(within(dialog).getByLabelText("Preview of AGENTS.md")).toHaveTextContent("# Guidance");
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    const editor = within(dialog).getByRole("textbox", { name: "Profile instruction content" });
    fireEvent.change(editor, { target: { value: "# Updated" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith("# Updated");
    await waitFor(() => expect(within(dialog).getByLabelText("Preview of AGENTS.md"))
      .toHaveTextContent("# Updated"));
  });

  it("shows current Agent instructions as a read-only preview for Keep Agent", () => {
    render(
      <AgentsEditor
        label="AGENTS.md"
        path="/Users/example/.agent/AGENTS.md"
        policy="ignore"
        targetName="Example Agent"
        value="# Guidance"
        currentValue="# Current Agent guidance"
        currentValueAvailable
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText(/\/Users\/example\/\.agent\/AGENTS\.md/)).toBeInTheDocument();
    expect(screen.getByLabelText("Preview of AGENTS.md"))
      .toHaveTextContent("# Current Agent guidance");
    fireEvent.click(screen.getByRole("button", { name: "Open AGENTS.md" }));
    expect(within(screen.getByRole("dialog", { name: "Instruction document" }))
      .queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows an explicit effective empty state when instructions are turned off", () => {
    render(
      <AgentsEditor
        label="AGENTS.md"
        policy="disable"
        targetName="Example Agent"
        value="# Guidance"
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Instructions are turned off for this Agent"
    );
    expect(screen.queryByRole("button", { name: "Open AGENTS.md" })).not.toBeInTheDocument();
  });
});
