import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityConversationCapability } from "../../../src/main/targets/conversations/antigravityConversations";
import { createClaudeConversationCapability } from "../../../src/main/targets/conversations/claudeConversations";
import { createCodexConversationCapability } from "../../../src/main/targets/conversations/codexConversations";
import { createOpenCodeConversationCapability } from "../../../src/main/targets/conversations/opencodeConversations";
import { createPiConversationCapability } from "../../../src/main/targets/conversations/piConversations";
import type { AgentConversationContext } from "../../../src/main/targets/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const contextFor = (
  targetId: string,
  configDir: string,
  runtimeDir?: string
): AgentConversationContext => ({
  homeDir: root,
  executablePath: join(root, "bin", targetId),
  targetPaths: {
    targetId,
    configDir,
    runtimeDir,
    instructionsPath: join(configDir, "AGENTS.md"),
    configPath: join(configDir, "config.json"),
    skillsDir: join(configDir, "skills")
  }
});

describe("native conversation working-directory moves", () => {
  it("moves and rolls back a Codex rollout without changing messages or session identity", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-move-"));
    const configDir = join(root, ".codex");
    const path = join(configDir, "sessions", "2026", "08", "26", "rollout-session.jsonl");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, [
      JSON.stringify({ type: "session_meta", payload: { id: "codex-session", cwd: "/tmp/old" } }),
      JSON.stringify({ type: "turn_context", payload: { cwd: "/tmp/old" } }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Keep this history" }] }
      })
    ].join("\n") + "\n");
    const destination = join(root, "projects", "stable");
    await mkdir(destination, { recursive: true });
    const capability = createCodexConversationCapability();
    const context = contextFor("codex", configDir);
    const candidate = (await capability.discover(context)).candidates[0];
    const before = await capability.read(context, candidate);

    const commit = await capability.move!({ ...context, candidate, destinationPath: destination });
    const movedCandidate = (await capability.discover(context)).candidates[0];
    const moved = await capability.read(context, movedCandidate);

    expect(moved).toMatchObject({ sourceId: "codex-session", workspacePath: destination });
    expect(moved.messages).toEqual(before.messages);
    expect(await readFile(path, "utf8")).toContain(`"cwd":"${destination}"`);

    await commit.rollback();
    expect(await readFile(path, "utf8")).toContain('"cwd":"/tmp/old"');
  });

  it("moves a Claude Code transcript into the destination project history directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-move-"));
    const configDir = join(root, ".claude");
    const oldPath = join(configDir, "projects", "-tmp-old", "claude-session.jsonl");
    await mkdir(join(oldPath, ".."), { recursive: true });
    await writeFile(oldPath, `${JSON.stringify({
      type: "user",
      sessionId: "claude-session",
      uuid: "message-1",
      cwd: "/tmp/old",
      message: { role: "user", content: "Keep this history" }
    })}\n`);
    const destination = join(root, "projects", "stable");
    await mkdir(destination, { recursive: true });
    const capability = createClaudeConversationCapability();
    const context = contextFor("claude-code", configDir);
    const candidate = (await capability.discover(context)).candidates[0];
    const commit = await capability.move!({ ...context, candidate, destinationPath: destination });
    const expectedPath = join(
      configDir,
      "projects",
      destination.replace(/[^A-Za-z0-9]/g, "-"),
      "claude-session.jsonl"
    );
    const movedCandidate = (await capability.discover(context)).candidates[0];
    const moved = await capability.read(context, movedCandidate);

    expect(await stat(oldPath).catch(() => undefined)).toBeUndefined();
    expect(movedCandidate.source.locator).toBe(expectedPath);
    expect(moved).toMatchObject({ sourceId: "claude-session", workspacePath: destination });
    expect(moved.messages[0]?.text).toBe("Keep this history");

    await commit.rollback();
    expect((await stat(oldPath)).isFile()).toBe(true);
    expect(await stat(expectedPath).catch(() => undefined)).toBeUndefined();
  });

  it("moves and rolls back a Pi session header", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-pi-move-"));
    const configDir = join(root, ".pi", "agent");
    const runtimeDir = join(configDir, "sessions");
    const path = join(runtimeDir, "session.jsonl");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(path, [
      JSON.stringify({ type: "session", id: "pi-session", cwd: "/tmp/old" }),
      JSON.stringify({
        type: "message",
        id: "message-1",
        parentId: null,
        message: { role: "user", content: "Keep this history" }
      })
    ].join("\n") + "\n");
    const destination = join(root, "projects", "stable");
    await mkdir(destination, { recursive: true });
    const capability = createPiConversationCapability();
    const context = contextFor("pi", configDir, runtimeDir);
    const candidate = (await capability.discover(context)).candidates[0];
    const commit = await capability.move!({ ...context, candidate, destinationPath: destination });
    const movedCandidate = (await capability.discover(context)).candidates[0];
    expect(await capability.read(context, movedCandidate)).toMatchObject({
      sourceId: "pi-session",
      workspacePath: destination,
      messages: [{ text: "Keep this history" }]
    });
    await commit.rollback();
    expect(await readFile(path, "utf8")).toContain('"cwd":"/tmp/old"');
  });

  it("moves only Antigravity's workspace mapping and leaves transcript bytes unchanged", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-move-"));
    const configDir = join(root, ".gemini", "config");
    const appDataDir = join(root, ".gemini", "antigravity-cli");
    const transcript = join(
      appDataDir,
      "brain",
      "ag-session",
      ".system_generated",
      "logs",
      "transcript.jsonl"
    );
    const mapping = join(appDataDir, "cache", "last_conversations.json");
    await mkdir(configDir, { recursive: true });
    await mkdir(join(transcript, ".."), { recursive: true });
    await mkdir(join(mapping, ".."), { recursive: true });
    const transcriptContent = `${JSON.stringify({
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      content: "<USER_REQUEST>Keep this history</USER_REQUEST>"
    })}\n`;
    await writeFile(transcript, transcriptContent);
    await writeFile(mapping, JSON.stringify({ "/tmp/old": "ag-session" }));
    const destination = join(root, "projects", "stable");
    await mkdir(destination, { recursive: true });
    const capability = createAntigravityConversationCapability();
    const context = contextFor("antigravity", configDir);
    const candidate = (await capability.discover(context)).candidates[0];
    const commit = await capability.move!({ ...context, candidate, destinationPath: destination });
    const movedCandidate = (await capability.discover(context)).candidates[0];

    expect(movedCandidate.workspacePath).toBe(destination);
    expect(await readFile(transcript, "utf8")).toBe(transcriptContent);
    await commit.rollback();
    expect(JSON.parse(await readFile(mapping, "utf8"))).toEqual({ "/tmp/old": "ag-session" });
  });

  it("updates OpenCode directory and project ownership in one SQLite transaction", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-move-"));
    const configDir = join(root, ".config", "opencode");
    const dataDir = join(root, ".local", "share", "opencode");
    const dbPath = join(dataDir, "opencode.db");
    const destination = join(root, "projects", "stable");
    await mkdir(configDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await mkdir(destination, { recursive: true });
    const database = new DatabaseSync(dbPath);
    database.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL);
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL,
        directory TEXT NOT NULL, time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL, time_archived INTEGER, parent_id TEXT
      );
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER, data TEXT NOT NULL);
    `);
    database.prepare("INSERT INTO project VALUES (?, ?)").run("old-project", "/tmp/old");
    database.prepare("INSERT INTO project VALUES (?, ?)").run("new-project", destination);
    database.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("oc-session", "old-project", "Stored", "/tmp/old", 1, 2, null, null);
    database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)")
      .run("message-1", "oc-session", 1, JSON.stringify({ role: "user" }));
    database.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)")
      .run("part-1", "message-1", "oc-session", 1, JSON.stringify({ type: "text", text: "Keep this history" }));
    database.close();

    const capability = createOpenCodeConversationCapability();
    const context = contextFor("opencode", configDir);
    const candidate = (await capability.discover(context)).candidates[0];
    const commit = await capability.move!({ ...context, candidate, destinationPath: destination });
    const movedDatabase = new DatabaseSync(dbPath, { readOnly: true });
    expect(movedDatabase.prepare("SELECT directory, project_id FROM session").get())
      .toEqual({ directory: destination, project_id: "new-project" });
    movedDatabase.close();

    const movedCandidate = (await capability.discover(context)).candidates[0];
    expect(await capability.read(context, movedCandidate)).toMatchObject({
      sourceId: "oc-session",
      workspacePath: destination,
      messages: [{ text: "Keep this history" }]
    });
    await commit.rollback();
    const rolledBack = new DatabaseSync(dbPath, { readOnly: true });
    expect(rolledBack.prepare("SELECT directory, project_id FROM session").get())
      .toEqual({ directory: "/tmp/old", project_id: "old-project" });
    rolledBack.close();
  });

  it("registers an unknown OpenCode destination before retrying the native move", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-register-move-"));
    const configDir = join(root, ".config", "opencode");
    const dataDir = join(root, ".local", "share", "opencode");
    const dbPath = join(dataDir, "opencode.db");
    const destination = join(root, "projects", "new-worktree");
    await mkdir(configDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await mkdir(destination, { recursive: true });
    const database = new DatabaseSync(dbPath);
    database.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL);
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL,
        directory TEXT NOT NULL, time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL, time_archived INTEGER, parent_id TEXT
      );
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER, data TEXT NOT NULL);
      INSERT INTO project VALUES ('old-project', '/tmp/old');
      INSERT INTO session VALUES ('oc-session', 'old-project', 'Stored', '/tmp/old', 1, 2, NULL, NULL);
    `);
    database.close();
    let registrationCount = 0;
    const capability = createOpenCodeConversationCapability({
      registerProject: async (_executablePath, workspacePath) => {
        registrationCount += 1;
        const writable = new DatabaseSync(dbPath);
        writable.prepare("INSERT INTO project VALUES (?, ?)")
          .run("registered-project", workspacePath);
        writable.close();
      }
    });
    const context = contextFor("opencode", configDir);
    const candidate = (await capability.discover(context)).candidates[0];

    const commit = await capability.move!({ ...context, candidate, destinationPath: destination });

    expect(registrationCount).toBe(1);
    const moved = new DatabaseSync(dbPath, { readOnly: true });
    expect(moved.prepare("SELECT directory, project_id FROM session").get())
      .toEqual({ directory: destination, project_id: "registered-project" });
    moved.close();
    await commit.rollback();
  });
});
