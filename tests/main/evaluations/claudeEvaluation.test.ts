import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCodeTargetAdapter } from "../../../src/main/targets/claudeCodeTarget";
import { createClaudeEvaluationCapability } from "../../../src/main/targets/evaluations/claudeEvaluation";
import type { ProfileDetail } from "../../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const profile: ProfileDetail = {
  id: "claude-eval",
  manifest: { id: "claude-eval", name: "Claude eval", description: "", version: 2 },
  instructions: "# Claude eval\n",
  resources: {
    skills: [],
    managementByTarget: {
      "claude-code": { instructions: "manage", skills: "manage" }
    },
    mcpByTarget: {
      "claude-code": { mode: "disable", selections: [] }
    }
  }
};

describe("Claude Code evaluation capability", () => {
  it("creates a non-persistent isolated launch and copies only the credential file", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-eval-"));
    const sourceHome = join(root, "source");
    const evaluationHome = join(root, "run", "home");
    const project = join(root, "run", "project");
    const temp = join(root, "run", "temp");
    const adapter = createClaudeCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: sourceHome });
    const evaluationPaths = adapter.createTargetPaths({ homeDir: evaluationHome });
    await Promise.all([
      mkdir(sourcePaths.configDir, { recursive: true }),
      mkdir(project, { recursive: true })
    ]);
    await writeFile(join(sourcePaths.configDir, ".credentials.json"), "{\"oauth\":\"secret\"}\n");
    await writeFile(sourcePaths.configPath, "{\"theme\":\"dark\"}\n");

    const capability = createClaudeEvaluationCapability();
    const spec = await capability.createLaunchSpec({
      profile,
      targetPaths: sourcePaths,
      sourceHomeDir: sourceHome,
      executablePath: process.execPath,
      knownCliVersion: "2.1.214",
      excludeMcp: true,
      platform: process.platform,
      environment: { PATH: process.env.PATH },
      evaluationHome,
      evaluationProject: project,
      evaluationTargetPaths: evaluationPaths,
      evaluationTempDir: temp,
      prompt: "Update docs"
    });

    expect(adapter.descriptor.capabilities.evaluation).toBe(true);
    expect(spec.args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
      "--no-chrome",
      "Update docs"
    ]);
    expect(spec.env.CLAUDE_CONFIG_DIR).toBe(evaluationPaths.configDir);
    expect(await readFile(join(evaluationPaths.configDir, ".credentials.json"), "utf8"))
      .toBe('{"oauth":"secret"}\n');
    await expect(readFile(evaluationPaths.configPath, "utf8")).rejects.toThrow();
  });

  it("parses assistant text and reported usage from stream JSON", () => {
    const event = createClaudeEvaluationCapability().parseEvent(JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-test",
        content: [{ type: "text", text: "Done" }],
        usage: { input_tokens: 20, cache_read_input_tokens: 8, output_tokens: 4 }
      }
    }));
    expect(event).toEqual({
      type: "response",
      text: "Done",
      model: "claude-test",
      usage: { inputTokens: 20, cachedInputTokens: 8, outputTokens: 4 }
    });
  });
});
