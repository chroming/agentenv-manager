import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProfileDetail } from "../../../src/shared/types";
import { createCodexTargetAdapter } from "../../../src/main/targets/codexTarget";
import { createCodexEvaluationCapability } from "../../../src/main/targets/evaluations/codexEvaluation";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const profile = (mode: "ignore" | "manage" | "disable" = "disable"): ProfileDetail => ({
  id: "codex-evaluation",
  manifest: {
    id: "codex-evaluation",
    name: "Codex evaluation",
    description: "",
    preferredTargetId: "codex",
    version: 2
  },
  instructions: "# Evaluation instructions\n",
  resources: {
    skills: [],
    managementByTarget: {
      codex: { instructions: "manage", skills: "manage" }
    },
    mcpByTarget: {
      codex: {
        mode,
        selections: mode === "manage"
          ? [{ name: "docs", enabled: true }]
          : []
      }
    }
  },
  contentHash: "profile-hash"
});

describe("Codex evaluation capability", () => {
  it("creates an ephemeral isolated Codex launch without loading native config", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-evaluation-"));
    const sourceHome = join(root, "source-home");
    const evaluationHome = join(root, "run", "home");
    const project = join(root, "run", "project");
    const temp = join(root, "run", "temp");
    const adapter = createCodexTargetAdapter();
    expect(adapter.descriptor.capabilities.evaluation).toBe(true);
    expect(adapter.evaluations).toBeDefined();
    const sourcePaths = adapter.createTargetPaths({ homeDir: sourceHome });
    const evaluationPaths = adapter.createTargetPaths({ homeDir: evaluationHome });
    await Promise.all([
      mkdir(sourcePaths.configDir, { recursive: true }),
      mkdir(project, { recursive: true }),
      mkdir(temp, { recursive: true })
    ]);
    await writeFile(join(sourcePaths.configDir, "auth.json"), "{\"token\":\"secret\"}\n");
    await writeFile(sourcePaths.configPath, 'model = "gpt-5"\n[mcp_servers.docs]\ncommand = "docs"\n');

    const capability = createCodexEvaluationCapability();
    const spec = await capability.createLaunchSpec({
      profile: profile(),
      targetPaths: sourcePaths,
      sourceHomeDir: sourceHome,
      executablePath: process.execPath,
      knownCliVersion: "codex-cli 0.145.0",
      excludeMcp: true,
      platform: process.platform,
      environment: { PATH: process.env.PATH },
      evaluationHome,
      evaluationProject: project,
      evaluationTargetPaths: evaluationPaths,
      evaluationTempDir: temp,
      prompt: "Update the README"
    });

    expect(spec.args).toEqual([
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      "--cd",
      project,
      "Update the README"
    ]);
    expect(spec.env.CODEX_HOME).toBe(evaluationPaths.configDir);
    expect(await readFile(join(evaluationPaths.configDir, "auth.json"), "utf8"))
      .toBe('{"token":"secret"}\n');
    expect(spec.fidelity).toBe("full");
    expect(spec.warnings).toEqual([]);
    expect(capability.projectResourcePaths).toEqual([
      "AGENTS.md",
      "AGENTS.override.md",
      ".agents",
      ".codex"
    ]);
  });

  it("reports excluded native MCPs as a partial comparison", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-evaluation-"));
    const sourceHome = join(root, "source-home");
    const adapter = createCodexTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: sourceHome });
    await mkdir(sourcePaths.configDir, { recursive: true });
    await writeFile(sourcePaths.configPath, '[mcp_servers.docs]\ncommand = "docs"\n');

    const availability = await createCodexEvaluationCapability().checkAvailability({
      profile: profile("ignore"),
      targetPaths: sourcePaths,
      sourceHomeDir: sourceHome,
      executablePath: process.execPath,
      knownCliVersion: "codex-cli 0.145.0",
      excludeMcp: true,
      platform: process.platform,
      environment: {}
    });

    expect(availability).toMatchObject({
      available: true,
      fidelity: "partial",
      mcpIncludedCount: 0,
      mcpOmittedCount: 1,
      warnings: ["MCP configurations are excluded from isolated Profile comparison"]
    });
  });

  it("parses Codex JSONL response, usage, and error events", () => {
    const capability = createCodexEvaluationCapability();
    expect(capability.parseEvent(JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Done" }
    }))).toEqual({ type: "response", text: "Done" });
    expect(capability.parseEvent(JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 40,
        output_tokens: 12,
        reasoning_output_tokens: 3
      }
    }))).toEqual({
      type: "usage",
      usage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 12,
        reasoningTokens: 3
      }
    });
    expect(capability.parseEvent(JSON.stringify({
      type: "turn.failed",
      error: { message: "Model unavailable" }
    }))).toEqual({ type: "error", message: "Model unavailable" });
  });
});
