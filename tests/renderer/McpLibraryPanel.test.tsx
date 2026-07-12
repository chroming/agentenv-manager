// @vitest-environment jsdom
import { useRef, useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpLibraryPanel } from "../../src/renderer/components/McpLibraryPanel";
import { defaultMcpLibraryViewState } from "../../src/renderer/libraryViewState";

afterEach(cleanup);

const McpCreateHarness = (props: ComponentProps<typeof McpLibraryPanel>) => {
  const [createRequest, setCreateRequest] = useState(0);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={createTriggerRef}
        type="button"
        onClick={() => setCreateRequest((current) => current + 1)}
      >
        Add MCP server
      </button>
      <McpLibraryPanel
        {...props}
        createRequest={createRequest}
        createTriggerRef={createTriggerRef}
      />
    </>
  );
};

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

    fireEvent.click(screen.getByRole("button", { name: "More actions for context7" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove context7" }));
    const dialog = screen.getByRole("dialog", { name: "Delete MCP server" });
    expect(dialog).toHaveTextContent("used by Daily Coding");
    fireEvent.click(screen.getByRole("button", { name: "Review profiles" }));

    expect(onReviewUsage).toHaveBeenCalledWith("context7");
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("protects MCP identity and validates portable environment references", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <McpCreateHarness
        mcpServers={[
          {
            id: "context7",
            name: "Context7 with a deliberately long display name",
            transport: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"]
          }
        ]}
        mcpUsage={{ context7: ["Daily Coding", "Code Review"] }}
        viewState={defaultMcpLibraryViewState}
        onViewStateChange={vi.fn()}
        onSave={onSave}
        onRemove={vi.fn()}
        onReviewUsage={vi.fn()}
      />
    );

    const endpoint = screen.getByLabelText("Full MCP endpoint context7");
    fireEvent.focus(endpoint);
    expect(screen.getByRole("tooltip")).toHaveTextContent("@upstash/context7-mcp");
    fireEvent.blur(endpoint);

    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    expect(screen.getByText("Add MCP server", { selector: "strong" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("MCP library id"), {
      target: { value: "context7" }
    });
    expect(screen.getByText("This ID already exists. Choose a unique ID.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save MCP server" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("MCP library id"), {
      target: { value: "local-search" }
    });
    fireEvent.change(screen.getByLabelText("MCP library name"), {
      target: { value: "Local Search" }
    });
    fireEvent.change(screen.getByLabelText("MCP command"), {
      target: { value: "node" }
    });
    fireEvent.change(screen.getByLabelText("MCP env"), {
      target: { value: "SEARCH_TOKEN\nCACHE_DIR=AGENTENV_CACHE_DIR" }
    });
    expect(screen.getByText(/Environment aliases are not portable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save MCP server" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("MCP env"), {
      target: { value: "SEARCH_TOKEN\nAGENTENV_CACHE_DIR" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save MCP server" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        id: "local-search",
        name: "Local Search",
        transport: "stdio",
        command: "node",
        url: undefined,
        args: [],
        env: {
          AGENTENV_CACHE_DIR: "AGENTENV_CACHE_DIR",
          SEARCH_TOKEN: "SEARCH_TOKEN"
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit context7" }));
    expect(screen.getByLabelText("MCP library id")).toBeDisabled();
    expect(screen.getByText("ID is fixed because Profiles reference it.")).toBeInTheDocument();
    expect(screen.getByLabelText("MCP library name")).toHaveFocus();
  });

  it("rejects malformed remote server URLs before saving", () => {
    render(
      <McpCreateHarness
        mcpServers={[]}
        mcpUsage={{}}
        viewState={defaultMcpLibraryViewState}
        onViewStateChange={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onReviewUsage={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    fireEvent.change(screen.getByLabelText("MCP library id"), { target: { value: "remote-docs" } });
    fireEvent.change(screen.getByLabelText("MCP library name"), { target: { value: "Remote Docs" } });
    fireEvent.change(screen.getByLabelText("MCP transport"), { target: { value: "http" } });
    fireEvent.change(screen.getByLabelText("MCP URL"), { target: { value: "file:///tmp/mcp" } });

    expect(screen.getByText("Use an http or https URL.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save MCP server" })).toBeDisabled();
  });
});
