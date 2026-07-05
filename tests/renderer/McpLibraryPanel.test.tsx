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
});
