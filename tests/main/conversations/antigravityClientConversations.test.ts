import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityConversationCapability } from "../../../src/main/targets/conversations/antigravityConversations";
import type { TargetPaths } from "../../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Antigravity Client conversation adapter", () => {
  it("uses open -a Antigravity for launch and handoff continuation", () => {
    const capability = createAntigravityConversationCapability({
      targetId: "antigravity-client",
      targetName: "Antigravity Client",
      appDataSubdir: "antigravity",
      isDesktopApp: true
    });

    const openOriginalSpec = capability.openOriginal?.(
      { homeDir: "/Users/test", targetPaths: { targetId: "antigravity-client", configDir: "/Users/test/.gemini/antigravity", instructionsPath: "", configPath: "" }, executablePath: "/Applications/Antigravity.app" },
      {
        recordId: "sess-1",
        source: { version: "1", locator: "/path/to/transcript.jsonl" },
        workspacePath: "/Users/test/projects/demo",
        updatedAt: "2026-08-30T10:00:00.000Z",
        detailState: "full"
      }
    );

    expect(openOriginalSpec).toEqual({
      executablePath: "/usr/bin/open",
      args: ["-a", "/Applications/Antigravity.app", "/Users/test/projects/demo"],
      cwd: "/Users/test/projects/demo"
    });

    const openContinuationSpec = capability.openContinuation?.({
      homeDir: "/Users/test",
      targetPaths: { targetId: "antigravity-client", configDir: "/Users/test/.gemini/antigravity", instructionsPath: "", configPath: "" },
      executablePath: "/Applications/Antigravity.app",
      conversation: {
        id: "antigravity-client:sess-1",
        agentId: "antigravity-client",
        agentName: "Antigravity Client",
        sourceId: "sess-1",
        title: "Test Task",
        snippet: "Test snippet",
        workspacePath: "/Users/test/projects/demo",
        createdAt: "2026-08-30T10:00:00.000Z",
        updatedAt: "2026-08-30T10:05:00.000Z",
        messageCount: 2,
        detailState: "full",
        messages: []
      },
      contextFilePath: "/Users/test/.cache/handoff/context.md"
    });

    expect(openContinuationSpec).toEqual({
      executablePath: "/usr/bin/open",
      args: ["-a", "/Applications/Antigravity.app", "/Users/test/projects/demo"],
      cwd: "/Users/test/projects/demo"
    });
  });

  it("discovers and reads transcripts from ~/.gemini/antigravity/brain", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-client-transcript-"));
    const configDir = join(root, ".gemini", "antigravity");
    const conversationId = "07c73372-7a6d-44f6-9179-43149cbad3d2";
    const transcriptDir = join(
      configDir,
      "brain",
      conversationId,
      ".system_generated",
      "logs"
    );
    await mkdir(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, "transcript.jsonl");

    const lines = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-08-30T10:00:00.000Z",
        content: "<USER_REQUEST>\nFix the button layout in renderer\n</USER_REQUEST>"
      }),
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-08-30T10:00:05.000Z",
        content: "I have resolved the button layout issue."
      })
    ];
    await writeFile(transcriptPath, `${lines.join("\n")}\n`);

    const targetPaths: TargetPaths = {
      targetId: "antigravity-client",
      configDir,
      instructionsPath: join(root, ".gemini", "GEMINI.md"),
      configPath: join(configDir, "mcp_config.json")
    };

    const capability = createAntigravityConversationCapability({
      targetId: "antigravity-client",
      targetName: "Antigravity Client",
      appDataSubdir: "antigravity",
      isDesktopApp: true
    });

    const discovery = await capability.discover({
      homeDir: root,
      targetPaths
    });

    expect(discovery.complete).toBe(true);
    expect(discovery.candidates.length).toBe(1);
    expect(discovery.candidates[0]).toMatchObject({
      recordId: conversationId,
      detailState: "full"
    });

    const detail = await capability.read(
      { homeDir: root, targetPaths },
      discovery.candidates[0]
    );

    expect(detail.agentId).toBe("antigravity-client");
    expect(detail.agentName).toBe("Antigravity Client");
    expect(detail.title).toBe("Fix the button layout in renderer");
    expect(detail.messages.length).toBe(2);
    expect(detail.messages[0]).toMatchObject({
      role: "user",
      text: "Fix the button layout in renderer"
    });
    expect(detail.messages[1]).toMatchObject({
      role: "assistant",
      text: "I have resolved the button layout issue."
    });
  });
});
