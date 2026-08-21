import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenCodeEvaluationCapability } from "../../../src/main/targets/evaluations/opencodeEvaluation";
import { createOpenCodeTargetAdapter } from "../../../src/main/targets/opencodeTarget";
import type { ProfileDetail } from "../../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const profile = (mcp: ProfileDetail["resources"]["mcpByTarget"][string]): ProfileDetail => ({
  id: "evaluation-profile",
  manifest: {
    id: "evaluation-profile",
    name: "Evaluation Profile",
    description: "",
    preferredTargetId: "opencode",
    version: 2
  },
  instructions: "# Evaluate\n",
  resources: {
    skills: [],
    mcpByTarget: { opencode: mcp }
  }
});

describe("OpenCode evaluation capability", () => {
  it("parses response, usage, model, and error events without inventing totals", () => {
    const capability = createOpenCodeEvaluationCapability();

    expect(capability.parseEvent(JSON.stringify({
      type: "text",
      part: { text: "Finished" }
    }))).toEqual({ type: "response", text: "Finished" });
    expect(capability.parseEvent(JSON.stringify({
      type: "step_finish",
      part: {
        modelID: "openai/test-model",
        cost: 0.02,
        tokens: { input: 120, output: 30, reasoning: 4, cache: { read: 80 } }
      }
    }))).toEqual({
      type: "usage",
      model: "openai/test-model",
      usage: {
        inputTokens: 120,
        cachedInputTokens: 80,
        outputTokens: 30,
        reasoningTokens: 4,
        reportedCostUsd: 0.02
      }
    });
    expect(capability.parseEvent(JSON.stringify({
      type: "error",
      error: { data: { message: "Provider unavailable" } }
    }))).toEqual({ type: "error", message: "Provider unavailable" });
    expect(capability.parseEvent("ordinary stdout")).toBeUndefined();
  });

  it("keeps MCP definitions outside the local-only evaluation without blocking it", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-eval-"));
    const homeDir = join(root, "home");
    const adapter = createOpenCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.configPath, JSON.stringify({
      mcp: {
        docs: {
          type: "local",
          command: ["docs"],
          environment: { api_token: "sk-abcdefghijklmnop" }
        }
      }
    }));
    const capability = createOpenCodeEvaluationCapability();

    const availability = await capability.checkAvailability({
      profile: profile({
        mode: "manage",
        selections: [{ name: "docs", enabled: true }]
      }),
      targetPaths,
      sourceHomeDir: homeDir,
      executablePath: process.execPath,
      excludeMcp: false,
      platform: process.platform,
      environment: {}
    });

    expect(availability.available).toBe(true);
    expect(availability).toMatchObject({
      fidelity: "partial",
      mcpIncludedCount: 0,
      mcpOmittedCount: 1,
      requiresMcpExclusion: false
    });
    expect(availability.warnings.join(" ")).not.toContain("literal credentials");
  });

  it("writes an explicit local-only permission policy and never copies MCP definitions", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-eval-"));
    const sourceHome = join(root, "source-home");
    const evaluationHome = join(root, "run", "home");
    const project = join(root, "run", "project");
    const temp = join(root, "run", "tmp");
    const adapter = createOpenCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: sourceHome });
    const evaluationPaths = adapter.createTargetPaths({ homeDir: evaluationHome });
    await Promise.all([
      mkdir(sourcePaths.configDir, { recursive: true }),
      mkdir(project, { recursive: true })
    ]);
    await writeFile(sourcePaths.configPath, JSON.stringify({
      theme: "dark",
      mcp: {
        docs: {
          type: "local",
          command: ["docs"],
          environment: { token_env_var: "DOCS_TOKEN" }
        },
        browser: { type: "local", command: ["browser"] }
      }
    }));
    const capability = createOpenCodeEvaluationCapability();
    const selectedProfile = profile({
      mode: "manage",
      selections: [
        { name: "docs", enabled: true },
        { name: "browser", enabled: false }
      ]
    });

    const spec = await capability.createLaunchSpec({
      profile: selectedProfile,
      targetPaths: sourcePaths,
      sourceHomeDir: sourceHome,
      executablePath: process.execPath,
      excludeMcp: false,
      platform: process.platform,
      environment: { DOCS_TOKEN: "runtime-secret" },
      evaluationHome,
      evaluationProject: project,
      evaluationTargetPaths: evaluationPaths,
      evaluationTempDir: temp,
      prompt: "Update the README"
    });

    const written = JSON.parse(await readFile(evaluationPaths.configPath, "utf8"));
    expect(written).toEqual({
      permission: {
        "*": "deny",
        read: "allow",
        edit: "allow",
        glob: "allow",
        grep: "allow",
        skill: "allow",
        todowrite: "allow"
      }
    });
    expect(written).not.toHaveProperty("theme");
    expect(spec.args).toEqual([
      "run",
      "--format",
      "json",
      "--pure",
      "--auto",
      "--dir",
      project,
      "Update the README"
    ]);
    expect(spec.env.HOME).toBe(evaluationHome);
    expect(spec.env.DOCS_TOKEN).toBe("runtime-secret");
    expect(spec.fidelity).toBe("partial");
  });

  it.skipIf(process.platform !== "darwin")("probes the CLI version without allowing it to write", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-version-"));
    const markerPath = join(root, "version-probe-wrote.txt");
    const executablePath = join(root, "fake-opencode");
    await writeFile(
      executablePath,
      `#!/bin/sh\necho unsafe > ${JSON.stringify(markerPath)}\necho 9.9.9\n`
    );
    await chmod(executablePath, 0o700);
    const homeDir = join(root, "home");
    const adapter = createOpenCodeTargetAdapter();
    const capability = createOpenCodeEvaluationCapability();
    const sandboxAvailable = spawnSync("/usr/bin/sandbox-exec", [
      "-p",
      "(version 1) (allow default) (deny file-write*)",
      "/usr/bin/true"
    ], { stdio: "ignore" }).status === 0;

    const availability = await capability.checkAvailability({
      profile: profile({ mode: "disable", selections: [] }),
      targetPaths: adapter.createTargetPaths({ homeDir }),
      sourceHomeDir: homeDir,
      executablePath,
      excludeMcp: false,
      platform: process.platform,
      environment: {}
    });

    expect(availability.cliVersion).toBe(sandboxAvailable ? "9.9.9" : undefined);
    expect(existsSync(markerPath)).toBe(false);
  });
});
