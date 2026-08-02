import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityEvaluationCapability } from "../../../src/main/targets/evaluations/antigravityEvaluation";
import { createAntigravityTargetAdapter } from "../../../src/main/targets/integrations/antigravity";
import type { ProfileDetail } from "../../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const profile: ProfileDetail = {
  id: "agy-eval",
  manifest: { id: "agy-eval", name: "Agy eval", description: "", version: 2 },
  instructions: "# Antigravity eval\n",
  resources: { skills: [], mcpByTarget: {} }
};

describe("Antigravity evaluation capability", () => {
  it("creates an isolated one-shot launch with a minimal OAuth copy", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-agy-eval-"));
    const sourceHome = join(root, "source");
    const evaluationHome = join(root, "run", "home");
    const project = join(root, "run", "project");
    const temp = join(root, "run", "temp");
    const adapter = createAntigravityTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: sourceHome });
    const evaluationPaths = adapter.createTargetPaths({ homeDir: evaluationHome });
    const sourceRuntime = join(dirname(sourcePaths.configDir), "antigravity-cli");
    await Promise.all([
      mkdir(sourceRuntime, { recursive: true }),
      mkdir(project, { recursive: true })
    ]);
    await writeFile(join(sourceRuntime, "antigravity-oauth-token"), "secret-token\n");
    await writeFile(join(sourceRuntime, "installation_id"), "installation\n");

    const spec = await createAntigravityEvaluationCapability().createLaunchSpec({
      profile,
      targetPaths: sourcePaths,
      sourceHomeDir: sourceHome,
      executablePath: process.execPath,
      knownCliVersion: "1.1.4",
      excludeMcp: true,
      platform: process.platform,
      environment: {},
      evaluationHome,
      evaluationProject: project,
      evaluationTargetPaths: evaluationPaths,
      evaluationTempDir: temp,
      prompt: "Fix tests"
    });

    expect(adapter.descriptor.capabilities.evaluation).toBe(true);
    expect(spec.args).toContain("--print");
    expect(spec.args).toContain("Fix tests");
    expect(spec.args).toContain("--new-project");
    expect(await readFile(
      join(dirname(evaluationPaths.configDir), "antigravity-cli", "antigravity-oauth-token"),
      "utf8"
    )).toBe("secret-token\n");
    expect(spec.env.HOME).toBe(evaluationHome);
  });

  it("keeps plain print output while removing terminal escape sequences", () => {
    expect(createAntigravityEvaluationCapability().parseEvent("\u001b[32mDone\u001b[0m"))
      .toEqual({ type: "response", text: "Done\n" });
  });
});
