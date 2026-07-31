import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

const createTestDatabase = async (
  homeDir: string,
  dataDir = join(homeDir, ".local", "share", "opencode")
) => {
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
    INSERT INTO session VALUES (
      'session-1', NULL, 'Stored title', '/work/sqlite', 1000, 3000, NULL
    );
  `);
  database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
    "message-1",
    "session-1",
    2000,
    JSON.stringify({ role: "user", time: { created: 2000 } })
  );
  database.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
    "part-1",
    "message-1",
    "session-1",
    2000,
    JSON.stringify({ type: "text", text: "Message from SQLite" })
  );
  database.close();
  return dbPath;
};

describe("OpenCode local conversation storage", () => {
  it("discovers the native Windows LocalAppData database location", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-windows-storage-"));
    const localAppData = join(root, "AppData", "Local");
    await createTestDatabase(root, join(localAppData, "opencode"));
    const capability = createOpenCodeConversationCapability();
    const context = {
      ...contextFor(root),
      platform: "win32" as const,
      environment: { LOCALAPPDATA: localAppData }
    };

    const discovery = await capability.discover(context);

    expect(discovery.candidates).toEqual([
      expect.objectContaining({ recordId: "session-1" })
    ]);
  });

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

  it("waits for a transient OpenCode writer lock instead of failing every session", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-lock-"));
    const dbPath = await createTestDatabase(root);
    const capability = createOpenCodeConversationCapability();
    const context = contextFor(root);
    const candidate = (await capability.discover(context)).candidates[0];
    const writer = new DatabaseSync(dbPath);
    writer.exec("BEGIN EXCLUSIVE");
    const release = setTimeout(() => writer.exec("COMMIT"), 100);

    try {
      const detail = await capability.read(context, candidate);
      expect(detail.messages[0]?.text).toBe("Message from SQLite");
    } finally {
      clearTimeout(release);
      try {
        writer.exec("ROLLBACK");
      } catch {
        // The scheduled COMMIT already released the lock.
      }
      writer.close();
    }
  });

  it("falls back to the OpenCode export command when local SQLite is unreadable", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-cli-fallback-"));
    const dbPath = await createTestDatabase(root);
    const executablePath = join(root, "opencode");
    const capability = createOpenCodeConversationCapability();
    const context = { ...contextFor(root), executablePath };
    const candidate = (await capability.discover(context)).candidates[0];
    const database = new DatabaseSync(dbPath);
    database.exec("DROP TABLE part");
    database.close();
    await writeFile(
      executablePath,
      `#!/bin/sh
printf '%s' '{"messages":[{"info":{"id":"cli-message","role":"user","time":{"created":4000}},"parts":[{"type":"text","text":"Message from CLI fallback"}]}]}'
`,
      "utf8"
    );
    await chmod(executablePath, 0o755);

    const detail = await capability.read(context, candidate);

    expect(detail.messages).toEqual([
      expect.objectContaining({ id: "cli-message", text: "Message from CLI fallback" })
    ]);
  });
});
