// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectEnvironmentPreviewDialog } from "../../src/renderer/components/ProjectEnvironmentPreviewDialog";

afterEach(cleanup);

describe("ProjectEnvironmentPreviewDialog", () => {
  it("keeps project and global sources separate and supports maximize and Escape", () => {
    const onClose = vi.fn();
    render(
      <ProjectEnvironmentPreviewDialog
        open
        busy={false}
        onClose={onClose}
        preview={{
          projectId: "project-1",
          agentId: "codex",
          agentName: "Codex",
          fidelity: "partial",
          loadOrder: "unknown",
          projectResources: [{
            id: "instruction-1",
            kind: "instructions",
            name: "AGENTS.md",
            relativePath: "AGENTS.md",
            absolutePath: "/work/AGENTS.md",
            consumerAgentIds: ["codex"],
            state: "ready",
            editable: true
          }],
          globalResources: [{
            kind: "skill",
            name: "review",
            path: "/home/.codex/skills/review",
            state: "ready"
          }],
          issues: ["Built-in instructions are not observable"]
        }}
      />
    );

    expect(screen.getByRole("region", { name: "Workspace resources" })).toHaveTextContent("AGENTS.md");
    expect(screen.getByRole("region", { name: "Agent-global resources" })).toHaveTextContent("review");
    fireEvent.click(screen.getByRole("button", { name: "Maximize preview" }));
    expect(screen.getByRole("dialog", { name: "Loaded resource details" }))
      .toHaveClass("is-maximized");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
