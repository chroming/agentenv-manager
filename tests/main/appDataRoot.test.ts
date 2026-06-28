import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  migrateLegacyAppDataRoot,
  resolveAppDataRoot
} from "../../src/main/appDataRoot";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("app data root", () => {
  it("defaults persistent app data to ~/.config/agentenv-manager", () => {
    const resolved = resolveAppDataRoot({
      env: {},
      homeDir: "/Users/tester",
      userDataDir: "/Users/tester/Library/Application Support/AgentEnv Manager"
    });

    expect(resolved).toBe("/Users/tester/.config/agentenv-manager");
  });

  it("keeps AGENTENV_DATA_ROOT as an explicit override", () => {
    const resolved = resolveAppDataRoot({
      env: { AGENTENV_DATA_ROOT: "/tmp/agentenv-data" },
      homeDir: "/Users/tester",
      userDataDir: "/Users/tester/Library/Application Support/AgentEnv Manager"
    });

    expect(resolved).toBe("/tmp/agentenv-data");
  });

  it("migrates old Electron userData data into the new config directory once", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-root-"));
    const legacyRoot = join(root, "Application Support", "AgentEnv Manager", "data");
    const nextRoot = join(root, ".config", "agentenv-manager");
    await mkdir(join(legacyRoot, "profiles", "daily"), { recursive: true });
    await writeFile(join(legacyRoot, "profiles", "daily", "profile.json"), "{}\n", "utf8");

    await migrateLegacyAppDataRoot({ legacyRoot, nextRoot });

    await expect(readFile(join(nextRoot, "profiles", "daily", "profile.json"), "utf8")).resolves.toBe(
      "{}\n"
    );
  });

  it("does not merge old data into an existing new config directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-root-"));
    const legacyRoot = join(root, "old", "data");
    const nextRoot = join(root, "new");
    await mkdir(legacyRoot, { recursive: true });
    await mkdir(nextRoot, { recursive: true });
    await writeFile(join(legacyRoot, "settings.json"), "{\"old\":true}\n", "utf8");
    await writeFile(join(nextRoot, "settings.json"), "{\"new\":true}\n", "utf8");

    await migrateLegacyAppDataRoot({ legacyRoot, nextRoot });

    await expect(readFile(join(nextRoot, "settings.json"), "utf8")).resolves.toBe(
      "{\"new\":true}\n"
    );
  });
});
