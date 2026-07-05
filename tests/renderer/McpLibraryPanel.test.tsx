// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpLibraryPanel } from "../../src/renderer/components/McpLibraryPanel";
import { defaultMcpLibraryViewState } from "../../src/renderer/libraryViewState";

afterEach(cleanup);

describe("McpLibraryPanel", () => {
  it("emits a controlled search update with reset scroll", () => {
    const onViewStateChange = vi.fn();

    render(
      <McpLibraryPanel
        mcpServers={[]}
        mcpUsage={{}}
        viewState={{ ...defaultMcpLibraryViewState, scrollTop: 220 }}
        onViewStateChange={onViewStateChange}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onReviewUsage={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Search MCP servers" }), {
      target: { value: "github" }
    });

    expect(onViewStateChange).toHaveBeenCalledWith({ search: "github", scrollTop: 0 });
  });

  it("routes referenced server deletion to the profile that owns the reference", () => {
    const onRemove = vi.fn();
    const onReviewUsage = vi.fn();
    render(
      <McpLibraryPanel
        mcpServers={[
          {
            id: "context7",
            name: "Context7",
            transport: "http",
            url: "https://example.com/mcp"
          }
        ]}
        mcpUsage={{ context7: ["Daily Coding"] }}
        viewState={defaultMcpLibraryViewState}
        onViewStateChange={vi.fn()}
        onSave={vi.fn()}
        onRemove={onRemove}
        onReviewUsage={onReviewUsage}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove context7" }));
    const dialog = screen.getByRole("dialog", { name: "Delete MCP server" });
    expect(dialog).toHaveTextContent("used by Daily Coding");
    fireEvent.click(screen.getByRole("button", { name: "Review profiles" }));

    expect(onReviewUsage).toHaveBeenCalledWith("context7");
    expect(onRemove).not.toHaveBeenCalled();
  });
});
