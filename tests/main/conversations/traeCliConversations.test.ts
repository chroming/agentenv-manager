import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTraeCliConversationCapability } from "../../../src/main/targets/conversations/traeCliConversations";
import type { AgentConversationContext } from "../../../src/main/targets/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-trae-conversations-"));
  const configDir = join(root, ".trae");
  const runtimeDir = join(configDir, "cli");
  await mkdir(runtimeDir, { recursive: true });
  const context: AgentConversationContext = {
    homeDir: root,
    executablePath: "/usr/local/bin/traecli",
    targetPaths: {
      targetId: "trae-cli",
      configDir,
      runtimeDir,
      instructionsPath: join(configDir, "rules", "agentenv-manager.md"),
      configPath: join(configDir, "traecli.toml"),
      skillsDir: join(configDir, "skills")
    }
  };
  return { context, runtimeDir };
};

const rollout = (options: {
  id: string;
  cwd: string;
  timestamp?: string;
  user: string;
  assistant?: string;
}) => [
  JSON.stringify({
    timestamp: options.timestamp ?? "2026-07-27T04:11:52.981Z",
    type: "session_meta",
    payload: {
      id: options.id,
      cwd: options.cwd,
      originator: "codex-tui",
      cli_version: "0.200.19",
      model_provider: "trae"
    }
  }),
  JSON.stringify({
    type: "turn_context",
    payload: { cwd: options.cwd, model: "openrouter-3o" }
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: options.user }]
    }
  }),
  ...(options.assistant
    ? [JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: options.assistant }]
        }
      })]
    : []),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "Read",
      arguments: "{}",
      call_id: "tool-1"
    }
  })
].join("\n") + "\n";

describe("Trae CLI V2 conversations", () => {
  it("discovers rollout histories and excludes artifacts and prompt history", async () => {
    const { context, runtimeDir } = await setup();
    const sessionDir = join(runtimeDir, "sessions", "2026", "07", "27");
    const archivedDir = join(runtimeDir, "archived_sessions");
    const sessionPath = join(
      sessionDir,
      "rollout-2026-07-27T12-11-26-019fa1c5-3f8c-7fe0-bfd7-1d4cdf9361a3.jsonl"
    );
    const archivedPath = join(
      archivedDir,
      "rollout-2026-07-20T10-00-00-11111111-1111-4111-8111-111111111111.jsonl"
    );
    await mkdir(
      `${sessionPath.replace(/\.jsonl$/, "")}.artifacts/background-tasks`,
      { recursive: true }
    );
    await mkdir(archivedDir, { recursive: true });
    await writeFile(sessionPath, rollout({
      id: "019fa1c5-3f8c-7fe0-bfd7-1d4cdf9361a3",
      cwd: "/work/current",
      user: "Continue the Trae CLI integration"
    }));
    await writeFile(archivedPath, rollout({
      id: "11111111-1111-4111-8111-111111111111",
      cwd: "/work/archive",
      user: "Archived Trae task"
    }));
    await writeFile(
      join(
        `${sessionPath.replace(/\.jsonl$/, "")}.artifacts`,
        "rollout-fake.jsonl"
      ),
      rollout({ id: "fake", cwd: "/tmp", user: "Must not appear" })
    );
    await writeFile(join(runtimeDir, "history.jsonl"), '{"text":"prompt only"}\n');

    const capability = createTraeCliConversationCapability();
    const discovery = await capability.discover(context);

    expect(discovery.complete).toBe(true);
    expect(discovery.candidates).toHaveLength(2);
    expect(discovery.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recordId: "019fa1c5-3f8c-7fe0-bfd7-1d4cdf9361a3",
        archived: false,
        source: {
          locator: sessionPath,
          runtimeHome: runtimeDir,
          version: expect.any(String)
        }
      }),
      expect.objectContaining({
        recordId: "11111111-1111-4111-8111-111111111111",
        archived: true
      })
    ]));
  });

  it("reads visible messages, top-level time, provider identity, and workspace", async () => {
    const { context, runtimeDir } = await setup();
    const sessionDir = join(runtimeDir, "sessions", "2026", "07", "27");
    const sourcePath = join(
      sessionDir,
      "rollout-2026-07-27T12-11-26-019fa1c5-3f8c-7fe0-bfd7-1d4cdf9361a3.jsonl"
    );
    await mkdir(sessionDir, { recursive: true });
    await writeFile(sourcePath, rollout({
      id: "019fa1c5-3f8c-7fe0-bfd7-1d4cdf9361a3",
      cwd: "/work/trae-v2",
      timestamp: "2026-07-27T04:11:52.981Z",
      user: "Implement the current Trae layout",
      assistant: "The V2 adapter is ready."
    }));

    const capability = createTraeCliConversationCapability();
    const candidate = (await capability.discover(context)).candidates[0];
    const detail = await capability.read(context, candidate);

    expect(detail).toMatchObject({
      id: "trae-cli:019fa1c5-3f8c-7fe0-bfd7-1d4cdf9361a3",
      agentId: "trae-cli",
      agentName: "Trae CLI",
      sourceId: "019fa1c5-3f8c-7fe0-bfd7-1d4cdf9361a3",
      workspacePath: "/work/trae-v2",
      createdAt: "2026-07-27T04:11:52.981Z",
      messageCount: 2
    });
    expect(detail.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Implement the current Trae layout" },
      { role: "assistant", text: "The V2 adapter is ready." }
    ]);
  });

  it("reads only an appended JSONL tail after the initial index", async () => {
    const { context, runtimeDir } = await setup();
    const sessionDir = join(runtimeDir, "sessions", "2026", "07", "27");
    const sourcePath = join(
      sessionDir,
      "rollout-2026-07-27T12-11-26-019fa1c5-3f8c-7fe0-bfd7-1d4cdf9361a3.jsonl"
    );
    await mkdir(sessionDir, { recursive: true });
    await writeFile(sourcePath, rollout({
      id: "019fa1c5-3f8c-7fe0-bfd7-1d4cdf9361a3",
      cwd: "/work/trae-v2",
      user: "First message"
    }));
    const capability = createTraeCliConversationCapability();
    const firstCandidate = (await capability.discover(context)).candidates[0];
    const first = await capability.read(context, firstCandidate);

    await appendFile(sourcePath, `${JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Appended response" }]
      }
    })}\n`);
    const nextCandidate = (await capability.discover(context)).candidates[0];
    const next = await capability.read(context, nextCandidate, {
      detail: first,
      sourceVersion: firstCandidate.source.version
    });

    expect(next.messages.map((message) => message.text)).toEqual([
      "First message",
      "Appended response"
    ]);
  });

  it("resumes the native session with its config and runtime homes", async () => {
    const { context, runtimeDir } = await setup();
    const capability = createTraeCliConversationCapability();
    const spec = capability.openOriginal!(context, {
      recordId: "record",
      source: {
        locator: "/tmp/rollout.jsonl",
        version: "1",
        runtimeHome: runtimeDir
      },
      providerSession: {
        kind: "native",
        id: "provider-session",
        resumeLocator: "provider-session"
      },
      workspacePath: "/work/trae-v2",
      updatedAt: "2026-07-27T04:11:52.981Z",
      detailState: "full"
    });

    expect(spec).toEqual({
      executablePath: "/usr/local/bin/traecli",
      args: ["resume", "provider-session"],
      cwd: "/work/trae-v2",
      env: {
        TRAE_HOME: context.targetPaths.configDir,
        TRAECLI_HOME: runtimeDir
      }
    });
  });

  it("keeps legacy layout history unavailable instead of reading another product", async () => {
    const { context } = await setup();
    context.targetPaths.runtimeDir = undefined;

    await expect(createTraeCliConversationCapability().discover(context)).resolves.toEqual({
      candidates: [],
      complete: false
    });
  });
});
