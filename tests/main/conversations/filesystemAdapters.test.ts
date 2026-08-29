import {
  mkdir,
  mkdtemp,
  rm,
  truncate,
  appendFile,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeConversationCapability } from "../../../src/main/targets/conversations/claudeConversations";
import { createCodexConversationCapability } from "../../../src/main/targets/conversations/codexConversations";
import { createOpenCodeConversationCapability } from "../../../src/main/targets/conversations/opencodeConversations";
import type { AgentConversationContext } from "../../../src/main/targets/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const contextFor = (configDir: string): AgentConversationContext => ({
  homeDir: dirnameForConfig(configDir),
  executablePath: "/usr/local/bin/claude",
  targetPaths: {
    targetId: "claude-code",
    configDir,
    instructionsPath: join(configDir, "CLAUDE.md"),
    configPath: join(configDir, "settings.json"),
    skillsDir: join(configDir, "skills")
  }
});

const dirnameForConfig = (configDir: string) => join(configDir, "..");

describe("filesystem conversation adapters", () => {
  it("uses private context files for best-effort continuation", () => {
    expect(createCodexConversationCapability().openContinuation).toBeTypeOf("function");
    expect(createClaudeConversationCapability().openContinuation).toBeTypeOf("function");
  });

  it("opens Claude interactively with the original conversation title", () => {
    const contextFilePath = "/tmp/agentenv/handoff.md";
    const launch = createClaudeConversationCapability().openContinuation?.({
      ...contextFor("/tmp/.claude"),
      conversation: {
        id: "codex:conversation",
        agentId: "codex",
        agentName: "Codex",
        sourceId: "conversation",
        title: "Continue the release",
        snippet: "Continue the release",
        workspacePath: "/work/project",
        createdAt: "2026-07-24T05:00:00.000Z",
        updatedAt: "2026-07-24T06:00:00.000Z",
        messageCount: 1,
        detailState: "full",
        messages: [{ id: "u1", role: "user", text: "Continue the release" }]
      },
      contextFilePath
    });

    expect(launch).toEqual({
      executablePath: "/usr/local/bin/claude",
      args: ["--add-dir", "/tmp/agentenv", "--name", "Continue the release"],
      cwd: "/work/project"
    });
    expect(launch?.args).not.toContain(contextFilePath);
  });

  it("opens OpenCode in its interactive TUI without submitting a task", () => {
    const launch = createOpenCodeConversationCapability().openContinuation?.({
      ...contextFor("/tmp/.config/opencode"),
      executablePath: "/usr/local/bin/opencode",
      conversation: {
        id: "agy:conversation",
        agentId: "antigravity",
        agentName: "Antigravity CLI",
        sourceId: "conversation",
        title: "Continue the release",
        snippet: "Continue the release",
        workspacePath: "/work/project",
        createdAt: "2026-07-24T05:00:00.000Z",
        updatedAt: "2026-07-24T06:00:00.000Z",
        messageCount: 1,
        detailState: "full",
        messages: [{ id: "u1", role: "user", text: "Continue the release" }]
      },
      contextFilePath: "/tmp/agentenv/handoff.md"
    });

    expect(launch).toMatchObject({
      executablePath: "/usr/local/bin/opencode",
      cwd: "/work/project",
      args: ["/work/project"]
    });
    expect(launch?.args).not.toContain("run");
    expect(launch?.args).not.toContain("Continue the work using the attached conversation context.");
  });

  it("keeps large Claude transcripts and excludes subagent logs from top-level history", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-history-"));
    const configDir = join(root, ".claude");
    const projectDir = join(configDir, "projects", "workspace");
    const largePath = join(projectDir, "main-session.jsonl");
    const subagentPath = join(projectDir, "subagents", "agent-session.jsonl");
    await mkdir(join(projectDir, "subagents"), { recursive: true });
    await writeFile(
      largePath,
      `${JSON.stringify({
        type: "user",
        sessionId: "provider-session",
        message: { content: "hello" }
      })}\n`,
      "utf8"
    );
    await truncate(largePath, 25 * 1024 * 1024);
    await writeFile(subagentPath, "{}\n", "utf8");

    const capability = createClaudeConversationCapability();
    const discovery = await capability.discover(contextFor(configDir));
    const candidates = discovery.candidates;

    expect(discovery.complete).toBe(true);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      recordId: "main-session",
      source: {
        locator: largePath
      }
    });
  });

  it("keeps a Claude custom title when a later generated title is appended", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-title-"));
    const configDir = join(root, ".claude");
    const projectDir = join(configDir, "projects", "workspace");
    const historyPath = join(projectDir, "claude-session.jsonl");
    await mkdir(projectDir, { recursive: true });
    await writeFile(historyPath, [
      JSON.stringify({
        type: "user",
        sessionId: "claude-session",
        uuid: "user-1",
        message: { role: "user", content: "Review the release" }
      }),
      JSON.stringify({
        type: "ai-title",
        sessionId: "claude-session",
        aiTitle: "Generated release review"
      }),
      JSON.stringify({
        type: "custom-title",
        sessionId: "claude-session",
        customTitle: "Release readiness"
      })
    ].join("\n") + "\n", "utf8");

    const capability = createClaudeConversationCapability();
    const initialCandidate = (await capability.discover(contextFor(configDir))).candidates[0];
    const initial = await capability.read(contextFor(configDir), initialCandidate);
    expect(initial.title).toBe("Release readiness");

    await appendFile(historyPath, `${JSON.stringify({
      type: "ai-title",
      sessionId: "claude-session",
      aiTitle: "Later generated title"
    })}\n`, "utf8");
    const updatedCandidate = (await capability.discover(contextFor(configDir))).candidates[0];
    const updated = await capability.read(contextFor(configDir), updatedCandidate, {
      detail: initial,
      sourceVersion: initialCandidate.source.version
    });

    expect(updated.title).toBe("Release readiness");
    expect(updated.messages.map((message) => message.text)).toEqual(["Review the release"]);
  });

  it("parses only an appended Codex JSONL tail while preserving indexed messages", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-history-"));
    const configDir = join(root, ".codex");
    const sessionsDir = join(configDir, "sessions");
    const historyPath = join(sessionsDir, "record-session.jsonl");
    await mkdir(sessionsDir, { recursive: true });
    const replacementText = "Replacement content is longer than the original transcript. ".repeat(20);
    await writeFile(historyPath, [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "provider-session",
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
          content: [{ type: "input_text", text: "First message" }]
        }
      })
    ].join("\n") + "\n", "utf8");
    const context: AgentConversationContext = {
      homeDir: root,
      targetPaths: {
        targetId: "codex",
        configDir,
        instructionsPath: join(configDir, "AGENTS.md"),
        configPath: join(configDir, "config.toml"),
        skillsDir: join(configDir, "skills")
      }
    };
    const capability = createCodexConversationCapability();
    const firstCandidate = (await capability.discover(context)).candidates[0];
    const first = await capability.read(context, firstCandidate);

    await appendFile(historyPath, `${JSON.stringify({
      type: "response_item",
      payload: {
        id: "assistant-1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Appended response" }]
      }
    })}\n`, "utf8");
    const secondCandidate = (await capability.discover(context)).candidates[0];
    const second = await capability.read(context, secondCandidate, {
      detail: first,
      sourceVersion: firstCandidate.source.version
    });

    expect(second.id).toBe("codex:record-session");
    expect(second.sourceId).toBe("provider-session");
    expect(second.messages.map((message) => message.text)).toEqual([
      "First message",
      "Appended response"
    ]);

    await writeFile(historyPath, [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: "replacement-session",
          cwd: "/work/replacement",
          timestamp: "2026-07-24T07:00:00.000Z"
        }
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          id: "replacement-user",
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: replacementText
          }]
        }
      })
    ].join("\n") + "\n", "utf8");
    const replacementCandidate = (await capability.discover(context)).candidates[0];
    const replacement = await capability.read(context, replacementCandidate, {
      detail: second,
      sourceVersion: secondCandidate.source.version
    });

    expect(replacement.sourceId).toBe("replacement-session");
    expect(replacement.messages.map((message) => message.text)).toEqual([
      replacementText.trim()
    ]);
  });

  it("uses the latest Codex native title and refreshes only the renamed session", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-native-titles-"));
    const configDir = join(root, ".codex");
    const sessionsDir = join(configDir, "sessions");
    const sessionId = "019f0000-0000-7000-8000-000000000001";
    const historyPath = join(
      sessionsDir,
      `rollout-2026-07-24T05-00-00-${sessionId}.jsonl`
    );
    const titleIndexPath = join(configDir, "session_index.jsonl");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(historyPath, [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: sessionId,
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
          content: [{ type: "input_text", text: "A much longer first user message" }]
        }
      })
    ].join("\n") + "\n", "utf8");
    await writeFile(titleIndexPath, [
      "{malformed-json",
      JSON.stringify({
        id: sessionId,
        thread_name: "Initial native title"
      }),
      JSON.stringify({
        id: sessionId,
        thread_name: "Latest native title"
      })
    ].join("\n") + "\n", "utf8");

    const context: AgentConversationContext = {
      homeDir: root,
      targetPaths: {
        targetId: "codex",
        configDir,
        instructionsPath: join(configDir, "AGENTS.md"),
        configPath: join(configDir, "config.toml"),
        skillsDir: join(configDir, "skills")
      }
    };
    const capability = createCodexConversationCapability();
    const initialCandidate = (await capability.discover(context)).candidates[0];
    const initial = await capability.read(context, initialCandidate);

    expect(initialCandidate.title).toBe("Latest native title");
    expect(initial.title).toBe("Latest native title");

    await appendFile(titleIndexPath, `${JSON.stringify({
      id: "019f0000-0000-7000-8000-000000000002",
      thread_name: "Another conversation"
    })}\n`, "utf8");
    const unrelatedCandidate = (await capability.discover(context)).candidates[0];
    expect(unrelatedCandidate.source.version).toBe(initialCandidate.source.version);

    await appendFile(titleIndexPath, `${JSON.stringify({
      id: sessionId,
      thread_name: "Renamed in Codex"
    })}\n`, "utf8");
    const renamedCandidate = (await capability.discover(context)).candidates[0];
    const renamed = await capability.read(context, renamedCandidate, {
      detail: initial,
      sourceVersion: initialCandidate.source.version
    });

    expect(renamedCandidate.title).toBe("Renamed in Codex");
    expect(renamedCandidate.source.version).not.toBe(initialCandidate.source.version);
    expect(renamed.title).toBe("Renamed in Codex");
    expect(renamed.messages.map((message) => message.text)).toEqual([
      "A much longer first user message"
    ]);
  });
});
