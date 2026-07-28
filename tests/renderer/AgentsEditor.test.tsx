// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsEditor } from "../../src/renderer/components/AgentsEditor";

afterEach(cleanup);

describe("AgentsEditor", () => {
  it("shows the resolved instruction file and explains when changes load", () => {
    const onChange = vi.fn();
    render(
      <AgentsEditor
        label="agentenv-manager.md"
        path="/Users/example/.trae/rules/agentenv-manager.md"
        policy="manage"
        targetName="Trae CLI"
        value="# Guidance"
        onChange={onChange}
      />
    );

    expect(screen.getByText("/Users/example/.trae/rules/agentenv-manager.md"))
      .toBeInTheDocument();
    const help = screen.getByLabelText(
      "Profile Apply writes this file. New Trae CLI sessions load changes; running conversations keep their current context."
    );
    fireEvent.focus(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "New Trae CLI sessions load changes"
    );

    fireEvent.change(screen.getByRole("textbox", { name: "agentenv-manager.md" }), {
      target: { value: "# Updated" }
    });
    expect(onChange).toHaveBeenCalledWith("# Updated");
  });

  it.each([
    ["ignore", "leaves its instruction file unchanged"],
    ["disable", "clears this instruction file"]
  ] as const)("matches the %s policy in its help text", (policy, expected) => {
    render(
      <AgentsEditor
        label="AGENTS.md"
        path="/Users/example/.agent/AGENTS.md"
        policy={policy}
        targetName="Example Agent"
        value="# Guidance"
        onChange={vi.fn()}
      />
    );

    const help = screen.getByLabelText(new RegExp(expected));
    fireEvent.focus(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent(expected);
  });
});
