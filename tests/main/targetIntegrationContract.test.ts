import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineTargetIntegration } from "../../src/main/targets/defineTargetIntegration";
import { createBuiltInTargetAdapters } from "../../src/main/targets/integrations";
import { createTargetRegistry } from "../../src/main/targets/registry";
import {
  createFixtureAgentAdapter,
  createFixtureProfile,
  fixtureAgentIntegration
} from "../fixtures/targets/fixtureAgent";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("target integration contract", () => {
  it("exposes a composed integration through the stable adapter facade", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-target-contract-"));
    const adapter = createFixtureAgentAdapter();
    const paths = adapter.createTargetPaths({ homeDir: root });
    const profile = createFixtureProfile(join(root, "profiles", "fixture-profile"), {
      instructions: "# Fixture instructions\n"
    });
    const installation = await adapter.detectInstallation({
      platform: "linux",
      homeDir: root,
      allowSystemApplicationLookup: false,
      findExecutable: async () => "/usr/local/bin/fixture-agent",
      pathExists: async () => false
    });

    expect(paths).toEqual(
      expect.objectContaining({
        targetId: "fixture-agent",
        configDir: join(root, ".fixture-agent")
      })
    );
    expect(installation.found).toBe(true);
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.instructionsPath, "# Live fixture\n", "utf8");
    await writeFile(paths.configPath, '{"live":true}\n', "utf8");
    await expect(adapter.captureProfile(paths)).resolves.toEqual(
      expect.objectContaining({
        instructions: "# Live fixture\n",
        mcpConnections: [],
        warnings: [],
        excluded: []
      })
    );
    await expect(adapter.validateAssets({ profile, targetPaths: paths })).resolves.toEqual([]);
    await expect(adapter.skills.readNativeState(paths)).resolves.toEqual({
      disabledRuntimeNames: [],
      issues: []
    });
    await expect(adapter.skills.inspectRuntime(paths)).resolves.toEqual({
      targetId: "fixture-agent",
      observations: [],
      issues: []
    });
    await expect(
      adapter.createPreview({
        profile,
        targetPaths: paths,
        state: { managedMcpNames: [] }
      })
    ).resolves.toEqual(expect.objectContaining({ changes: [], issues: [] }));
  });

  it("keeps registration ordered and returns defensive adapter lists", () => {
    const adapter = createFixtureAgentAdapter();
    const registry = createTargetRegistry([adapter]);
    const listed = registry.listAdapters();
    listed.length = 0;

    expect(registry.list().map((target) => target.id)).toEqual(["fixture-agent"]);
    expect(registry.get("fixture-agent")).toBe(adapter);
  });

  it("rejects duplicate target ids", () => {
    const adapter = createFixtureAgentAdapter();

    expect(() => createTargetRegistry([adapter, adapter])).toThrow(
      "Duplicate target id: fixture-agent"
    );
  });

  it("reports an unknown target id clearly", () => {
    const registry = createTargetRegistry([createFixtureAgentAdapter()]);

    expect(() => registry.get("missing-agent")).toThrow("Unknown target: missing-agent");
  });

  it("rejects integrations whose path driver returns another target id", () => {
    const adapter = defineTargetIntegration({
      ...fixtureAgentIntegration,
      paths: {
        createTargetPaths: (input) => ({
          ...fixtureAgentIntegration.paths.createTargetPaths(input),
          targetId: "another-agent"
        })
      }
    });

    expect(() => adapter.createTargetPaths({ homeDir: "/tmp" })).toThrow(
      "Target fixture-agent returned paths for another-agent."
    );
  });

  it("keeps built-in comparison declarations aligned with their adapters", () => {
    const adapters = createBuiltInTargetAdapters();
    const support = Object.fromEntries(adapters.map((adapter) => [
      adapter.descriptor.id,
      {
        declared: adapter.descriptor.capabilities.evaluation === true,
        implemented: Boolean(adapter.evaluations),
        reason: adapter.descriptor.capabilities.evaluationUnavailableReason
      }
    ]));

    expect(support).toEqual({
      opencode: { declared: true, implemented: true, reason: undefined },
      "claude-code": { declared: true, implemented: true, reason: undefined },
      codex: { declared: true, implemented: true, reason: undefined },
      antigravity: { declared: true, implemented: true, reason: undefined },
      "trae-cli": {
        declared: false,
        implemented: false,
        reason: "Trae CLI does not expose a verified one-shot command, so isolated comparison is unavailable."
      },
      pi: { declared: true, implemented: true, reason: undefined }
    });
  });

  it("declares ordered executable candidates for every built-in Agent", () => {
    const candidates = Object.fromEntries(
      createBuiltInTargetAdapters().map((adapter) => [
        adapter.descriptor.id,
        adapter.descriptor.executableCandidates
      ])
    );

    expect(candidates).toEqual({
      opencode: ["opencode"],
      "claude-code": ["claude"],
      codex: ["codex"],
      antigravity: ["agy"],
      "trae-cli": ["traecli", "trae-cli", "trae-agent"],
      pi: ["pi"]
    });
  });

  it("declares the honest Project support matrix for every built-in Agent", () => {
    const support = Object.fromEntries(
      createBuiltInTargetAdapters().map((adapter) => [
        adapter.descriptor.id,
        adapter.projects?.support
      ])
    );

    expect(support).toEqual({
      opencode: {
        instructions: { inspect: "supported", mutate: "supported" },
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "partial", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      },
      "claude-code": {
        instructions: { inspect: "supported", mutate: "supported" },
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "partial", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      },
      codex: {
        instructions: { inspect: "supported", mutate: "supported" },
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "unsupported", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      },
      antigravity: {
        instructions: { inspect: "supported", mutate: "supported" },
        skills: { inspect: "partial", mutate: "unsupported" },
        mcp: { inspect: "unsupported", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      },
      "trae-cli": {
        instructions: { inspect: "partial", mutate: "supported" },
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "partial", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      },
      pi: {
        instructions: { inspect: "supported", mutate: "supported" },
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "unsupported", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      }
    });
  });

  it("keeps Project declarations alongside independent Compare masks", () => {
    const declarations = Object.fromEntries(
      createBuiltInTargetAdapters().map((adapter) => [
        adapter.descriptor.id,
        {
          instructions: adapter.projects?.instructionFiles,
          skills: adapter.projects?.skillDirectories,
          mcp: adapter.projects?.mcpFiles,
          compare: adapter.projects?.compareResourcePaths,
          evaluationOwnsPaths: adapter.evaluations
            ? "projectResourcePaths" in adapter.evaluations
            : false
        }
      ])
    );

    expect(declarations).toEqual({
      opencode: {
        instructions: ["AGENTS.md", "CLAUDE.md"],
        skills: [".opencode/skills", ".claude/skills", ".agents/skills"],
        mcp: ["opencode.json", "opencode.jsonc"],
        compare: [
          "opencode.json",
          "opencode.jsonc",
          ".opencode",
          "AGENTS.md",
          "CLAUDE.md",
          ".claude/skills",
          ".agents/skills"
        ],
        evaluationOwnsPaths: true
      },
      "claude-code": {
        instructions: ["CLAUDE.md"],
        skills: [".claude/skills", ".agents/skills"],
        mcp: [".mcp.json"],
        compare: ["CLAUDE.md", ".claude", ".agents", "AGENTS.md"],
        evaluationOwnsPaths: true
      },
      codex: {
        instructions: ["AGENTS.md", "AGENTS.override.md"],
        skills: [".agents/skills", ".codex/skills"],
        mcp: [],
        compare: ["AGENTS.md", "AGENTS.override.md", ".agents", ".codex"],
        evaluationOwnsPaths: true
      },
      antigravity: {
        instructions: ["GEMINI.md"],
        skills: [".gemini/skills", ".agents/skills"],
        mcp: [],
        compare: ["GEMINI.md", ".gemini", ".agents"],
        evaluationOwnsPaths: true
      },
      "trae-cli": {
        instructions: [".trae/rules", "AGENTS.md"],
        skills: [".trae/skills"],
        mcp: [".trae/traecli.toml", ".trae/traecli.yaml"],
        compare: [".trae", "AGENTS.md"],
        evaluationOwnsPaths: false
      },
      pi: {
        instructions: ["AGENTS.md", "CLAUDE.md"],
        skills: [".pi/skills", ".agents/skills"],
        mcp: [],
        compare: ["AGENTS.md", "CLAUDE.md", ".pi", ".agents"],
        evaluationOwnsPaths: true
      }
    });
  });

  it("rejects runtime declarations whose primary command is not the first candidate", () => {
    expect(() => defineTargetIntegration({
      ...fixtureAgentIntegration,
      descriptor: {
        ...fixtureAgentIntegration.descriptor,
        executableName: "fixture-agent",
        executableCandidates: ["fixture-agent-nightly", "fixture-agent"]
      }
    })).toThrow("must list its primary executable first");
  });

  it("rejects unsafe executable candidate names", () => {
    expect(() => defineTargetIntegration({
      ...fixtureAgentIntegration,
      descriptor: {
        ...fixtureAgentIntegration.descriptor,
        executableCandidates: ["fixture-agent --unsafe"]
      }
    })).toThrow("contains an invalid executable candidate");
  });

  it("rejects a comparison declaration without an adapter implementation", () => {
    expect(() => defineTargetIntegration({
      ...fixtureAgentIntegration,
      descriptor: {
        ...fixtureAgentIntegration.descriptor,
        capabilities: {
          ...fixtureAgentIntegration.descriptor.capabilities,
          evaluation: true
        }
      }
    })).toThrow("must declare and implement Profile comparison together");
  });

  it("keeps fixture target knowledge outside shared production code", async () => {
    const sourceRoot = join(process.cwd(), "src");
    const files = await readdir(sourceRoot, { recursive: true });
    const sourceFiles = files.filter((path) => /\.(ts|tsx)$/.test(path));
    const matches: string[] = [];
    for (const path of sourceFiles) {
      const content = await readFile(join(sourceRoot, path), "utf8");
      if (content.includes('"fixture-agent"')) matches.push(path);
    }

    expect(matches).toEqual([]);
  });
});
