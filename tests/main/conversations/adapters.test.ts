import { describe, expect, it } from "vitest";
import { parseClaudeConversation } from "../../../src/main/targets/conversations/claudeConversations";
import { parseCodexConversation } from "../../../src/main/targets/conversations/codexConversations";
import { parseOpenCodeExportMessages } from "../../../src/main/targets/conversations/opencodeConversations";
import type { AgentConversationCandidate } from "../../../src/main/targets/types";

const candidate = (overrides: Partial<AgentConversationCandidate> = {}): AgentConversationCandidate => ({
  sourceId: "source-session",
  sourceVersion: "42:1",
  sourceLocator: "/tmp/read-only-history.jsonl",
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
      id: "codex:codex-session",
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
      id: "claude-code:claude-session",
      title: "Repair the release workflow",
      workspacePath: "/work/claude",
      messageCount: 2
    });
    expect(detail.messages.map((message) => message.text)).toEqual([
      "Please repair it",
      "The workflow is repaired."
    ]);
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
