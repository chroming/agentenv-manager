import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProfileStore } from "../../src/main/profileStore";

let root = "";

const writeProfile = async (profileRoot: string) => {
  const profileDir = join(profileRoot, "profiles", "daily-coding");
  await mkdir(profileDir, { recursive: true });
  await writeFile(
    join(profileDir, "profile.json"),
      JSON.stringify({
        id: "daily-coding",
        targetId: "codex",
        name: "Daily Coding",
        description: "Default",
        version: 1,
        managed: { instructions: true, config: true, assets: true }
      })
  );
  await writeFile(join(profileDir, "AGENTS.md"), "# Agent\n");
  await writeFile(join(profileDir, "mcp.toml"), "[mcp_servers.docs]\n");
  await writeFile(
    join(profileDir, "skills.json"),
    JSON.stringify({
      ownedSkillDirs: [],
      disabledSkillPaths: []
    })
  );
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("profile store", () => {
  it("lists valid profiles", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-"));
    await writeProfile(root);

    const store = createProfileStore({ appDataRoot: root });

    await expect(store.listProfiles()).resolves.toEqual([
      {
        id: "daily-coding",
        targetId: "codex",
        name: "Daily Coding",
        description: "Default"
      }
    ]);
  });

  it("reads a profile with managed files", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-"));
    await writeProfile(root);

    const store = createProfileStore({ appDataRoot: root });
    const profile = await store.readProfile("daily-coding");

    expect(profile.manifest.name).toBe("Daily Coding");
    expect(profile.instructions).toBe("# Agent\n");
    expect(profile.configText).toBe("[mcp_servers.docs]\n");
    expect(profile.assetPolicy.ownedDirs).toEqual([]);
  });

  it("rejects unsafe profile ids", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-"));
    const store = createProfileStore({ appDataRoot: root });

    await expect(store.readProfile("../bad")).rejects.toThrow("Invalid profile id");
  });

  it("duplicates a profile including profile-owned files", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-"));
    await writeProfile(root);
    await mkdir(join(root, "profiles", "daily-coding", "skills", "reviewer"), {
      recursive: true
    });
    await writeFile(
      join(root, "profiles", "daily-coding", "skills", "reviewer", "SKILL.md"),
      "# Reviewer\n"
    );

    const store = createProfileStore({ appDataRoot: root });
    const duplicate = await store.duplicateProfile("daily-coding");

    expect(duplicate.id).not.toBe("daily-coding");
    expect(duplicate.manifest.name).toBe("Daily Coding Copy");
    await expect(
      readFile(join(duplicate.profileDir ?? "", "skills", "reviewer", "SKILL.md"), "utf8")
    ).resolves.toBe("# Reviewer\n");
    await expect(store.listProfiles()).resolves.toHaveLength(2);
  });

  it("deletes a profile directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-"));
    await writeProfile(root);

    const store = createProfileStore({ appDataRoot: root });
    await store.deleteProfile("daily-coding");

    await expect(store.listProfiles()).resolves.toEqual([]);
    await expect(store.readProfile("daily-coding")).rejects.toThrow();
  });
});
