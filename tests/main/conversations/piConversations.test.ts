import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPiConversationCapability,
  parsePiConversation
} from "../../../src/main/targets/conversations/piConversations";
import type {
  AgentConversationCandidate,
  AgentConversationContext
} from "../../../src/main/targets/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const candidate = (
  overrides: Partial<AgentConversationCandidate> = {}
): AgentConversationCandidate => ({
  recordId: "source-record",
  source: {
    version: "42:1",
    locator: "/tmp/read-only-pi-session.jsonl",
    runtimeHome: "/tmp/pi-sessions"
  },
  providerSession: {
    kind: "native",
    id: "source-session",
    resumeLocator: "source-session"
  },
  updatedAt: "2026-07-28T06:00:00.000Z",
  detailState: "full",
  ...overrides
});

const contextFor = (
  configDir: string,
  runtimeDir = join(configDir, "sessions")
): AgentConversationContext => ({
  homeDir: root,
  executablePath: "/usr/local/bin/pi",
  targetPaths: {
    targetId: "pi",
    configDir,
    runtimeDir,
    instructionsPath: join(configDir, "AGENTS.md"),
    configPath: join(configDir, "settings.json"),
    skillsDir: join(configDir, "skills")
  }
});

describe("Pi conversations", () => {
  it("renders only the current branch of a tree-structured session", () => {
    const detail = parsePiConversation(candidate(), [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "pi-session",
        timestamp: "2026-07-28T05:00:00.000Z",
        cwd: "/work/pi-project"
      }),
      JSON.stringify({
        type: "message",
        id: "user-root",
        parentId: null,
        timestamp: "2026-07-28T05:00:01.000Z",
        message: { role: "user", content: "Refactor the parser" }
      }),
      JSON.stringify({
        type: "message",
        id: "old-branch",
        parentId: "user-root",
        timestamp: "2026-07-28T05:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Old branch response" }]
        }
      }),
      JSON.stringify({
        type: "branch_summary",
        id: "branch-summary",
        parentId: "user-root",
        timestamp: "2026-07-28T05:00:03.000Z",
        summary: "Switched approach"
      }),
      JSON.stringify({
        type: "message",
        id: "new-branch",
        parentId: "branch-summary",
        timestamp: "2026-07-28T05:00:04.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Current branch response" }]
        }
      }),
      JSON.stringify({
        type: "session_info",
        id: "session-name",
        parentId: "new-branch",
        timestamp: "2026-07-28T05:00:05.000Z",
        name: "Parser refactor"
      })
    ].join("\n"));

    expect(detail).toMatchObject({
      id: "pi:source-record",
      sourceId: "pi-session",
      title: "Parser refactor",
      workspacePath: "/work/pi-project",
      createdAt: "2026-07-28T05:00:00.000Z",
      messageCount: 2
    });
    expect(detail.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Refactor the parser" },
      { role: "assistant", text: "Current branch response" }
    ]);
  });

  it("uses the first user request as title and ignores tools and malformed records", () => {
    const detail = parsePiConversation(candidate(), [
      "{broken",
      JSON.stringify({
        type: "session",
        id: "pi-session",
        timestamp: "2026-07-28T05:00:00.000Z",
        cwd: "/work/pi-project"
      }),
      JSON.stringify({
        type: "message",
        id: "user",
        parentId: null,
        timestamp: "2026-07-28T05:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Please improve Pi support" }]
        }
      }),
      JSON.stringify({
        type: "message",
        id: "tool",
        parentId: "user",
        timestamp: "2026-07-28T05:00:02.000Z",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: "hidden output" }]
        }
      })
    ].join("\n"));

    expect(detail.title).toBe("Improve Pi support");
    expect(detail.messages.map((message) => message.text)).toEqual([
      "Please improve Pi support"
    ]);
  });

  it("discovers sessions from the resolved custom history root", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-pi-history-"));
    const configDir = join(root, ".pi", "agent");
    const runtimeDir = join(root, "custom-pi-history");
    const sessionPath = join(
      runtimeDir,
      "--work-project--",
      "2026-07-28T05-00-00_pi-session.jsonl"
    );
    await mkdir(join(runtimeDir, "--work-project--"), { recursive: true });
    await writeFile(sessionPath, `${JSON.stringify({
      type: "session",
      version: 3,
      id: "pi-session",
      timestamp: "2026-07-28T05:00:00.000Z",
      cwd: "/work/project"
    })}\n`);

    const capability = createPiConversationCapability();
    const discovery = await capability.discover(
      contextFor(configDir, runtimeDir)
    );

    expect(discovery.complete).toBe(true);
    expect(discovery.failures).toBeUndefined();
    expect(discovery.candidates).toHaveLength(1);
    expect(discovery.candidates[0]).toMatchObject({
      recordId: "2026-07-28T05-00-00_pi-session",
      source: {
        locator: sessionPath,
        runtimeHome: runtimeDir
      }
    });
  });

  it("opens the native session and cross-Agent continuation with exact Pi roots", () => {
    const capability = createPiConversationCapability();
    const configDir = "/home/user/.pi/agent";
    const runtimeDir = "/home/user/pi-history";
    const context = contextFor(configDir, runtimeDir);
    const source = candidate({
      providerSession: {
        kind: "native",
        id: "pi-session",
        resumeLocator: "pi-session"
      },
      source: {
        version: "42:1",
        locator: "/home/user/pi-history/session.jsonl",
        runtimeHome: runtimeDir
      },
      workspacePath: "/work/project"
    });

    expect(capability.openOriginal?.(context, source)).toEqual({
      executablePath: "/usr/local/bin/pi",
      args: ["--session", "pi-session"],
      cwd: "/work/project",
      env: {
        PI_CODING_AGENT_DIR: configDir,
        PI_CODING_AGENT_SESSION_DIR: runtimeDir
      }
    });

    const conversation = parsePiConversation(source, [
      JSON.stringify({
        type: "session",
        id: "pi-session",
        timestamp: "2026-07-28T05:00:00.000Z",
        cwd: "/work/project"
      }),
      JSON.stringify({
        type: "message",
        id: "user",
        parentId: null,
        message: { role: "user", content: "Continue this work" }
      })
    ].join("\n"));
    expect(capability.continueWithContext?.({
      ...context,
      conversation,
      contextFilePath: "/tmp/agentenv/handoff.md"
    })).toEqual({
      executablePath: "/usr/local/bin/pi",
      args: [
        "Read the continuation context at /tmp/agentenv/handoff.md, then continue the user's work."
      ],
      cwd: "/work/project",
      env: {
        PI_CODING_AGENT_DIR: configDir,
        PI_CODING_AGENT_SESSION_DIR: runtimeDir
      }
    });
  });
});
