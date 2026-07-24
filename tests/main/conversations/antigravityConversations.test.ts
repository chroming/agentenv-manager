import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
        'Review desktop shell',
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

    const candidates = await capability.discover({
      homeDir: root,
      targetPaths,
      executablePath: "/usr/local/bin/agy"
    });
    expect(candidates).toEqual([
      expect.objectContaining({
        sourceId: "ag-session",
        title: "Review desktop shell",
        workspacePath: "/work/project",
        messageCount: 4,
        detailState: "summary-only"
      })
    ]);
    expect((await capability.read({
      homeDir: root,
      targetPaths,
      executablePath: "/usr/local/bin/agy"
    }, candidates[0])).messages).toEqual([]);
  });
});
