// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileInstructionsComposerSection } from "../../src/renderer/components/ProfileInstructionsComposerSection";
import type { InstructionBlock, ProfileDetail } from "../../src/shared/types";

afterEach(cleanup);

const profile: ProfileDetail = {
  id: "daily",
  manifest: { version: 2, id: "daily", name: "Daily", description: "" },
  instructions: "# Local\n",
  resources: { skills: [], mcpByTarget: {} }
};

const block: InstructionBlock = {
  id: "review-rules",
  name: "Review rules",
  description: "Review guidance",
  content: "# Review\n",
  contentHash: "hash",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  path: "/data/instructions/review-rules/CONTENT.md",
  usedByProfiles: ["Daily", "Code Review"]
};
const baselineBlock: InstructionBlock = {
  ...block,
  id: "baseline-rules",
  name: "Baseline rules",
  content: "# Baseline\n"
};

describe("ProfileInstructionsComposerSection", () => {
  it("adds selected Instruction Blocks to the Profile in user-selected order", async () => {
    const onChange = vi.fn();
    render(
      <ProfileInstructionsComposerSection
        profile={profile}
        blocks={[block]}
        summary={{ count: 1, total: 1, mode: "manage" }}
        policy="manage"
        capabilityAvailable
        expanded
        targetName="Codex"
        fileName="AGENTS.md"
        onToggle={vi.fn()}
        onPolicyChange={vi.fn()}
        onChange={onChange}
        onUpdateBlock={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Review rules" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1" }));

    expect(onChange).toHaveBeenCalledWith("# Local\n", {
      skills: [],
      mcpByTarget: {},
      instructions: [{ libraryId: "review-rules", enabled: true }]
    });
  });

  it("supports keyboard reordering without changing enabled state", () => {
    const onChange = vi.fn();
    const composedProfile: ProfileDetail = {
      ...profile,
      resources: {
        ...profile.resources,
        instructions: [
          { libraryId: "review-rules", enabled: true },
          { libraryId: "baseline-rules", enabled: false }
        ]
      }
    };
    render(
      <ProfileInstructionsComposerSection
        profile={composedProfile}
        blocks={[block, baselineBlock]}
        summary={{ count: 2, total: 3, mode: "manage" }}
        policy="manage"
        capabilityAvailable
        expanded
        targetName="Codex"
        fileName="AGENTS.md"
        onToggle={vi.fn()}
        onPolicyChange={vi.fn()}
        onChange={onChange}
        onUpdateBlock={vi.fn()}
      />
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Baseline rules" }), {
      altKey: true,
      key: "ArrowUp"
    });

    expect(onChange).toHaveBeenCalledWith("# Local\n", {
      skills: [],
      mcpByTarget: {},
      instructions: [
        { libraryId: "baseline-rules", enabled: false },
        { libraryId: "review-rules", enabled: true }
      ]
    });
  });

  it("edits a referenced Library Instruction in the shared editor and names affected Profiles", async () => {
    const onUpdateBlock = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfileInstructionsComposerSection
        profile={{
          ...profile,
          instructions: "",
          resources: {
            ...profile.resources,
            instructions: [{ libraryId: block.id, enabled: true }]
          }
        }}
        blocks={[block]}
        summary={{ count: 1, total: 1, mode: "manage" }}
        policy="manage"
        capabilityAvailable
        expanded
        targetName="Codex"
        fileName="AGENTS.md"
        onToggle={vi.fn()}
        onPolicyChange={vi.fn()}
        onChange={vi.fn()}
        onUpdateBlock={onUpdateBlock}
      />
    );

    expect(screen.queryByText("This Profile")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review rules" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Instruction Block" });
    expect(dialog).toHaveTextContent("Used by 2 Profiles");
    expect(dialog).toHaveTextContent("Daily, Code Review");
    fireEvent.change(screen.getByRole("textbox", { name: "Instruction content" }), {
      target: { value: "# Updated review\n" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onUpdateBlock).toHaveBeenCalledWith(block, {
      name: "Review rules",
      description: "Review guidance",
      content: "# Updated review\n"
    });
  });
});
