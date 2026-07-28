// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationWorkspace } from "../../src/renderer/components/ConversationWorkspace";
import type {
  AgentEnvApi,
  ConversationContinuationPreview,
  ConversationDetail,
  TargetInfo
} from "../../src/shared/types";

const target = (
  id: "codex" | "opencode",
  name: string,
  continueState: TargetInfo["conversationCapabilities"]["continue"]["state"] = "available"
): TargetInfo => ({
  id,
  name,
  description: name,
  iconKey: id,
  displayOrder: id === "codex" ? 1 : 2,
  instructionsLabel: "AGENTS.md",
  configLabel: "config",
  configLanguage: "text",
  realWritesEnabled: true,
  executableName: id,
  capabilities: {
    instructions: true,
    skills: true,
    mcpTransports: [],
    disabledSkillPaths: false
  },
  paths: {
    targetId: id,
    configDir: `/tmp/${id}`,
    instructionsPath: `/tmp/${id}/AGENTS.md`,
    configPath: `/tmp/${id}/config`
  },
  health: {
    status: "ready",
    installationFound: true,
    installationEvidence: [
      { kind: "command", label: name, path: `/usr/local/bin/${id}` }
    ],
    executableName: id,
    executablePath: `/usr/local/bin/${id}`,
    executableFound: true,
    canWrite: true,
    summary: "Ready",
    checks: []
  },
  conversationCapabilities: {
    history: { state: "available", evidence: ["test"] },
    openOriginal: { state: "available", evidence: ["test"] },
    continue: {
      state: continueState,
      evidence: ["test"],
      delivery: continueState === "degraded" ? "clipboard" : "context-file"
    }
  }
});

const detail: ConversationDetail = {
  id: "codex:session-1",
  agentId: "codex",
  agentName: "Codex",
  sourceId: "session-1",
  title: "Repair release workflow",
  snippet: "Investigate the release failure",
  workspacePath: "/work/project",
  createdAt: "2026-07-24T05:00:00.000Z",
  updatedAt: "2026-07-24T06:00:00.000Z",
  messageCount: 2,
  detailState: "full",
  messages: [
    { id: "u1", role: "user", text: "Please repair the release workflow." },
    { id: "a1", role: "assistant", text: "I found the failing step." }
  ]
};

const installApi = (
  preview: Partial<ConversationContinuationPreview> = {}
) => {
  const api = {
    listConversations: vi.fn().mockResolvedValue({
      items: [{ ...detail, messages: undefined }],
      total: 1,
      workspacePaths: ["/work/project"],
      agentCounts: { codex: 1, opencode: 2 }
    }),
    readConversation: vi.fn().mockResolvedValue(detail),
    refreshConversations: vi.fn().mockResolvedValue({
      indexed: 1,
      unchanged: 0,
      removed: 0,
      failures: []
    }),
    openOriginalConversation: vi.fn().mockResolvedValue({
      mode: "native",
      message: "Opened in Codex"
    }),
    previewConversationContinuation: vi.fn().mockResolvedValue({
      previewId: "preview-1",
      conversationId: detail.id,
      targetId: "opencode",
      targetName: "OpenCode",
      mode: "context-file",
      portableMessageCount: 2,
      totalMessageCount: 2,
      omittedMessageCount: 0,
      sensitiveValuesRedacted: false,
      warnings: [],
      requiresReview: false,
      ...preview
    }),
    continueConversation: vi.fn().mockResolvedValue({
      mode: "context-file",
      message: "Started a new conversation in OpenCode"
    }),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn().mockResolvedValue(undefined)
  };
  Object.defineProperty(window, "agentEnv", {
    configurable: true,
    value: api as unknown as AgentEnvApi
  });
  return api;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConversationWorkspace", () => {
  it("restores its local view context after the workspace is remounted", async () => {
    const api = installApi();
    let savedState: Parameters<
      NonNullable<React.ComponentProps<typeof ConversationWorkspace>["onViewStateChange"]>
    >[0] | undefined;
    const first = render(
      <ConversationWorkspace
        targets={[target("codex", "Codex"), target("opencode", "OpenCode")]}
        onViewStateChange={(state) => {
          savedState = state;
        }}
      />
    );
    expect(await screen.findByText("Please repair the release workflow."))
      .toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), {
      target: { value: "release" }
    });
    await waitFor(() => expect(screen.getByRole("searchbox", {
      name: "Search conversations"
    })).toHaveValue("release"));
    first.unmount();

    expect(savedState).toEqual(expect.objectContaining({
      query: "release",
      selectedId: detail.id,
      detail: expect.objectContaining({ id: detail.id })
    }));

    render(
      <ConversationWorkspace
        targets={[target("codex", "Codex"), target("opencode", "OpenCode")]}
        initialViewState={savedState}
      />
    );
    expect(screen.getByRole("searchbox", { name: "Search conversations" }))
      .toHaveValue("release");
    expect(screen.getByText("Please repair the release workflow.")).toBeInTheDocument();
    expect(api.listConversations).toHaveBeenCalled();
  });

  it("loads, searches, copies, and continues a full conversation", async () => {
    const api = installApi();
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);

    expect(await screen.findByText("Please repair the release workflow."))
      .toBeInTheDocument();
    expect(api.refreshConversations).not.toHaveBeenCalled();
    expect(api.readConversation).toHaveBeenCalledWith(detail.id, {
      limit: 60,
      tail: true
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), {
      target: { value: "release" }
    });
    expect(screen.getByRole("searchbox", { name: "Search conversations" }))
      .toHaveAttribute(
        "title",
        "Searches all indexed conversations and message text."
      );
    await waitFor(() => expect(api.listConversations).toHaveBeenLastCalledWith({
      query: "release",
      limit: 200
    }));

    fireEvent.click(screen.getByRole("button", { name: "Copy conversation" }));
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(
      expect.stringContaining("I found the failing step.")
    ));

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Codex")).toBeNull();
    expect(within(menu).getByText("Continue automatically")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^OpenCode/ }));

    await waitFor(() => expect(api.continueConversation).toHaveBeenCalledWith("preview-1"));
    expect(await screen.findByText("Started a new conversation in OpenCode"))
      .toBeInTheDocument();
  });

  it("refreshes an old populated index once without surfacing a stale-detail error", async () => {
    const api = installApi();
    const stale = {
      ...detail,
      id: "codex:stale",
      sourceId: "stale",
      title: "Cached before adapter upgrade",
      messages: undefined
    };
    const current = {
      ...detail,
      id: "codex:current",
      sourceId: "current",
      title: "Current indexed conversation",
      messages: undefined
    };
    api.listConversations
      .mockResolvedValueOnce({
        items: [stale],
        total: 1,
        refreshRequired: true
      })
      .mockResolvedValue({
        items: [current],
        total: 1,
        refreshRequired: false
      });
    api.readConversation.mockImplementation(async (id: string) => {
      if (id === stale.id) {
        throw new Error("Conversation is no longer available in the local index");
      }
      return { ...detail, ...current, messages: detail.messages };
    });

    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);

    expect(await screen.findByText("Current indexed conversation")).toBeInTheDocument();
    expect(await screen.findByText("Please repair the release workflow."))
      .toBeInTheDocument();
    await waitFor(() => expect(api.refreshConversations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listConversations).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Conversation is no longer available in the local index"))
      .toBeNull();
  });

  it("requires confirmation for a warned continuation and dismisses with Escape", async () => {
    const api = installApi({
      warnings: ["Sensitive-looking values will be redacted before transfer"],
      sensitiveValuesRedacted: true,
      workspacePath: "/work/project",
      workspacePreservation: "preserved",
      requiresReview: true
    });
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    await screen.findByText("Please repair the release workflow.");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", {
      name: /^OpenCode/
    }));

    const dialog = await screen.findByRole("dialog", { name: "Review continuation" });
    expect(within(dialog).getByText(
      "Sensitive-looking values will be redacted before transfer"
    )).toBeInTheDocument();
    expect(within(dialog).getByText("Context file")).toBeInTheDocument();
    expect(within(dialog).getByText("Working directory")).toBeInTheDocument();
    expect(within(dialog).getByText("/work/project")).toBeInTheDocument();
    expect(within(dialog).getByText("Preserved")).toBeInTheDocument();
    expect(within(dialog).getByText("2 of 2 messages")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Open OpenCode" })).toBeEnabled();
    expect(api.continueConversation).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Review continuation" })).toBeNull()
    );
  });

  it("explains clipboard fallback before choosing a degraded Agent", async () => {
    installApi();
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode", "degraded")
    ]} />);
    await screen.findByText("Please repair the release workflow.");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const menu = await screen.findByRole("menu", { name: "Continue in" });
    const destination = within(menu).getByRole("menuitem", {
      name: "OpenCode, Copy and paste"
    });
    expect(destination.getAttribute("title"))
      .toContain("Paste it into the new conversation.");
  });

  it("keeps progress on the selected destination while continuation is prepared", async () => {
    const api = installApi();
    let resolvePreview!: (preview: ConversationContinuationPreview) => void;
    api.previewConversationContinuation.mockReturnValue(new Promise((resolve) => {
      resolvePreview = resolve;
    }));
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    await screen.findByText("Please repair the release workflow.");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const menu = await screen.findByRole("menu", { name: "Continue in" });
    fireEvent.click(within(menu).getByRole("menuitem", {
      name: "OpenCode, Continue automatically"
    }));

    await waitFor(() => expect(menu).toHaveAttribute("aria-busy", "true"));
    expect(menu.querySelector(".is-spinning")).not.toBeNull();
    expect(within(menu).getByRole("menuitem", {
      name: "OpenCode, Continue automatically"
    })).toBeDisabled();

    await act(async () => resolvePreview({
      previewId: "preview-delayed",
      conversationId: detail.id,
      targetId: "opencode",
      targetName: "OpenCode",
      mode: "context-file",
      portableMessageCount: 2,
      totalMessageCount: 2,
      omittedMessageCount: 0,
      sensitiveValuesRedacted: false,
      warnings: [],
      requiresReview: false
    }));
    await waitFor(() =>
      expect(api.continueConversation).toHaveBeenCalledWith("preview-delayed")
    );
  });

  it("keeps histories beyond the first page reachable", async () => {
    const api = installApi();
    api.listConversations.mockImplementation(async (input?: { offset?: number }) => ({
      items: input?.offset
        ? [{
            ...detail,
            id: "codex:session-2",
            sourceId: "session-2",
            title: "Second indexed conversation",
            messages: undefined
          }]
        : [{ ...detail, messages: undefined }],
      total: 2
    }));
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    await screen.findByText("Repair release workflow");
    expect(screen.getByText("1 of 2 conversations")).toBeInTheDocument();

    const list = screen.getByRole("listbox");
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, value: 0, writable: true }
    });
    fireEvent.scroll(list);
    expect(screen.queryByRole("button", { name: "Load 1 more" })).toBeNull();

    list.scrollTop = 400;
    fireEvent.scroll(list);
    fireEvent.click(screen.getByRole("button", { name: "Load 1 more" }));

    expect(await screen.findByText("Second indexed conversation")).toBeInTheDocument();
    expect(screen.getByText("2 conversations")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load 1 more" })).toBeNull();
    expect(api.listConversations).toHaveBeenCalledWith({
      offset: 1,
      limit: 200
    });
  });

  it("keeps list selection keyboard accessible", async () => {
    const api = installApi();
    api.listConversations.mockResolvedValue({
      items: [
        { ...detail, messages: undefined },
        {
          ...detail,
          id: "codex:session-2",
          sourceId: "session-2",
          title: "Second indexed conversation",
          messages: undefined
        }
      ],
      total: 2
    });
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    const first = await screen.findByRole("option", { name: /Repair release workflow/ });
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowDown" });

    const second = screen.getByRole("option", { name: /Second indexed conversation/ });
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveFocus();
  });

  it("shows progress only on the action that is running", async () => {
    let finishCopy: (() => void) | undefined;
    const api = installApi();
    api.copyText.mockImplementation(() => new Promise<void>((resolve) => {
      finishCopy = resolve;
    }));
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    await screen.findByText("Please repair the release workflow.");

    const copy = screen.getByRole("button", { name: "Copy conversation" });
    const refresh = screen.getByRole("button", { name: "Refresh" });
    fireEvent.click(copy);

    expect(copy.querySelector(".is-spinning")).not.toBeNull();
    expect(refresh.querySelector(".is-spinning")).toBeNull();
    finishCopy?.();
    await waitFor(() => expect(copy.querySelector(".is-spinning")).toBeNull());
    expect(await screen.findByText("Conversation copied")).toBeInTheDocument();
  });

  it("keeps cached history visible behind an honest refresh overlay", async () => {
    let finishRefresh: (() => void) | undefined;
    const api = installApi();
    api.refreshConversations.mockImplementation(() => new Promise((resolve) => {
      finishRefresh = () => resolve({
        indexed: 1,
        unchanged: 0,
        removed: 0,
        failures: []
      });
    }));
    const { container } = render(<ConversationWorkspace targets={[]} />);
    await screen.findByText("Repair release workflow");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Refreshing conversations")).toBeInTheDocument();
    expect(
      container.querySelector(".conversation-list-item__agent img")
    ).not.toBeNull();
    expect(container.querySelector(".conversation-layout")).toHaveAttribute("inert");
    finishRefresh?.();
    await waitFor(() =>
      expect(screen.queryByText("Refreshing conversations")).toBeNull()
    );
  });

  it("does not let an older search response replace a newer query", async () => {
    const api = installApi();
    type ListResult = Awaited<ReturnType<AgentEnvApi["listConversations"]>>;
    let finishSlow: ((result: ListResult) => void) | undefined;
    let finishLatest: ((result: ListResult) => void) | undefined;
    api.listConversations.mockImplementation(async (input?: { query?: string }) => {
      if (input?.query === "slow") {
        return new Promise<ListResult>((resolve) => {
          finishSlow = resolve;
        });
      }
      if (input?.query === "latest") {
        return new Promise<ListResult>((resolve) => {
          finishLatest = resolve;
        });
      }
      return {
        items: [{ ...detail, messages: undefined }],
        total: 1
      };
    });
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    await screen.findByText("Please repair the release workflow.");
    const search = screen.getByRole("searchbox", { name: "Search conversations" });

    fireEvent.change(search, { target: { value: "slow" } });
    await waitFor(() => expect(finishSlow).toBeTypeOf("function"));
    fireEvent.change(search, { target: { value: "latest" } });
    await act(async () => finishSlow?.({
      items: [{
        ...detail,
        id: "codex:slow",
        sourceId: "slow",
        title: "Stale search result"
      }],
      total: 1
    }));
    expect(screen.queryByText("Stale search result")).toBeNull();
    await waitFor(() => expect(finishLatest).toBeTypeOf("function"));

    await act(async () => finishLatest?.({
      items: [{
        ...detail,
        id: "codex:latest",
        sourceId: "latest",
        title: "Latest search result"
      }],
      total: 1
    }));
    expect(await screen.findByText("Latest search result")).toBeInTheDocument();
    expect(screen.getByText("Latest search result")).toBeInTheDocument();
  });

  it("filters by Agent and workspace without losing the latest selection", async () => {
    const api = installApi();
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    await screen.findByText("Repair release workflow");
    expect(screen.getByRole("option", { name: "Codex (1)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OpenCode (2)" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter by Agent" }), {
      target: { value: "codex" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by workspace" }), {
      target: { value: "/work/project" }
    });

    await waitFor(() => expect(api.listConversations).toHaveBeenLastCalledWith({
      agentIds: ["codex"],
      workspacePaths: ["/work/project"],
      limit: 200
    }));
  });

  it("shows metadata-only history as an honest readable summary", async () => {
    const api = installApi();
    api.readConversation.mockResolvedValue({
      ...detail,
      agentId: "opencode",
      agentName: "OpenCode",
      title: "Review desktop shell",
      snippet: "The source exposes this useful conversation summary.",
      messageCount: 4,
      detailState: "summary-only",
      messages: []
    });
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);

    expect(await screen.findByText("Conversation summary")).toBeInTheDocument();
    expect(screen.getByText(
      "The source exposes this useful conversation summary."
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Continue/ })).toBeDisabled();
  });

  it("renders Markdown safely and groups consecutive messages by role", async () => {
    const api = installApi();
    api.readConversation.mockResolvedValue({
      ...detail,
      messageCount: 4,
      messages: [
        {
          id: "u1",
          role: "user",
          text: "Review this:\n\n- layout\n- keyboard"
        },
        {
          id: "a1",
          role: "assistant",
          text: "## Result\n\n```ts\nconst ready = true;\n```"
        },
        {
          id: "a2",
          role: "assistant",
          text: "See [the docs](https://example.com/docs)."
        },
        {
          id: "u2",
          role: "user",
          text: "Ship it."
        }
      ]
    });
    const { container } = render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);

    expect(await screen.findByRole("heading", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByText("layout")).toBeInTheDocument();
    expect(screen.getByText("const ready = true;")).toBeInTheDocument();
    expect(container.querySelectorAll(".conversation-turn")).toHaveLength(3);
    expect(container.querySelectorAll(".conversation-turn--assistant")).toHaveLength(1);

    fireEvent.click(screen.getByRole("link", { name: "the docs" }));
    await waitFor(() =>
      expect(api.openExternalUrl).toHaveBeenCalledWith("https://example.com/docs")
    );
  });

  it("loads long conversations from the tail and reveals earlier messages in pages", async () => {
    const api = installApi();
    api.readConversation.mockImplementation(async (
      _id: string,
      input?: { offset?: number; limit?: number; tail?: boolean }
    ) => input?.tail
      ? {
          ...detail,
          messageCount: 62,
          loadedMessageOffset: 2,
          messages: [
            { id: "u3", role: "user", text: "Latest question" },
            { id: "a3", role: "assistant", text: "Latest answer" }
          ]
        }
      : input
        ? {
          ...detail,
          messageCount: 62,
          loadedMessageOffset: 0,
          messages: [
            { id: "u1", role: "user", text: "First question" },
            { id: "a1", role: "assistant", text: "First answer" }
          ]
        }
        : {
          ...detail,
          messageCount: 62,
          messages: [
            { id: "all", role: "assistant", text: "Complete archived transcript" }
          ]
        });
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);

    expect(await screen.findByText("Latest answer")).toBeInTheDocument();
    expect(screen.queryByText("First question")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));

    expect(await screen.findByText("First question")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
    expect(api.readConversation).toHaveBeenLastCalledWith(detail.id, {
      offset: 0,
      limit: 2
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy conversation" }));
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(
      expect.stringContaining("Complete archived transcript")
    ));
    expect(api.readConversation).toHaveBeenLastCalledWith(detail.id);
  });
});
