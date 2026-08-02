import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveTraeLayout
} from "../../../src/main/targets/integrations/trae-cli/layout";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-trae-layout-"));
  await mkdir(join(root, ".trae"), { recursive: true });
  return join(root, ".trae");
};

describe("Trae CLI layout resolution", () => {
  it("defaults a fresh installation to the current V2 layout", async () => {
    const configRoot = await setup();
    expect(resolveTraeLayout({ homeDir: root })).toMatchObject({
      version: "v2",
      configRoot,
      runtimeRoot: join(configRoot, "cli"),
      configPath: join(configRoot, "traecli.toml"),
      instructionsPath: join(configRoot, "rules", "agentenv-manager.md"),
      skillsDir: join(configRoot, "skills")
    });
  });

  it("uses the legacy layout only when no V2 evidence exists", async () => {
    const configRoot = await setup();
    await writeFile(join(configRoot, "traecli.yaml"), "model: legacy\n");

    expect(resolveTraeLayout({ homeDir: root })).toMatchObject({
      version: "legacy",
      runtimeRoot: undefined,
      configPath: join(configRoot, "traecli.yaml")
    });
  });

  it("prefers V2 when current and legacy files coexist", async () => {
    const configRoot = await setup();
    await writeFile(join(configRoot, "traecli.yaml"), "model: legacy\n");
    await writeFile(join(configRoot, "traecli.toml"), 'model = "current"\n');

    expect(resolveTraeLayout({ homeDir: root })).toMatchObject({
      version: "v2",
      configPath: join(configRoot, "traecli.toml")
    });
  });

  it("recognizes a V2 runtime before checking the legacy config", async () => {
    const configRoot = await setup();
    await writeFile(join(configRoot, "traecli.yaml"), "model: legacy\n");
    await mkdir(join(configRoot, "cli", "sessions"), { recursive: true });

    expect(resolveTraeLayout({ homeDir: root }).version).toBe("v2");
  });

  it("resolves TRAE_HOME and TRAECLI_HOME without conflating them", async () => {
    const configRoot = join(root || "/tmp", "custom-trae");
    const runtimeRoot = join(root || "/tmp", "custom-trae-runtime");
    expect(resolveTraeLayout({
      homeDir: "/Users/example",
      environment: {
        TRAE_HOME: configRoot,
        TRAECLI_HOME: runtimeRoot
      }
    })).toMatchObject({
      version: "v2",
      configRoot,
      runtimeRoot,
      configPath: join(configRoot, "traecli.toml"),
      skillsDir: join(configRoot, "skills")
    });
  });

  it("does not treat the obsolete AgentEnv YAML name as runtime evidence", async () => {
    const configRoot = await setup();
    await writeFile(join(configRoot, "trae_cli.yaml"), "model: obsolete\n");

    expect(resolveTraeLayout({ homeDir: root })).toMatchObject({
      version: "v2",
      configPath: join(configRoot, "traecli.toml"),
      obsoleteConfigPath: join(configRoot, "trae_cli.yaml")
    });
  });
});
