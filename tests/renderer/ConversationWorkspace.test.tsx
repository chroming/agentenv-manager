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
import {
  ConversationWorkspace,
  invalidateConversationListPrefetch,
  preloadConversationList
} from "../../src/renderer/components/ConversationWorkspace";
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
  executableCandidates: [id],
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
    executableCandidates: [id],
    executableStatus: "found",
    executableCandidate: id,
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
  sizeBytes: 24_576,
  detailState: "full",
  messages: [
    { id: "u1", role: "user", text: "Please repair the release workflow." },
    { id: "a1", role: "assistant", text: "I found the failing step." }
  ]
};
const { messages: _detailMessages, ...conversationSummary } = detail;

const installApi = (
  preview: Partial<ConversationContinuationPreview> = {}
) => {
  const api = {
    listConversations: vi.fn().mockResolvedValue({
      items: [{ ...detail, messages: undefined }],
      total: 1,
      totalSizeBytes: 24_576,
      workspacePaths: ["/work/project"],
      agentCounts: { codex: 1, opencode: 2 },
      lastRefreshedAt: new Date().toISOString()
    }),
    readConversation: vi.fn().mockResolvedValue(detail),
    refreshConversations: vi.fn().mockResolvedValue({
      indexed: 1,
      unchanged: 0,
      removed: 0,
      failures: [],
      refreshedAt: new Date().toISOString()
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
    listProjects: vi.fn().mockResolvedValue([]),
    findProjectByPath: vi.fn().mockResolvedValue(undefined),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn().mockResolvedValue(undefined)
  };
  Object.defineProperty(window, "agentEnv", {
    configurable: true,
    value: api as unknown as AgentEnvApi
  });
  return api;
};

const chooseConversationSort = (
  label: "Recent" | "Best match" | "Last activity" | "Largest" | "Most messages"
) => {
  fireEvent.click(screen.getByRole("button", { name: /Sort conversations:/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: label }));
};

const openConversationFilters = () => {
  fireEvent.click(screen.getByRole("button", { name: /Filter conversations/ }));
};

afterEach(() => {
  invalidateConversationListPrefetch();
  cleanup();
  vi.restoreAllMocks();
});

describe("ConversationWorkspace", () => {
  it("shows the latest reply date and time for every history row", async () => {
    installApi();
    render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);

    const time = await screen.findByLabelText(/Last reply/);
    expect(time).toHaveAttribute("datetime", detail.updatedAt);
    expect(time.textContent).toContain("·");
    expect(time).toHaveAttribute("title", expect.stringMatching(/^Last reply /));
  });

  it("groups known Projects in the folder filter and opens a matching Project", async () => {
    const api = installApi();
    const project = {
      id: "project-work",
      name: "Release Tools",
      rootPath: "/work/project",
      createdAt: "2026-08-06T00:00:00.000Z",
      exists: true
    };
    api.listProjects.mockResolvedValue([project]);
    api.findProjectByPath.mockResolvedValue(project);
    const onOpenProject = vi.fn();

    render(
      <ConversationWorkspace
        targets={[target("codex", "Codex")]}
        onOpenProject={onOpenProject}
      />
    );

    await screen.findByText("I found the failing step.");
    openConversationFilters();
    const workspaceFilter = screen.getByRole("combobox", { name: "Filter by workspace" });
    expect(within(workspaceFilter).getByRole("group", { name: "Workspaces" }))
      .toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Open Workspace" }));
    expect(onOpenProject).toHaveBeenCalledWith(project);
  });

  it("keeps detail commands in one default-density action group", async () => {
    const api = installApi();
    api.listProjects.mockResolvedValue([{
      id: "project-work",
      name: "Release Tools",
      rootPath: "/work/project",
      createdAt: "2026-08-06T00:00:00.000Z",
      exists: true
    }]);
    api.findProjectByPath.mockResolvedValue({
      id: "project-work",
      name: "Release Tools",
      rootPath: "/work/project",
      createdAt: "2026-08-06T00:00:00.000Z",
      exists: true
    });

    render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);

    const workspace = await screen.findByRole("button", { name: "Open Workspace" });
    const actions = workspace.closest("[data-control-density]");
    expect(actions).toHaveAttribute("data-control-density", "default");
    expect(workspace).toHaveClass("ui-button--default", "ui-button--secondary");
    expect(within(actions as HTMLElement).getByRole("button", { name: "Continue" }))
      .toHaveClass("ui-button--default", "ui-button--primary");
    expect(within(actions as HTMLElement).getByRole("button", { name: "Copy conversation" }))
      .toHaveClass("ui-icon-button--default", "ui-icon-button--ghost");
  });

  it("groups a canonical Project match even when the conversation uses a path alias", async () => {
    const api = installApi();
    const project = {
      id: "project-work",
      name: "Work Project",
      rootPath: "/canonical/work/project",
      createdAt: "2026-08-06T00:00:00.000Z",
      exists: true
    };
    api.listProjects.mockResolvedValue([project]);
    api.findProjectByPath.mockImplementation(async (path: string) =>
      path === "/work/project" ? project : undefined
    );

    render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);

    openConversationFilters();
    const workspaceFilter = await screen.findByRole("combobox", { name: "Filter by workspace" });
    await waitFor(() => expect(
      within(workspaceFilter).getByRole("group", { name: "Workspaces" })
    ).toBeInTheDocument());
    expect(within(workspaceFilter).getByRole("option", { name: "Work Project" }))
      .toHaveValue("/work/project");
  });

  it("opens an ordinary conversation at its latest message", async () => {
    installApi();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.classList.contains("conversation-transcript") ? 840 : 0;
      }
    });
    try {
      render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);
      await screen.findByText("I found the failing step.");
      const transcript = document.querySelector<HTMLElement>(".conversation-transcript");
      expect(transcript).not.toBeNull();
      await waitFor(() => expect(transcript!.scrollTop).toBe(840));
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", descriptor);
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
      }
    }
  });

  it("reuses the startup index prefetch instead of issuing a second initial list request", async () => {
    const api = installApi();
    let resolveList!: (value: Awaited<ReturnType<AgentEnvApi["listConversations"]>>) => void;
    api.listConversations.mockReturnValue(new Promise((resolve) => {
      resolveList = resolve;
    }));

    void preloadConversationList();
    render(
      <ConversationWorkspace
        targets={[target("codex", "Codex"), target("opencode", "OpenCode")]}
      />
    );

    expect(api.listConversations).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading conversations")).toBeInTheDocument();

    await act(async () => {
      resolveList({
        items: [conversationSummary],
        total: 1,
        workspacePaths: ["/work/project"],
        agentCounts: { codex: 1 },
        lastRefreshedAt: new Date().toISOString()
      });
    });

    expect(await screen.findAllByText("Repair release workflow")).toHaveLength(2);
    expect(api.listConversations).toHaveBeenCalledTimes(1);
  });

  it("shows the indexed transcript size without crowding the conversation title", async () => {
    installApi();
    render(
      <ConversationWorkspace
        targets={[target("codex", "Codex"), target("opencode", "OpenCode")]}
      />
    );

    const option = await screen.findByRole("option", {
      name: /Repair release workflow/
    });
    expect(option).toHaveTextContent("24 KB");
    expect(within(option).getByText("Repair release workflow"))
      .toHaveClass("conversation-list-item__title");
    expect(document.querySelector(".conversation-list-meta"))
      .toHaveTextContent("Total 24 KB");
  });

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
    chooseConversationSort("Largest");
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Sort conversations: Largest"
    })).toHaveAttribute("aria-pressed", "true"));
    first.unmount();

    expect(savedState).toEqual(expect.objectContaining({
      query: "release",
      sort: "size-desc",
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
    expect(screen.getByRole("button", { name: "Sort conversations: Largest" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Please repair the release workflow.")).toBeInTheDocument();
    expect(api.listConversations).toHaveBeenCalled();
  });

  it("keeps the next typed search active after focusing the same Quick Open query", async () => {
    const api = installApi();
    const summary = { ...detail, messages: undefined };
    render(
      <ConversationWorkspace
        targets={[target("codex", "Codex")]}
        initialViewState={{
          items: [summary],
          total: 1,
          query: "release",
          agentFilter: "",
          workspaceFilter: "",
          workspacePaths: ["/work/project"],
          agentCounts: { codex: 1 },
          selectedId: detail.id,
          detail,
          scrollTop: 0
        }}
        openRequest={{
          requestId: 1,
          query: "release",
          summary
        }}
      />
    );
    await screen.findByText("Please repair the release workflow.");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), {
      target: { value: "next query" }
    });

    await waitFor(() => expect(api.listConversations).toHaveBeenLastCalledWith({
      query: "next query",
      limit: 200
    }));
  });

  it("refocuses the matching message when Quick Open selects the current conversation", async () => {
    const api = installApi();
    const summary = { ...detail, messages: undefined };
    const initialViewState = {
      items: [summary],
      total: 1,
      query: "",
      agentFilter: "",
      workspaceFilter: "",
      workspacePaths: ["/work/project"],
      agentCounts: { codex: 1 },
      selectedId: detail.id,
      detail,
      scrollTop: 0
    };
    const { rerender } = render(
      <ConversationWorkspace
        targets={[target("codex", "Codex")]}
        initialViewState={initialViewState}
      />
    );
    await waitFor(() => expect(api.readConversation).toHaveBeenCalled());
    api.readConversation.mockClear();
    api.readConversation.mockResolvedValue({
      ...detail,
      matchedMessageId: "a1"
    });

    rerender(
      <ConversationWorkspace
        targets={[target("codex", "Codex")]}
        initialViewState={initialViewState}
        openRequest={{
          requestId: 1,
          query: "failing step",
          summary
        }}
      />
    );

    await waitFor(() => expect(api.readConversation).toHaveBeenLastCalledWith(detail.id, {
      limit: 60,
      tail: true,
      query: "failing step"
    }));
    expect(await screen.findByTestId("conversation-message-a1"))
      .toHaveClass("is-search-match");
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
    expect(within(menu).getByRole("menuitem", {
      name: "Codex, Open original"
    })).toBeInTheDocument();
    expect(within(menu).getByText("Continue automatically")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^OpenCode/ }));

    await waitFor(() => expect(api.continueConversation).toHaveBeenCalledWith("preview-1"));
    expect(await screen.findByText("Started a new conversation in OpenCode"))
      .toBeInTheDocument();
  });

  it("opens a search result around its matching message and highlights it", async () => {
    const api = installApi();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    try {
      render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);
      await screen.findByText("Please repair the release workflow.");
      api.readConversation.mockResolvedValue({
        ...detail,
        matchedMessageId: "a1"
      });

      fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), {
        target: { value: "failing step" }
      });
      await waitFor(() => expect(api.listConversations).toHaveBeenLastCalledWith({
        query: "failing step",
        limit: 200
      }));
      fireEvent.click(screen.getByRole("option", { name: /Repair release workflow/ }));

      await waitFor(() => expect(api.readConversation).toHaveBeenLastCalledWith(detail.id, {
        limit: 60,
        tail: true,
        query: "failing step"
      }));
      const match = await screen.findByTestId("conversation-message-a1");
      expect(match).toHaveClass("is-search-match");
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center"
      }));
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView
        });
      } else {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    }
  });

  it("opens the original native conversation from Continue without creating a handoff", async () => {
    const api = installApi();
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    await screen.findByText("Please repair the release workflow.");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const menu = await screen.findByRole("menu", { name: "Continue in" });
    const original = within(menu).getByRole("menuitem", {
      name: "Codex, Open original"
    });
    expect(original.getAttribute("title")).toContain(
      "Resume the original conversation in this Agent."
    );
    fireEvent.click(original);

    await waitFor(() =>
      expect(api.openOriginalConversation).toHaveBeenCalledWith(detail.id)
    );
    expect(api.previewConversationContinuation).not.toHaveBeenCalled();
    expect(api.continueConversation).not.toHaveBeenCalled();
    expect(await screen.findByText("Opened in Codex")).toBeInTheDocument();
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

  it("keeps cached conversations interactive during an automatic stale-index refresh", async () => {
    const api = installApi();
    let finishRefresh!: () => void;
    api.listConversations.mockResolvedValue({
      items: [{ ...detail, messages: undefined }],
      total: 1,
      lastRefreshedAt: "2026-07-29T08:00:00.000Z"
    });
    api.refreshConversations.mockReturnValue(new Promise((resolve) => {
      finishRefresh = () => resolve({
        indexed: 0,
        unchanged: 1,
        removed: 0,
        failures: [],
        refreshedAt: "2026-07-29T10:00:00.000Z"
      });
    }));

    const { container } = render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);

    expect(await screen.findByText("Repair release workflow")).toBeInTheDocument();
    await waitFor(() => expect(api.refreshConversations).toHaveBeenCalledTimes(1));
    expect(container.querySelector(".conversation-layout")).not.toHaveAttribute("inert");
    expect(screen.getByRole("searchbox", { name: "Search conversations" })).toBeEnabled();
    expect(screen.queryByText("Refreshing conversations")).toBeNull();
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(refresh.querySelector(".is-spinning")).not.toBeNull();

    await act(async () => finishRefresh());
    await waitFor(() => expect(refresh).toHaveAttribute("aria-busy", "false"));
  });

  it("refreshes on focus only after the indexed history becomes stale", async () => {
    let now = Date.parse("2026-07-29T10:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const api = installApi();
    api.listConversations.mockResolvedValue({
      items: [{ ...detail, messages: undefined }],
      total: 1,
      lastRefreshedAt: new Date(now).toISOString()
    });
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    await screen.findByText("Repair release workflow");

    window.dispatchEvent(new Event("focus"));
    await act(async () => Promise.resolve());
    expect(api.refreshConversations).not.toHaveBeenCalled();

    now += 60_001;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(api.refreshConversations).toHaveBeenCalledTimes(1));
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
      name: "OpenCode, Paste prompt"
    });
    expect(destination.getAttribute("title"))
      .toContain("Paste the short handoff prompt into the new conversation.");
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

  it("keeps cached history interactive while manual Refresh stays on its control", async () => {
    let finishRefresh: (() => void) | undefined;
    const api = installApi();
    api.refreshConversations.mockImplementation(() => new Promise((resolve) => {
      finishRefresh = () => resolve({
        indexed: 1,
        unchanged: 0,
        removed: 0,
        failures: [],
        refreshedAt: new Date().toISOString()
      });
    }));
    const { container } = render(<ConversationWorkspace targets={[]} />);
    await screen.findByText("Repair release workflow");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(refresh.querySelector(".is-spinning")).not.toBeNull();
    expect(screen.queryByText("Refreshing conversations")).toBeNull();
    expect(
      container.querySelector(".conversation-list-item__agent img")
    ).not.toBeNull();
    expect(container.querySelector(".conversation-layout")).not.toHaveAttribute("inert");
    expect(screen.getByRole("searchbox", { name: "Search conversations" })).toBeEnabled();
    finishRefresh?.();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await waitFor(() =>
      expect(refresh).toHaveAttribute("aria-busy", "false")
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
    openConversationFilters();
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

  it("sorts the complete indexed result and removes misleading date groups", async () => {
    const api = installApi();
    api.listConversations.mockImplementation(async (input?: { sort?: string }) => ({
      items: input?.sort === "size-desc"
        ? [{ ...conversationSummary, id: "codex:large", title: "Large conversation" }]
        : input?.sort === "messages-desc"
          ? [{ ...conversationSummary, id: "codex:long", title: "Long conversation" }]
          : input?.sort === "last-active-desc"
            ? [{ ...conversationSummary, id: "codex:latest", title: "Latest conversation" }]
          : [conversationSummary],
      total: 1,
      workspacePaths: ["/work/project"],
      agentCounts: { codex: 1 },
      lastRefreshedAt: new Date().toISOString()
    }));

    render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);
    await screen.findByText("Repair release workflow");
    expect(screen.getByText("Earlier")).toBeInTheDocument();

    chooseConversationSort("Largest");
    expect(await screen.findByText("Large conversation")).toBeInTheDocument();
    expect(api.listConversations).toHaveBeenLastCalledWith({
      sort: "size-desc",
      limit: 200
    });
    expect(screen.queryByText("Earlier")).toBeNull();

    chooseConversationSort("Most messages");
    expect(await screen.findByText("Long conversation")).toBeInTheDocument();
    expect(api.listConversations).toHaveBeenLastCalledWith({
      sort: "messages-desc",
      limit: 200
    });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), {
      target: { value: "release" }
    });
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Sort conversations: Most messages"
    })).toBeInTheDocument());
    chooseConversationSort("Last activity");
    expect(await screen.findByText("Latest conversation")).toBeInTheDocument();
    expect(api.listConversations).toHaveBeenLastCalledWith({
      query: "release",
      sort: "last-active-desc",
      limit: 200
    });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), {
      target: { value: "release workflow" }
    });
    await waitFor(() => expect(api.listConversations).toHaveBeenLastCalledWith({
      query: "release workflow",
      sort: "last-active-desc",
      limit: 200
    }));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), {
      target: { value: "" }
    });
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Sort conversations: Recent"
    })).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(api.listConversations).toHaveBeenLastCalledWith({ limit: 200 }));
  });

  it("uses one compact sort menu beside search and restores focus on Escape", async () => {
    installApi();
    render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);
    await screen.findByText("Repair release workflow");

    const trigger = screen.getByRole("button", { name: "Sort conversations: Recent" });
    expect(trigger).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "Recent" }))
      .toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Largest" }))
      .toHaveAttribute("aria-checked", "false");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Sort conversations" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("opens a row context menu and reuses the original Agent action", async () => {
    const api = installApi();
    render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);

    const row = await screen.findByRole("option", { name: /Repair release workflow/ });
    fireEvent.contextMenu(row, { clientX: 240, clientY: 180 });

    const menu = await screen.findByRole("menu", { name: "Conversation actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open in Codex" }));
    await waitFor(() => expect(api.openOriginalConversation).toHaveBeenCalledWith(detail.id));
    expect(await screen.findByText("Opened in Codex")).toBeInTheDocument();
  });

  it("opens the row context menu from the keyboard and restores focus on Escape", async () => {
    installApi();
    render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);

    const row = await screen.findByRole("option", { name: /Repair release workflow/ });
    row.focus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menu", { name: "Conversation actions" }))
      .toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Conversation actions" })).toBeNull();
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("shows message count and source size in the conversation detail summary", async () => {
    installApi();
    render(<ConversationWorkspace targets={[target("codex", "Codex")]} />);

    await screen.findByText("I found the failing step.");
    expect(screen.getByText("2 messages")).toBeInTheDocument();
    expect(screen.getAllByText("24 KB").length).toBeGreaterThan(0);
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
    fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
    const menu = await screen.findByRole("menu", { name: "Continue in" });
    expect(within(menu).getByRole("menuitem", {
      name: "OpenCode, Open original"
    })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", {
      name: /Codex/
    })).toBeNull();
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

    expect(await screen.findByText("Latest answer", {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.queryByText("First question")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));

    expect(await screen.findByText("First question", {}, { timeout: 5_000 })).toBeInTheDocument();
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
