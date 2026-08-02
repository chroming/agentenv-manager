import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiEvaluationCapability } from "../../../src/main/targets/evaluations/piEvaluation";
import { createPiTargetAdapter } from "../../../src/main/targets/integrations/pi";
import type { ProfileDetail } from "../../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const profile: ProfileDetail = {
  id: "pi-eval",
  manifest: { id: "pi-eval", name: "Pi eval", description: "", version: 2 },
  instructions: "# Pi eval\n",
  resources: { skills: [], mcpByTarget: {} }
};

describe("Pi evaluation capability", () => {
  it("creates an ephemeral JSON launch with isolated model and auth state", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-pi-eval-"));
    const sourceHome = join(root, "source");
    const evaluationHome = join(root, "run", "home");
    const project = join(root, "run", "project");
    const temp = join(root, "run", "temp");
    const adapter = createPiTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: sourceHome, environment: {} });
    const evaluationPaths = adapter.createTargetPaths({ homeDir: evaluationHome, environment: {} });
    await Promise.all([
      mkdir(sourcePaths.configDir, { recursive: true }),
      mkdir(project, { recursive: true })
    ]);
    await writeFile(join(sourcePaths.configDir, "auth.json"), "{\"provider\":\"secret\"}\n");
    await writeFile(join(sourcePaths.configDir, "models-store.json"), "{}\n");
    await writeFile(sourcePaths.configPath, JSON.stringify({
      defaultProvider: "openai",
      defaultModel: "test-model",
      extensions: ["/private/external-extension.js"]
    }));

    const spec = await createPiEvaluationCapability().createLaunchSpec({
      profile,
      targetPaths: sourcePaths,
      sourceHomeDir: sourceHome,
      executablePath: process.execPath,
      knownCliVersion: "0.83.0",
      excludeMcp: true,
      platform: process.platform,
      environment: {},
      evaluationHome,
      evaluationProject: project,
      evaluationTargetPaths: evaluationPaths,
      evaluationTempDir: temp,
      prompt: "Refactor"
    });

    expect(adapter.descriptor.capabilities.evaluation).toBe(true);
    expect(spec.args).toEqual([
      "--mode", "json", "--print", "--no-session", "--no-extensions",
      "--no-prompt-templates", "--no-themes", "--approve", "Refactor"
    ]);
    expect(spec.env.PI_CODING_AGENT_DIR).toBe(evaluationPaths.configDir);
    expect(JSON.parse(await readFile(evaluationPaths.configPath, "utf8"))).toEqual({
      defaultProvider: "openai",
      defaultModel: "test-model"
    });
  });

  it("parses assistant output, model, tokens, and reported cost", () => {
    const event = createPiEvaluationCapability().parseEvent(JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        model: "pi-model",
        content: [{ type: "text", text: "Finished" }],
        usage: {
          input: 50,
          output: 12,
          cacheRead: 20,
          totalTokens: 82,
          cost: { total: 0.01 }
        }
      }
    }));
    expect(event).toEqual({
      type: "response",
      text: "Finished",
      model: "pi-model",
      usage: {
        inputTokens: 50,
        cachedInputTokens: 20,
        outputTokens: 12,
        totalTokens: 82,
        reportedCostUsd: 0.01
      }
    });
  });
});
