import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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
        iconKey: "rocket",
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
        description: "Default",
        iconKey: "rocket",
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        targetContentHashes: {
          opencode: expect.stringMatching(/^[a-f0-9]{64}$/),
          "claude-code": expect.stringMatching(/^[a-f0-9]{64}$/),
          codex: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
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
    await expect(readdir(join(root, "trash", "profiles"))).resolves.toEqual([
      expect.stringMatching(/^daily-coding-/)
    ]);
  });

  it("refuses to follow a profile directory symlink outside app data", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-"));
    const outsideDir = join(root, "outside");
    const profileRoot = join(root, "profiles");
    await mkdir(outsideDir, { recursive: true });
    await mkdir(profileRoot, { recursive: true });
    await writeFile(join(outsideDir, "profile.json"), "keep me\n", "utf8");
    await symlink(outsideDir, join(profileRoot, "daily-coding"), "dir");
    const store = createProfileStore({ appDataRoot: root });

    await expect(store.readProfile("daily-coding")).rejects.toThrow(
      "Profile storage must be a real directory"
    );
    await expect(readFile(join(outsideDir, "profile.json"), "utf8")).resolves.toBe(
      "keep me\n"
    );
  });
});
