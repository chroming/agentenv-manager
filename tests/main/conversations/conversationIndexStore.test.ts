import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConversationIndexStore,
  type ConversationIndexStore
} from "../../../src/main/conversations/conversationIndexStore";
import type { ConversationDetail } from "../../../src/shared/types";
import type { AgentConversationCandidate } from "../../../src/main/targets/types";

let root = "";
let store: ConversationIndexStore | undefined;

afterEach(async () => {
  store?.close();
  store = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const detail: ConversationDetail = {
  id: "codex:file-record",
  agentId: "codex",
  agentName: "Codex",
  sourceId: "session-1",
  title: "修复发布流程",
  snippet: "Investigate a failing release",
  workspacePath: "/work/project",
  createdAt: "2026-07-24T05:00:00.000Z",
  updatedAt: "2026-07-24T06:00:00.000Z",
  messageCount: 2,
  detailState: "full",
  messages: [
    { id: "u1", role: "user", text: "查找部署错误" },
    { id: "a1", role: "assistant", text: "The release job used an old token." }
  ]
};

const candidate: AgentConversationCandidate = {
  recordId: "file-record",
  source: {
    version: "100:123",
    locator: "/history/session-1.jsonl"
  },
  providerSession: {
    kind: "native",
    id: "session-1",
    resumeLocator: "session-1"
  },
  updatedAt: detail.updatedAt,
  detailState: "full"
};

const fileVersion = (size: number) => [
  size,
  1784863200000,
  16777234,
  12345,
  "a".repeat(64),
  "b".repeat(64)
].join(":");

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-conversation-index-"));
  const path = join(root, "cache", "conversations.sqlite");
  store = await createConversationIndexStore(path);
  return { path, store };
};

describe("conversation index store", () => {
  it("indexes searchable visible content without changing the source file", async () => {
    const { path, store: index } = await setup();
    const source = join(root, "history.jsonl");
    await writeFile(source, "immutable source\n");
    const before = await readFile(source, "utf8");

    index.upsert(detail, {
      ...candidate,
      source: { ...candidate.source, locator: source }
    });

    expect((await index.list({ query: "发布" })).items).toHaveLength(1);
    expect(await index.search({ query: "发布", limit: 6 })).toEqual([
      expect.objectContaining({
        id: detail.id,
        matchSnippet: expect.stringContaining("发布")
      })
    ]);
    expect((await index.list({ query: "%" })).items).toEqual([]);
    expect((await index.list()).agentCounts).toEqual({ codex: 1 });
    expect(await index.list({ query: "OLD TOKEN" })).toMatchObject({
      items: [{
        id: detail.id,
        matchSnippet: expect.stringMatching(/old token/i)
      }],
      workspacePaths: ["/work/project"]
    });
    expect((await index.list({ workspacePaths: ["/other/project"] })).items).toEqual([]);
    expect((await index.list({ workspacePaths: ["/work/project"] })).items).toHaveLength(1);
    expect((await index.read(detail.id)).messages).toEqual(detail.messages);
    expect(index.record(detail.id)).toMatchObject({
      candidate: {
        recordId: "file-record",
        source: {
          version: candidate.source.version,
          locator: source
        }
      }
    });
    expect(await readFile(source, "utf8")).toBe(before);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("ranks title matches before newer body-only matches", async () => {
    const { store: index } = await setup();
    index.upsert({
      ...detail,
      id: "codex:title-match",
      sourceId: "title-match",
      title: "Release token",
      updatedAt: "2026-07-20T06:00:00.000Z",
      messages: [{ id: "title-message", role: "user", text: "Unrelated body" }]
    }, {
      ...candidate,
      recordId: "title-match",
      providerSession: {
        kind: "native",
        id: "title-match",
        resumeLocator: "title-match"
      }
    });
    index.upsert({
      ...detail,
      id: "codex:body-match",
      sourceId: "body-match",
      title: "Recent discussion",
      updatedAt: "2026-07-25T06:00:00.000Z",
      messages: [{
        id: "body-message",
        role: "assistant",
        text: "The release token needs rotation."
      }]
    }, {
      ...candidate,
      recordId: "body-match",
      providerSession: {
        kind: "native",
        id: "body-match",
        resumeLocator: "body-match"
      }
    });

    const results = await index.search({ query: "release token", limit: 6 });

    expect(results.map((item) => item.id)).toEqual([
      "codex:title-match",
      "codex:body-match"
    ]);
    expect(results[1]?.matchSnippet).toMatch(/release token/i);
  });

  it("exposes a transcript size only for verified file fingerprints", async () => {
    const { store: index } = await setup();
    index.upsert(detail, {
      ...candidate,
      source: {
        ...candidate.source,
        version: fileVersion(24_576)
      }
    });

    expect((await index.list()).items[0]).toMatchObject({ sizeBytes: 24_576 });
    expect(await index.read(detail.id)).toMatchObject({ sizeBytes: 24_576 });

    index.upsert({ ...detail, id: "opencode:database" }, {
      ...candidate,
      recordId: "database",
      source: {
        locator: "opencode-sqlite:/tmp/opencode.db",
        version: "1784863200000:42"
      }
    });
    expect(
      (await index.list()).items.find((item) => item.id === "opencode:database")
        ?.sizeBytes
    ).toBeUndefined();
  });

  it("sorts the complete filtered index by size or message count before pagination", async () => {
    const { store: index } = await setup();
    const fixtures = [
      {
        id: "codex:large",
        size: 8_192,
        messageCount: 4,
        updatedAt: "2026-07-20T06:00:00.000Z"
      },
      {
        id: "codex:small",
        size: 1_024,
        messageCount: 12,
        updatedAt: "2026-07-25T06:00:00.000Z"
      },
      {
        id: "codex:unknown",
        size: undefined,
        messageCount: 30,
        updatedAt: "2026-07-26T06:00:00.000Z"
      }
    ];

    for (const fixture of fixtures) {
      index.upsert({
        ...detail,
        id: fixture.id,
        sourceId: fixture.id,
        title: fixture.id,
        updatedAt: fixture.updatedAt,
        messageCount: fixture.messageCount
      }, {
        ...candidate,
        recordId: fixture.id,
        source: {
          ...candidate.source,
          version: fixture.size === undefined
            ? "database-revision"
            : fileVersion(fixture.size)
        },
        providerSession: {
          kind: "native",
          id: fixture.id,
          resumeLocator: fixture.id
        }
      });
    }

    expect((await index.list({ sort: "size-desc", limit: 2 })).items.map((item) => item.id))
      .toEqual(["codex:large", "codex:small"]);
    expect((await index.list({ sort: "size-desc", limit: 2, offset: 2 })).items.map((item) => item.id))
      .toEqual(["codex:unknown"]);
    expect((await index.list({ sort: "messages-desc" })).items.map((item) => item.id))
      .toEqual(["codex:unknown", "codex:small", "codex:large"]);
  });

  it("persists the Agent discovery version without changing indexed history", async () => {
    const { path, store: index } = await setup();
    index.upsert(detail, candidate);
    expect(index.discoveryVersion()).toBeUndefined();

    index.setDiscoveryVersion("2");
    index.close();
    store = undefined;
    store = await createConversationIndexStore(path);

    expect(store.discoveryVersion()).toBe("2");
    expect((await store.list()).items).toEqual([
      expect.objectContaining({ id: detail.id })
    ]);
  });

  it("replaces messages atomically and removes only stale records for one Agent", async () => {
    const { store: index } = await setup();
    index.upsert(detail, candidate);
    index.upsert({
      ...detail,
      id: "claude-code:session-2",
      agentId: "claude-code",
      agentName: "Claude Code",
      sourceId: "session-2"
    }, {
      ...candidate,
      recordId: "session-2",
      source: {
        ...candidate.source,
        locator: "/history/session-2.jsonl"
      },
      providerSession: {
        kind: "native",
        id: "session-2",
        resumeLocator: "session-2"
      }
    });

    index.upsert({
      ...detail,
      title: "Updated title",
      messageCount: 1,
      messages: [{ id: "u2", role: "user", text: "replacement" }]
    }, {
      ...candidate,
      source: { ...candidate.source, version: "101:124" }
    });

    expect((await index.read(detail.id)).messages).toEqual([
      { id: "u2", role: "user", text: "replacement" }
    ]);
    expect(index.removeMissing("codex", new Set())).toBe(1);
    expect(await index.search({ query: "replacement" })).toEqual([]);
    expect((await index.list()).items.map((item) => item.agentId)).toEqual(["claude-code"]);
  });

  it("migrates an existing cache to the indexed search schema", async () => {
    const { path, store: index } = await setup();
    index.upsert(detail, candidate);
    index.close();
    store = undefined;

    const legacy = new DatabaseSync(path);
    legacy.exec(`
      ALTER TABLE conversations DROP COLUMN size_bytes;
      DROP TABLE conversation_search;
      PRAGMA user_version = 2;
    `);
    legacy.close();

    store = await createConversationIndexStore(path);

    expect(await store.search({ query: "release job" })).toEqual([
      expect.objectContaining({
        id: detail.id,
        matchSnippet: expect.stringMatching(/release job/i)
      })
    ]);
    const migrated = new DatabaseSync(path, { readOnly: true });
    expect(
      (migrated.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version
    ).toBe(4);
    expect(
      migrated.prepare(
        "SELECT count(*) AS count FROM conversation_search"
      ).get()
    ).toEqual({ count: 1 });
    expect(
      (migrated.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>)
        .some((column) => column.name === "size_bytes")
    ).toBe(true);
    migrated.close();
  });

  it("rebuilds a corrupt disposable cache", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-corrupt-"));
    const cacheDir = join(root, "cache");
    const path = join(cacheDir, "conversations.sqlite");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, "not a sqlite database");

    store = await createConversationIndexStore(path);

    expect(await store.list()).toEqual({
      items: [],
      total: 0,
      workspacePaths: [],
      agentCounts: {}
    });
    expect((await readFile(path)).subarray(0, 6).toString()).toBe("SQLite");
  });

  it("reparses legacy cached records without clearing their last-good content", async () => {
    const { path, store: index } = await setup();
    index.upsert(detail, candidate);
    index.close();
    store = undefined;

    const database = new DatabaseSync(path);
    database.prepare(
      "UPDATE conversations SET source_version = ? WHERE id = ?"
    ).run(candidate.source.version, detail.id);
    database.close();

    store = await createConversationIndexStore(path);
    expect(store.sourceVersion(detail.id)).toBeUndefined();
    expect((await store.list()).items).toEqual([
      expect.objectContaining({ id: detail.id, title: detail.title })
    ]);
    expect(store.record(detail.id).candidate.source.version).toBe(candidate.source.version);
  });

  it("reads the newest messages in bounded pages", async () => {
    const { store: index } = await setup();
    const messages = Array.from({ length: 125 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `message ${index}`
    }));
    index.upsert({
      ...detail,
      messageCount: messages.length,
      messages
    }, candidate);

    const latest = await index.read(detail.id, { limit: 60, tail: true });
    expect(latest.loadedMessageOffset).toBe(65);
    expect(latest.messages).toHaveLength(60);
    expect(latest.messages[0]?.id).toBe("message-65");
    expect(latest.messages.at(-1)?.id).toBe("message-124");

    const earlier = await index.read(detail.id, { offset: 5, limit: 60 });
    expect(earlier.loadedMessageOffset).toBe(5);
    expect(earlier.messages[0]?.id).toBe("message-5");
    expect(earlier.messages.at(-1)?.id).toBe("message-64");
  });

  it("centers a bounded message page around the selected search match", async () => {
    const { store: index } = await setup();
    const messages = Array.from({ length: 125 }, (_, messageIndex) => ({
      id: `message-${messageIndex}`,
      role: messageIndex % 2 === 0 ? "user" as const : "assistant" as const,
      text: messageIndex === 18
        ? "The uncommon rollout marker appears in this older message."
        : `message ${messageIndex}`
    }));
    index.upsert({
      ...detail,
      messageCount: messages.length,
      messages
    }, candidate);

    const focused = await index.read(detail.id, {
      limit: 60,
      tail: true,
      query: "uncommon rollout marker"
    });

    expect(focused.matchedMessageId).toBe("message-18");
    expect(focused.loadedMessageOffset).toBe(0);
    expect(focused.messages).toHaveLength(60);
    expect(focused.messages.some((message) => message.id === focused.matchedMessageId)).toBe(true);
  });
});
