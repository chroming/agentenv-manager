import { describe, expect, it } from "vitest";
import { parseClaudeConversation } from "../../../src/main/targets/conversations/claudeConversations";
import { parseCodexConversation } from "../../../src/main/targets/conversations/codexConversations";
import { parseOpenCodeExportMessages } from "../../../src/main/targets/conversations/opencodeConversations";
import type { AgentConversationCandidate } from "../../../src/main/targets/types";

const candidate = (overrides: Partial<AgentConversationCandidate> = {}): AgentConversationCandidate => ({
  recordId: "source-record",
  source: {
    version: "42:1",
    locator: "/tmp/read-only-history.jsonl"
  },
  providerSession: {
    kind: "native",
    id: "source-session",
    resumeLocator: "source-session"
  },
  updatedAt: "2026-07-24T06:00:00.000Z",
  detailState: "full",
  ...overrides
});

describe("conversation history adapters", () => {
  it("reads only visible Codex user and assistant messages", () => {
    const detail = parseCodexConversation(candidate(), [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "codex-session",
          cwd: "/work/project",
          timestamp: "2026-07-24T05:00:00.000Z"
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "user-1",
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Investigate the failing build" }]
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "assistant-1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I found the failing package." }]
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "tool-1",
          type: "function_call",
          role: "assistant",
          content: [{ type: "output_text", text: "must stay hidden" }]
        }
      })
    ].join("\n"));

    expect(detail).toMatchObject({
      id: "codex:source-record",
      sourceId: "codex-session",
      workspacePath: "/work/project",
      title: "Investigate the failing build",
      messageCount: 2
    });
    expect(detail.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Investigate the failing build" },
      { role: "assistant", text: "I found the failing package." }
    ]);
  });

  it("tolerates malformed Claude records and preserves summary metadata", () => {
    const detail = parseClaudeConversation(candidate(), [
      "{not-json",
      JSON.stringify({
        type: "summary",
        sessionId: "claude-session",
        cwd: "/work/claude",
        summary: "Repair the release workflow"
      }),
      JSON.stringify({
        type: "user",
        sessionId: "claude-session",
        uuid: "u1",
        timestamp: "2026-07-24T05:01:00.000Z",
        message: { content: "Please repair it" }
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "claude-session",
        uuid: "a1",
        message: {
          content: [
            { type: "thinking", text: "private reasoning" },
            { type: "text", text: "The workflow is repaired." }
          ]
        }
      })
    ].join("\n"));

    expect(detail).toMatchObject({
      id: "claude-code:source-record",
      sourceId: "claude-session",
      title: "Repair the release workflow",
      workspacePath: "/work/claude",
      messageCount: 2
    });
    expect(detail.messages.map((message) => message.text)).toEqual([
      "Please repair it",
      "The workflow is repaired."
    ]);
  });

  it("uses Claude's native generated and custom session titles", () => {
    const generated = parseClaudeConversation(candidate(), [
      JSON.stringify({
        type: "user",
        sessionId: "claude-session",
        uuid: "u1",
        message: { role: "user", content: "A long first prompt that is not the displayed title" }
      }),
      JSON.stringify({
        type: "ai-title",
        sessionId: "claude-session",
        aiTitle: "Review profile activation states"
      })
    ].join("\n"));
    const renamed = parseClaudeConversation(candidate(), [
      JSON.stringify({
        type: "ai-title",
        sessionId: "claude-session",
        aiTitle: "Generated title"
      }),
      JSON.stringify({
        type: "custom-title",
        sessionId: "claude-session",
        customTitle: "Release readiness review"
      }),
      JSON.stringify({
        type: "agent-name",
        sessionId: "claude-session",
        agentName: "Release readiness review"
      })
    ].join("\n"));

    expect(generated.title).toBe("Review profile activation states");
    expect(renamed.title).toBe("Release readiness review");
  });

  it("uses the assistant text when a history has no user message", () => {
    const detail = parseCodexConversation(candidate(), JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Recovered assistant summary" }]
      }
    }));

    expect(detail.title).toBe("Recovered assistant summary");
    expect(detail.snippet).toBe("Recovered assistant summary");
  });

  it("turns a polite fallback prompt into a compact task title", () => {
    const detail = parseCodexConversation(candidate(), JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: "Please help me review the conversation reader. Keep the source untouched."
        }]
      }
    }));

    expect(detail.title).toBe("Review the conversation reader");
  });

  it("does not use injected runtime context as the conversation identity", () => {
    const detail = parseCodexConversation(candidate({
      title: "<environment_context>temporary runtime metadata</environment_context>",
      snippet: "<recommended_plugins>temporary plugin metadata</recommended_plugins>"
    }), [
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "runtime-1",
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: "<environment_context>temporary runtime metadata</environment_context>"
          }]
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "user-1",
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Review the conversation interface" }]
        }
      })
    ].join("\n"));

    expect(detail.title).toBe("Review the conversation interface");
    expect(detail.snippet).toBe("Review the conversation interface");
    expect(detail.messages.map((message) => message.text)).toEqual([
      "Review the conversation interface"
    ]);
  });

  it("tolerates misspelled plugin envelopes and preserves a mixed user request", () => {
    const detail = parseCodexConversation(candidate({
      title: "<recommmanded_plugins>temporary plugin metadata</recommmanded_plugins>"
    }), [
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "runtime-1",
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: [
              "<environment_context>temporary runtime metadata</environment_context>",
              "Improve the conversation history title"
            ].join("\n")
          }]
        }
      })
    ].join("\n"));

    expect(detail.title).toBe("Improve the conversation history title");
    expect(detail.messages.map((message) => message.text)).toEqual([
      "Improve the conversation history title"
    ]);
  });

  it("removes dangling closing scaffolding tags without losing the user request", () => {
    const detail = parseCodexConversation(candidate(), [
      JSON.stringify({
        type: "event_msg",
        payload: { type: "token_count", info: { total_token_usage: 100_000 } }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "user-1",
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: "</image> Use the provided skill to review the interface"
          }]
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "assistant-1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I reviewed it." }]
        }
      }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "agent_reasoning", text: "must stay hidden" }
      })
    ].join("\n"));

    expect(detail.title).toBe("Use the provided skill to review the interface");
    expect(detail.snippet).toBe("Use the provided skill to review the interface");
    expect(detail.messageCount).toBe(2);
    expect(detail.messages.map((message) => message.text)).toEqual([
      "Use the provided skill to review the interface",
      "I reviewed it."
    ]);
  });

  it("extracts only visible OpenCode text parts", () => {
    expect(parseOpenCodeExportMessages({
      messages: [
        {
          info: {
            id: "u1",
            role: "user",
            time: { created: 1_753_337_000_000 }
          },
          parts: [
            { type: "text", text: "Continue this work" },
            { type: "tool", text: "hidden tool protocol" }
          ]
        },
        {
          info: { id: "a1", role: "assistant" },
          parts: [{ type: "text", text: "The work is ready." }]
        }
      ]
    }).map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Continue this work" },
      { role: "assistant", text: "The work is ready." }
    ]);
  });
});
