// @vitest-environment jsdom
import {
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

const target = (id: "codex" | "opencode", name: string): TargetInfo => ({
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
      total: 1
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
  it("loads, searches, copies, and continues a full conversation", async () => {
    const api = installApi();
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);

    expect(await screen.findByText("Please repair the release workflow."))
      .toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), {
      target: { value: "release" }
    });
    await waitFor(() => expect(api.listConversations).toHaveBeenLastCalledWith({
      query: "release",
      limit: 200
    }));

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(
      expect.stringContaining("I found the failing step.")
    ));

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Codex")).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "OpenCode" }));

    await waitFor(() => expect(api.continueConversation).toHaveBeenCalledWith("preview-1"));
    expect(await screen.findByText("Started a new conversation in OpenCode"))
      .toBeInTheDocument();
  });

  it("requires confirmation for a warned continuation and dismisses with Escape", async () => {
    const api = installApi({
      warnings: ["Sensitive-looking values will be redacted before transfer"],
      sensitiveValuesRedacted: true,
      requiresReview: true
    });
    render(<ConversationWorkspace targets={[
      target("codex", "Codex"),
      target("opencode", "OpenCode")
    ]} />);
    await screen.findByText("Please repair the release workflow.");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", {
      name: "OpenCode"
    }));

    const dialog = await screen.findByRole("dialog", { name: "Review continuation" });
    expect(within(dialog).getByText(
      "Sensitive-looking values will be redacted before transfer"
    )).toBeInTheDocument();
    expect(api.continueConversation).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Review continuation" })).toBeNull()
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

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Second indexed conversation")).toBeInTheDocument();
    expect(api.listConversations).toHaveBeenCalledWith({
      offset: 1,
      limit: 200
    });
  });
});
