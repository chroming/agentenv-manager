import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defineTargetIntegration } from "../../src/main/targets/defineTargetIntegration";
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
    const profileDir = join(root, "profiles", "fixture-profile");
    const profile = createFixtureProfile(profileDir, {
      instructions: "# Fixture instructions\n",
      configText: '{"enabled":true}\n'
    });

    await adapter.writeProfileFiles(profileDir, profile);
    const restored = await adapter.readProfileFiles(profileDir, profile.manifest);
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
    expect(restored.instructions).toBe(profile.instructions);
    expect(restored.configText).toBe(profile.configText);
    expect(installation.found).toBe(true);
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.instructionsPath, "# Live fixture\n", "utf8");
    await writeFile(paths.configPath, '{"live":true}\n', "utf8");
    await expect(adapter.captureProfile(paths)).resolves.toEqual(
      expect.objectContaining({
        instructions: "# Live fixture\n",
        configText: '{"live":true}\n',
        warnings: [],
        excluded: []
      })
    );
    await expect(adapter.validateAssets({ profile, targetPaths: paths })).resolves.toEqual([]);
    await expect(adapter.skills.readNativeState(paths)).resolves.toEqual({
      disabledRuntimeNames: []
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
        state: { managedConfigKeys: [], managedMcpNames: [] }
      })
    ).resolves.toEqual(expect.objectContaining({ changes: [], errors: [] }));
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
