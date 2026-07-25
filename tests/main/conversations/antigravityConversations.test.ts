import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityConversationCapability } from "../../../src/main/targets/conversations/antigravityConversations";
import type { TargetPaths } from "../../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Antigravity conversation adapter", () => {
  it("opens the summaries database read-only and reports metadata-only history", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-history-"));
    const configDir = join(root, ".gemini", "config");
    const databaseDir = join(root, ".gemini", "antigravity-cli");
    const databasePath = join(databaseDir, "conversation_summaries.db");
    await mkdir(configDir, { recursive: true });
    await mkdir(databaseDir, { recursive: true });
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT,
        title TEXT,
        preview TEXT,
        step_count INTEGER,
        last_modified_time TEXT,
        workspace_uris TEXT,
        last_user_input_time TEXT
      );
      INSERT INTO conversation_summaries VALUES (
        'ag-session',
        '',
        'Inspect the desktop layout',
        4,
        '2026-07-24T06:00:00.000Z',
        '["file:///work/project"]',
        '2026-07-24T05:00:00.000Z'
      );
    `);
    database.close();
    const targetPaths: TargetPaths = {
      targetId: "antigravity",
      configDir,
      instructionsPath: join(configDir, "GEMINI.md"),
      configPath: join(configDir, "settings.json")
    };
    const capability = createAntigravityConversationCapability();

    const discovery = await capability.discover({
      homeDir: root,
      targetPaths,
      executablePath: "/usr/local/bin/agy"
    });
    const candidates = discovery.candidates;
    expect(discovery.complete).toBe(true);
    expect(candidates).toEqual([
      expect.objectContaining({
        recordId: "ag-session",
        providerSession: expect.objectContaining({ id: "ag-session" }),
        title: "",
        workspacePath: "/work/project",
        messageCount: 4,
        detailState: "summary-only"
      })
    ]);
    const detail = await capability.read({
      homeDir: root,
      targetPaths,
      executablePath: "/usr/local/bin/agy"
    }, candidates[0]);
    expect(detail).toMatchObject({
      title: "Inspect the desktop layout",
      snippet: "Inspect the desktop layout",
      messages: []
    });
  });

  it("prefers a readable CLI transcript over delayed summary metadata", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-transcript-"));
    const configDir = join(root, ".gemini", "config");
    const appDataDir = join(root, ".gemini", "antigravity-cli");
    const conversationId = "8897ec06-6029-441b-a55c-f9283d9198a8";
    const transcriptDir = join(
      appDataDir,
      "brain",
      conversationId,
      ".system_generated",
      "logs"
    );
    await mkdir(configDir, { recursive: true });
    await mkdir(transcriptDir, { recursive: true });
    await mkdir(join(appDataDir, "cache"), { recursive: true });
    await writeFile(
      join(appDataDir, "cache", "last_conversations.json"),
      JSON.stringify({ "/work/project": conversationId })
    );
    await writeFile(join(transcriptDir, "transcript.jsonl"), [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-07-25T05:10:03Z",
        content: [
          "<USER_REQUEST>",
          "测试222",
          "</USER_REQUEST>",
          "<ADDITIONAL_METADATA>hidden runtime metadata</ADDITIONAL_METADATA>"
        ].join("\n")
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-07-25T05:10:04Z",
        content: "收到，测试正常。"
      })
    ].join("\n"));
    const targetPaths: TargetPaths = {
      targetId: "antigravity",
      configDir,
      instructionsPath: join(configDir, "GEMINI.md"),
      configPath: join(configDir, "settings.json")
    };
    const capability = createAntigravityConversationCapability();
    const context = {
      homeDir: root,
      targetPaths,
      executablePath: "/usr/local/bin/agy"
    };

    const discovery = await capability.discover(context);
    expect(discovery).toMatchObject({
      complete: true,
      candidates: [{
        recordId: conversationId,
        workspacePath: "/work/project",
        detailState: "full"
      }]
    });
    expect(await capability.read(context, discovery.candidates[0])).toMatchObject({
      title: "测试222",
      workspacePath: "/work/project",
      messageCount: 2,
      messages: [
        { role: "user", text: "测试222" },
        { role: "assistant", text: "收到，测试正常。" }
      ]
    });

    await writeFile(
      join(appDataDir, "conversation_summaries.db"),
      "not a sqlite database"
    );
    const degradedDiscovery = await capability.discover(context);
    expect(degradedDiscovery.complete).toBe(false);
    expect(degradedDiscovery.candidates).toEqual([
      expect.objectContaining({
        recordId: conversationId,
        detailState: "full"
      })
    ]);
  });
});
