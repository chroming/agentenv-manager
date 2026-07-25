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

    expect(index.list({ query: "发布" }).items).toHaveLength(1);
    expect(index.list().agentCounts).toEqual({ codex: 1 });
    expect(index.list({ query: "OLD TOKEN" })).toMatchObject({
      items: [{
        id: detail.id,
        matchSnippet: "The release job used an old token."
      }],
      workspacePaths: ["/work/project"]
    });
    expect(index.list({ workspacePaths: ["/other/project"] }).items).toEqual([]);
    expect(index.list({ workspacePaths: ["/work/project"] }).items).toHaveLength(1);
    expect(index.read(detail.id).messages).toEqual(detail.messages);
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

    expect(index.read(detail.id).messages).toEqual([
      { id: "u2", role: "user", text: "replacement" }
    ]);
    expect(index.removeMissing("codex", new Set())).toBe(1);
    expect(index.list().items.map((item) => item.agentId)).toEqual(["claude-code"]);
  });

  it("rebuilds a corrupt disposable cache", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-corrupt-"));
    const cacheDir = join(root, "cache");
    const path = join(cacheDir, "conversations.sqlite");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, "not a sqlite database");

    store = await createConversationIndexStore(path);

    expect(store.list()).toEqual({
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
    expect(store.list().items).toEqual([
      expect.objectContaining({ id: detail.id, title: detail.title })
    ]);
    expect(store.record(detail.id).candidate.source.version).toBe(candidate.source.version);
  });
});
