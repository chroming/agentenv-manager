import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenCodeConversationCapability } from "../../../src/main/targets/conversations/opencodeConversations";
import type { AgentConversationContext } from "../../../src/main/targets/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const contextFor = (homeDir: string): AgentConversationContext => ({
  homeDir,
  targetPaths: {
    targetId: "opencode",
    configDir: join(homeDir, ".config", "opencode"),
    instructionsPath: join(homeDir, ".config", "opencode", "AGENTS.md"),
    configPath: join(homeDir, ".config", "opencode", "opencode.jsonc"),
    skillsDir: join(homeDir, ".config", "opencode", "skills")
  }
});

describe("OpenCode local conversation storage", () => {
  it("reads top-level SQLite sessions off the main thread and ignores child sessions", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-storage-"));
    const dataDir = join(root, ".local", "share", "opencode");
    const dbPath = join(dataDir, "opencode.db");
    await mkdir(dataDir, { recursive: true });
    const database = new DatabaseSync(dbPath);
    database.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        title TEXT NOT NULL,
        directory TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        time_archived INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    database.prepare(
      "INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "session-1",
      null,
      "New session - 2026-07-25T05:09:39.092Z",
      "/work/sqlite",
      1000,
      3000,
      null
    );
    database.prepare(
      "INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("child-1", "session-1", "Child agent", "/work/sqlite", 1500, 2500, null);
    database.prepare(
      "INSERT INTO message VALUES (?, ?, ?, ?)"
    ).run("message-1", "session-1", 2000, JSON.stringify({
      role: "user",
      time: { created: 2000 }
    }));
    database.prepare(
      "INSERT INTO part VALUES (?, ?, ?, ?, ?)"
    ).run("part-1", "message-1", "session-1", 2000, JSON.stringify({
      type: "text",
      text: "Continue the SQLite-backed task"
    }));
    database.close();

    const capability = createOpenCodeConversationCapability();
    const discovery = await capability.discover(contextFor(root));
    const candidates = discovery.candidates;
    const detail = await capability.read(contextFor(root), candidates[0]);

    expect(discovery.complete).toBe(true);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      recordId: "session-1",
      providerSession: { id: "session-1" },
      workspacePath: "/work/sqlite",
      messageCount: 1
    });
    expect(detail).toMatchObject({
      id: "opencode:session-1",
      sourceId: "session-1",
      title: "Continue the SQLite-backed task",
      messageCount: 1
    });
    expect(detail.messages[0]).toMatchObject({
      role: "user",
      text: "Continue the SQLite-backed task"
    });
  });
});
