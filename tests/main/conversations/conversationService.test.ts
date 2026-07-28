import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversationService } from "../../../src/main/conversations/conversationService";
import { createPaths } from "../../../src/main/paths";
import type { SettingsStore } from "../../../src/main/settingsStore";
import { createTargetRegistry } from "../../../src/main/targets/registry";
import { createCodexTargetAdapter } from "../../../src/main/targets/codexTarget";
import { createOpenCodeTargetAdapter } from "../../../src/main/targets/opencodeTarget";
import type {
  AgentConversationCandidate,
  AgentConversationContext,
  AgentTargetAdapter,
  ConversationLaunchSpec
} from "../../../src/main/targets/types";
import type {
  ConversationDetail,
  TargetInfo
} from "../../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const makeTarget = (
  adapter: AgentTargetAdapter,
  homeDir: string,
  executablePath = `/usr/local/bin/${adapter.descriptor.id}`
): TargetInfo => ({
  ...adapter.descriptor,
  paths: adapter.createTargetPaths({ homeDir }),
  health: {
    status: "ready",
    installationFound: true,
    installationEvidence: [
      { kind: "command", label: adapter.descriptor.name, path: executablePath }
    ],
    executableName: adapter.descriptor.executableName,
    executablePath,
    executableFound: true,
    canWrite: true,
    summary: "Ready",
    checks: []
  },
  conversationCapabilities: {
    history: { state: "available", evidence: ["test"] },
    openOriginal: { state: "available", evidence: ["test"] },
    continue: { state: "available", evidence: ["test"] }
  }
});

const sourceCandidate = (sourceLocator: string): AgentConversationCandidate => ({
  recordId: "session-1",
  source: {
    version: "v1",
    locator: sourceLocator
  },
  providerSession: {
    kind: "native",
    id: "session-1",
    resumeLocator: "session-1"
  },
  title: "Release repair",
  snippet: "Repair a release workflow",
  workspacePath: "/work/project",
  createdAt: "2026-07-24T05:00:00.000Z",
  updatedAt: "2026-07-24T06:00:00.000Z",
  messageCount: 2,
  detailState: "full"
});

const sourceDetail = (
  messages: ConversationDetail["messages"] = [
    { id: "u1", role: "user", text: "Repair the release workflow" },
    { id: "a1", role: "assistant", text: "I found the failing step." }
  ]
): ConversationDetail => ({
  id: "codex:session-1",
  agentId: "codex",
  agentName: "Codex",
  sourceId: "session-1",
  title: "Release repair",
  snippet: "Repair a release workflow",
  workspacePath: "/work/project",
  createdAt: "2026-07-24T05:00:00.000Z",
  updatedAt: "2026-07-24T06:00:00.000Z",
  messageCount: messages.length,
  detailState: "full",
  messages
});

const settingsStore: SettingsStore = {
  readSettings: async () => ({
    locale: "system",
    conversationTerminal: "default",
    skillSyncMethod: "symlink",
    skillStorageLocation: "appData",
    skillAutoCheckEnabled: true,
    skillAutoCheckIntervalMinutes: 60,
    backupRetentionDays: null,
    enabledTargetIds: ["codex", "opencode"]
  }),
  updateSettings: async () => {
    throw new Error("not used");
  }
};

describe("conversation service", () => {
  it("refreshes incrementally, isolates Agent failures, and never mutates history", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-service-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const history = join(root, "source-history.jsonl");
    await writeFile(history, "source-owned data\n");
    const before = await readFile(history, "utf8");
    const candidate = sourceCandidate(history);
    const read = vi.fn(async () => sourceDetail());
    const codex = {
      ...createCodexTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({
          candidates: [candidate],
          complete: false,
          failures: ["One neighboring history could not be read"]
        }),
        read
      }
    };
    const opencode = {
      ...createOpenCodeTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => {
          throw new Error("OpenCode history unavailable");
        },
        read: async () => sourceDetail()
      }
    };
    const registry = createTargetRegistry([codex, opencode]);
    const targets = [
      makeTarget(codex, paths.homeDir),
      makeTarget(opencode, paths.homeDir)
    ];
    const service = await createConversationService({
      paths,
      targetRegistry: registry,
      targetDiscoveryService: { listTargets: async () => targets },
      settingsStore,
      clipboard: { writeText: vi.fn() },
      launcher: { launch: vi.fn() }
    });

    const first = await service.refresh();
    const second = await service.refresh();

    expect(first).toMatchObject({
      indexed: 1,
      unchanged: 0,
      failures: [
        { agentId: "codex", message: "One neighboring history could not be read" },
        { agentId: "opencode", message: "OpenCode history unavailable" }
      ]
    });
    expect(second).toMatchObject({ indexed: 0, unchanged: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    expect((await service.list()).refreshRequired).toBe(false);
    expect((await service.list({ query: "failing step" })).items).toHaveLength(1);
    expect(await service.list({ agentIds: ["disabled-agent"] })).toEqual({
      items: [],
      total: 0,
      workspacePaths: [],
      agentCounts: { codex: 1 },
      refreshRequired: false
    });
    expect(await readFile(history, "utf8")).toBe(before);
    service.dispose();
  });

  it("requests one discovery refresh for a populated index created by an older adapter set", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-upgrade-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const candidate = sourceCandidate(join(root, "source-history.jsonl"));
    const codex = {
      ...createCodexTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({ candidates: [candidate], complete: true }),
        read: async () => sourceDetail()
      }
    };
    const service = await createConversationService({
      paths,
      targetRegistry: createTargetRegistry([codex]),
      targetDiscoveryService: {
        listTargets: async () => [makeTarget(codex, paths.homeDir)]
      },
      settingsStore: {
        ...settingsStore,
        readSettings: async () => ({
          ...await settingsStore.readSettings(),
          enabledTargetIds: ["codex"]
        })
      },
      clipboard: { writeText: vi.fn() },
      launcher: { launch: vi.fn() }
    });

    await service.refresh();
    service.dispose();

    const database = new DatabaseSync(paths.conversationIndexPath);
    database.prepare(
      "DELETE FROM conversation_index_metadata WHERE key = 'discovery-version'"
    ).run();
    database.close();

    const upgraded = await createConversationService({
      paths,
      targetRegistry: createTargetRegistry([codex]),
      targetDiscoveryService: {
        listTargets: async () => [makeTarget(codex, paths.homeDir)]
      },
      settingsStore: {
        ...settingsStore,
        readSettings: async () => ({
          ...await settingsStore.readSettings(),
          enabledTargetIds: ["codex"]
        })
      },
      clipboard: { writeText: vi.fn() },
      launcher: { launch: vi.fn() }
    });

    expect(await upgraded.list()).toMatchObject({
      total: 1,
      refreshRequired: true
    });
    await upgraded.refresh();
    expect((await upgraded.list()).refreshRequired).toBe(false);
    upgraded.dispose();
  });

  it("coalesces repeated database lock failures and keeps the last-good index", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-lock-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    let locked = false;
    const candidates = () => ["session-1", "session-2"].map((recordId) => ({
      ...sourceCandidate(join(root, `${recordId}.db`)),
      recordId,
      source: {
        version: locked ? "v2" : "v1",
        locator: join(root, `${recordId}.db`)
      },
      providerSession: {
        kind: "database" as const,
        id: recordId,
        resumeLocator: recordId
      }
    }));
    const opencode = {
      ...createOpenCodeTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({ candidates: candidates(), complete: true }),
        read: async (
          _context: AgentConversationContext,
          candidate: AgentConversationCandidate
        ) => {
          if (locked) throw new Error("database is locked");
          return {
            ...sourceDetail(),
            sourceId: candidate.recordId
          };
        }
      }
    };
    const service = await createConversationService({
      paths,
      targetRegistry: createTargetRegistry([opencode]),
      targetDiscoveryService: {
        listTargets: async () => [makeTarget(opencode, paths.homeDir)]
      },
      settingsStore,
      clipboard: { writeText: vi.fn() },
      launcher: { launch: vi.fn() }
    });

    await expect(service.refresh()).resolves.toMatchObject({ indexed: 2, failures: [] });
    locked = true;
    const refresh = await service.refresh();

    expect(refresh).toMatchObject({ indexed: 0, removed: 0 });
    expect(refresh.failures).toEqual([{
      agentId: "opencode",
      message: expect.stringContaining("2 conversations")
    }]);
    expect((await service.list()).items).toHaveLength(2);
    service.dispose();
  });

  it("yields to the Electron event loop while rebuilding a large local index", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-yield-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const candidates = Array.from({ length: 24 }, (_, index) => ({
      ...sourceCandidate(join(root, `history-${index}.jsonl`)),
      recordId: `session-${index}`,
      providerSession: {
        kind: "native" as const,
        id: `session-${index}`,
        resumeLocator: `session-${index}`
      }
    }));
    const codex = {
      ...createCodexTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({ candidates, complete: true }),
        read: async (
          _context: AgentConversationContext,
          candidate: AgentConversationCandidate
        ) => ({
          ...sourceDetail(),
          id: `codex:${candidate.recordId}`,
          sourceId: candidate.providerSession?.id ?? candidate.recordId
        })
      }
    };
    const service = await createConversationService({
      paths,
      targetRegistry: createTargetRegistry([codex]),
      targetDiscoveryService: {
        listTargets: async () => [makeTarget(codex, paths.homeDir)]
      },
      settingsStore: {
        ...settingsStore,
        readSettings: async () => ({
          ...(await settingsStore.readSettings()),
          enabledTargetIds: ["codex"]
        })
      },
      clipboard: { writeText: vi.fn() },
      launcher: { launch: vi.fn() }
    });

    let completed = false;
    const refresh = service.refresh().then(() => {
      completed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(completed).toBe(false);
    await refresh;
    expect((await service.list()).total).toBe(24);
    service.dispose();
  });

  it("keeps record identity separate from the provider resume session", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-identity-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const candidate: AgentConversationCandidate = {
      ...sourceCandidate(join(root, "history-file.jsonl")),
      recordId: "history-file",
      providerSession: {
        kind: "native",
        id: "filename-session",
        resumeLocator: "filename-session"
      }
    };
    let openedCandidate: AgentConversationCandidate | undefined;
    const codex = {
      ...createCodexTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({ candidates: [candidate], complete: true }),
        read: async () => ({
          ...sourceDetail(),
          id: "codex:history-file",
          sourceId: "provider-session"
        }),
        openOriginal: (
          _context: AgentConversationContext,
          input: AgentConversationCandidate
        ) => {
          openedCandidate = input;
          return {
            executablePath: "/usr/local/bin/codex",
            args: ["resume", input.providerSession?.resumeLocator ?? input.recordId]
          };
        }
      }
    };
    const registry = createTargetRegistry([codex]);
    const service = await createConversationService({
      paths,
      targetRegistry: registry,
      targetDiscoveryService: {
        listTargets: async () => [makeTarget(codex, paths.homeDir)]
      },
      settingsStore,
      clipboard: { writeText: vi.fn() },
      launcher: { launch: vi.fn() }
    });

    await service.refresh();
    expect((await service.list()).items[0]).toMatchObject({
      id: "codex:history-file",
      sourceId: "provider-session"
    });
    await service.openOriginal("codex:history-file");
    expect(openedCandidate).toMatchObject({
      recordId: "history-file",
      providerSession: {
        id: "provider-session",
        resumeLocator: "provider-session"
      }
    });
    service.dispose();
  });

  it("retains the last-good indexed conversation when a changed source cannot be parsed", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-last-good-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const candidate = sourceCandidate(join(root, "history.jsonl"));
    let version = "v1";
    let failRead = false;
    let sourceObserved = true;
    const codex = {
      ...createCodexTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({
          candidates: sourceObserved
            ? [{
                ...candidate,
                source: { ...candidate.source, version }
              }]
            : [],
          complete: sourceObserved
        }),
        read: async () => {
          if (failRead) throw new Error("Source is temporarily unreadable");
          return sourceDetail();
        }
      }
    };
    const registry = createTargetRegistry([codex]);
    const service = await createConversationService({
      paths,
      targetRegistry: registry,
      targetDiscoveryService: {
        listTargets: async () => [makeTarget(codex, paths.homeDir)]
      },
      settingsStore,
      clipboard: { writeText: vi.fn() },
      launcher: { launch: vi.fn() }
    });

    await service.refresh();
    version = "v2";
    failRead = true;
    const refresh = await service.refresh();

    expect(refresh).toMatchObject({ indexed: 0, removed: 0 });
    expect(refresh.failures[0].message).toContain("temporarily unreadable");
    expect((await service.list()).items).toHaveLength(1);
    sourceObserved = false;
    failRead = false;
    const unavailableRefresh = await service.refresh();
    expect(unavailableRefresh.removed).toBe(0);
    expect((await service.list()).items).toHaveLength(1);
    service.dispose();
  });

  it("uses a private context file and keeps transcript text out of launch arguments", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-continue-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const candidate = sourceCandidate(join(root, "history.jsonl"));
    const codex = {
      ...createCodexTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({ candidates: [candidate], complete: true }),
        read: async () => sourceDetail()
      }
    };
    const opencode = createOpenCodeTargetAdapter();
    const registry = createTargetRegistry([codex, opencode]);
    const targets = [
      makeTarget(codex, paths.homeDir),
      makeTarget(opencode, paths.homeDir)
    ];
    const launched: ConversationLaunchSpec[] = [];
    const service = await createConversationService({
      paths,
      targetRegistry: registry,
      targetDiscoveryService: { listTargets: async () => targets },
      settingsStore,
      clipboard: { writeText: vi.fn() },
      launcher: { launch: async (spec) => { launched.push(spec); } }
    });
    await service.refresh();

    const preview = await service.previewContinuation({
      conversationId: "codex:session-1",
      targetId: "opencode"
    });
    expect(preview).toMatchObject({
      mode: "context-file",
      requiresReview: false,
      portableMessageCount: 2
    });

    const result = await service.continue(preview.previewId);
    const contextPath = launched[0].args[
      launched[0].args.indexOf("--file") + 1
    ];

    expect(result.mode).toBe("context-file");
    expect(launched).toHaveLength(1);
    expect(launched[0].args.join(" ")).not.toContain("failing step");
    expect(await readFile(contextPath, "utf8")).toContain("I found the failing step.");
    expect((await stat(contextPath)).mode & 0o777).toBe(0o600);
    await expect(service.previewContinuation({
      conversationId: "codex:session-1",
      targetId: "codex"
    })).rejects.toThrow("Choose a different Agent");
    service.dispose();
  });

  it("requires review and redacts sensitive-looking values", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-redact-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const candidate = sourceCandidate(join(root, "history.jsonl"));
    const codex = {
      ...createCodexTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({ candidates: [candidate], complete: true }),
        read: async () => sourceDetail([
          {
            id: "u1",
            role: "user",
            text: "api_key = \"sk-1234567890abcdefgh\""
          }
        ])
      }
    };
    const opencode = createOpenCodeTargetAdapter();
    const registry = createTargetRegistry([codex, opencode]);
    const targets = [
      makeTarget(codex, paths.homeDir),
      makeTarget(opencode, paths.homeDir)
    ];
    let launchSpec: ConversationLaunchSpec | undefined;
    const service = await createConversationService({
      paths,
      targetRegistry: registry,
      targetDiscoveryService: { listTargets: async () => targets },
      settingsStore,
      clipboard: { writeText: vi.fn() },
      launcher: { launch: async (spec) => { launchSpec = spec; } }
    });
    await service.refresh();

    const preview = await service.previewContinuation({
      conversationId: "codex:session-1",
      targetId: "opencode"
    });
    expect(preview.sensitiveValuesRedacted).toBe(true);
    expect(preview.requiresReview).toBe(true);
    expect(preview.warnings).toContain(
      "Sensitive-looking values will be redacted before transfer"
    );

    await service.continue(preview.previewId);
    const contextPath = launchSpec!.args[launchSpec!.args.indexOf("--file") + 1];
    const content = await readFile(contextPath, "utf8");
    expect(content).toContain("<redacted>");
    expect(content).not.toContain("sk-1234567890abcdefgh");
    expect(content).toContain("untrusted historical data");
    expect(content).toContain("Current repository files");
    service.dispose();
  });

  it("opens Codex with a private context file and a clipboard fallback", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-codex-fallback-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const candidate = sourceCandidate(join(root, "history.jsonl"));
    const opencode = {
      ...createOpenCodeTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({ candidates: [candidate], complete: true }),
        read: async () => ({
          ...sourceDetail(),
          id: "opencode:session-1",
          agentId: "opencode",
          agentName: "OpenCode"
        })
      }
    };
    const codex = createCodexTargetAdapter();
    const clipboard = { writeText: vi.fn() };
    const launched: ConversationLaunchSpec[] = [];
    const service = await createConversationService({
      paths,
      targetRegistry: createTargetRegistry([codex, opencode]),
      targetDiscoveryService: {
        listTargets: async () => [
          makeTarget(codex, paths.homeDir),
          makeTarget(opencode, paths.homeDir)
        ]
      },
      settingsStore,
      clipboard,
      launcher: { launch: async (spec) => { launched.push(spec); } }
    });
    await service.refresh();

    const preview = await service.previewContinuation({
      conversationId: "opencode:session-1",
      targetId: "codex"
    });
    expect(preview).toMatchObject({
      mode: "context-file",
      requiresReview: false,
      warnings: []
    });

    const result = await service.continue(preview.previewId);
    const contextPath = join(
      paths.conversationHandoffDir,
      `${preview.previewId}.md`
    );

    expect(result).toEqual({
      mode: "context-file",
      message: "Opened Codex with context; paste the fallback copy if needed"
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("I found the failing step.")
    );
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({
      executablePath: "/usr/local/bin/codex",
      cwd: "/work/project"
    });
    expect(launched[0].args.join(" ")).toContain(contextPath);
    expect(launched[0].args.join(" ")).not.toContain("I found the failing step.");
    await expect(readFile(contextPath, "utf8")).resolves.toContain(
      "I found the failing step."
    );
    service.dispose();
  });

  it("preserves the source working directory in a generic clipboard fallback", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-generic-fallback-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const candidate = sourceCandidate(join(root, "history.jsonl"));
    const codex = {
      ...createCodexTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({ candidates: [candidate], complete: true }),
        read: async () => sourceDetail()
      }
    };
    const opencode = {
      ...createOpenCodeTargetAdapter(),
      conversations: undefined
    };
    const launched: ConversationLaunchSpec[] = [];
    const clipboard = { writeText: vi.fn() };
    const service = await createConversationService({
      paths,
      targetRegistry: createTargetRegistry([codex, opencode]),
      targetDiscoveryService: {
        listTargets: async () => [
          makeTarget(codex, paths.homeDir),
          makeTarget(opencode, paths.homeDir)
        ]
      },
      settingsStore,
      clipboard,
      launcher: { launch: async (spec) => { launched.push(spec); } }
    });
    await service.refresh();

    const preview = await service.previewContinuation({
      conversationId: "codex:session-1",
      targetId: "opencode"
    });
    expect(preview).toMatchObject({
      mode: "clipboard",
      workspacePath: "/work/project",
      workspacePreservation: "preserved",
      requiresReview: true
    });

    await service.continue(preview.previewId);
    expect(launched).toEqual([
      expect.objectContaining({
        executablePath: "/usr/local/bin/opencode",
        args: [],
        cwd: "/work/project"
      })
    ]);
    expect(clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Workspace: /work/project")
    );
    service.dispose();
  });

  it("removes private context when the target cannot be launched", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-launch-failure-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home"),
      conversationIndexPath: join(root, "cache", "conversations.sqlite"),
      conversationHandoffDir: join(root, "cache", "handoffs")
    });
    const candidate = sourceCandidate(join(root, "history.jsonl"));
    const codex = {
      ...createCodexTargetAdapter(),
      conversations: {
        historyDetail: "full" as const,
        discover: async () => ({ candidates: [candidate], complete: true }),
        read: async () => sourceDetail()
      }
    };
    const opencode = createOpenCodeTargetAdapter();
    const registry = createTargetRegistry([codex, opencode]);
    const targets = [
      makeTarget(codex, paths.homeDir),
      makeTarget(opencode, paths.homeDir)
    ];
    const service = await createConversationService({
      paths,
      targetRegistry: registry,
      targetDiscoveryService: { listTargets: async () => targets },
      settingsStore,
      clipboard: { writeText: vi.fn() },
      launcher: { launch: async () => { throw new Error("Terminal unavailable"); } }
    });
    await service.refresh();
    const preview = await service.previewContinuation({
      conversationId: "codex:session-1",
      targetId: "opencode"
    });

    await expect(service.continue(preview.previewId)).rejects.toThrow(
      "Terminal unavailable"
    );
    await expect(readFile(join(
      paths.conversationHandoffDir,
      `${preview.previewId}.md`
    ), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    service.dispose();
  });
});
