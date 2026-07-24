import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProfileStore } from "../../src/main/profileStore";

let root = "";

const writeProfile = async (
  profileRoot: string,
  input: { id?: string; name?: string; createdAt?: string } = {}
) => {
  const id = input.id ?? "daily-coding";
  const profileDir = join(profileRoot, "profiles", id);
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "profile.json"), JSON.stringify({
    id,
    preferredTargetId: "codex",
    name: input.name ?? "Daily Coding",
    description: "Default",
    iconKey: "rocket",
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    version: 2
  }));
  await writeFile(join(profileDir, "INSTRUCTIONS.md"), "# Agent\n");
  await writeFile(join(profileDir, "resources.json"), JSON.stringify({
    skills: [{ libraryId: "review", targetName: "review", enabled: true }],
    mcpByTarget: {
      codex: { mode: "manage", selections: [{ name: "docs", enabled: true }] }
    }
  }));
};

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("profile store v2", () => {
  it("creates a blank Profile without adopting native Agent resources", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-create-"));

    const created = await createProfileStore({ appDataRoot: root }).createProfile({
      preferredTargetId: "opencode",
      name: "Blank workspace",
      description: "Start without captured resources"
    });

    expect(created.instructions).toBe("");
    expect(created.resources).toEqual({ skills: [], mcpByTarget: {} });
  });

  it("lists valid profiles with per-target hashes", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-v2-"));
    await writeProfile(root);

    const [profile] = await createProfileStore({ appDataRoot: root }).listProfiles();

    expect(profile).toMatchObject({
      id: "daily-coding",
      preferredTargetId: "codex",
      name: "Daily Coding",
      iconKey: "rocket",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(profile.targetContentHashes).toMatchObject({
      codex: expect.stringMatching(/^[a-f0-9]{64}$/),
      opencode: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it("orders Profiles by persisted creation time", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-order-"));
    await writeProfile(root, { id: "newer", createdAt: "2026-07-16T10:00:00.000Z" });
    await writeProfile(root, { id: "older", createdAt: "2026-07-15T10:00:00.000Z" });

    expect((await createProfileStore({ appDataRoot: root }).listProfiles()).map(({ id }) => id))
      .toEqual(["newer", "older"]);
  });

  it("keeps valid Profiles visible when another Profile is malformed", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-recovery-"));
    await writeProfile(root);
    const brokenDir = join(root, "profiles", "broken-profile");
    await mkdir(brokenDir, { recursive: true });
    await writeFile(join(brokenDir, "profile.json"), "{}\n");

    const profiles = await createProfileStore({ appDataRoot: root }).listProfiles();

    expect(profiles[0]).toMatchObject({ id: "daily-coding" });
    expect(profiles[0]).not.toHaveProperty("loadError");
    expect(profiles[1]).toMatchObject({ id: "broken-profile", loadError: expect.any(String) });
  });

  it("reads and atomically saves only the v2 Profile files", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-save-"));
    await writeProfile(root);
    const store = createProfileStore({ appDataRoot: root });
    const profile = await store.readProfile("daily-coding");
    await writeFile(join(profile.profileDir!, "stale-native-config.json"), "do not retain");

    const saved = await store.saveProfile({
      manifest: { ...profile.manifest, createdAt: undefined },
      instructions: "# Updated\n",
      resources: profile.resources
    });

    expect(saved.instructions).toBe("# Updated\n");
    expect(saved.manifest.createdAt).toBe(profile.manifest.createdAt);
    await expect(readdir(profile.profileDir!)).resolves.toEqual([
      "INSTRUCTIONS.md",
      "profile.json",
      "resources.json"
    ]);
  });

  it("updates metadata without changing environment content", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-metadata-"));
    await writeProfile(root);
    const store = createProfileStore({ appDataRoot: root });

    const updated = await store.updateProfileMetadata({
      id: "daily-coding",
      name: "Review Focus",
      description: "Review metadata",
      iconKey: "shield"
    });

    expect(updated.manifest).toMatchObject({
      name: "Review Focus",
      description: "Review metadata",
      iconKey: "shield"
    });
    expect(updated.instructions).toBe("# Agent\n");
    expect(updated.resources.skills).toHaveLength(1);
  });

  it("updates only Profile Skills from an Agent detail and skips semantic no-ops", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-skills-"));
    await writeProfile(root);
    const store = createProfileStore({ appDataRoot: root });
    const profile = await store.readProfile("daily-coding");

    const noOp = await store.updateProfileSkills({
      profileId: profile.id,
      targetId: "codex",
      expectedContentHash: profile.contentHash!,
      skills: profile.resources.skills
    });
    expect(noOp.changed).toBe(false);

    const updated = await store.updateProfileSkills({
      profileId: profile.id,
      targetId: "codex",
      expectedContentHash: profile.contentHash!,
      skills: [
        ...profile.resources.skills,
        { libraryId: "testing", targetName: "testing", enabled: false }
      ],
      managementMode: "manage"
    });

    expect(updated.changed).toBe(true);
    expect(updated.profile.instructions).toBe("# Agent\n");
    expect(updated.profile.resources.mcpByTarget).toEqual(profile.resources.mcpByTarget);
    expect(updated.profile.resources.skills).toEqual([
      { libraryId: "review", targetName: "review", enabled: true },
      { libraryId: "testing", targetName: "testing", enabled: false }
    ]);
  });

  it("rejects stale Agent-detail Skill edits", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-skills-stale-"));
    await writeProfile(root);
    const store = createProfileStore({ appDataRoot: root });
    const profile = await store.readProfile("daily-coding");
    await store.saveProfile({
      manifest: profile.manifest,
      instructions: "# Changed elsewhere\n",
      resources: profile.resources
    });

    await expect(store.updateProfileSkills({
      profileId: profile.id,
      targetId: "codex",
      expectedContentHash: profile.contentHash!,
      skills: []
    })).rejects.toThrow("changed outside this Agent view");

    expect((await store.readProfile(profile.id)).instructions).toBe("# Changed elsewhere\n");
  });

  it("forks a shared Profile and applies the Agent-specific Skill intent", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-skills-fork-"));
    await writeProfile(root);
    const store = createProfileStore({ appDataRoot: root });
    const profile = await store.readProfile("daily-coding");

    const result = await store.forkProfileSkills({
      profileId: profile.id,
      targetId: "opencode",
      expectedContentHash: profile.contentHash!,
      name: "Daily Coding (OpenCode)",
      skills: [
        { libraryId: "review", targetName: "review", enabled: false }
      ],
      managementMode: "manage"
    });

    expect(result.profile.id).not.toBe(profile.id);
    expect(result.profile.manifest).toMatchObject({
      name: "Daily Coding (OpenCode)",
      preferredTargetId: "opencode"
    });
    expect(result.profile.resources.skills).toEqual([
      { libraryId: "review", targetName: "review", enabled: false }
    ]);
    expect((await store.readProfile(profile.id)).resources.skills).toEqual([
      { libraryId: "review", targetName: "review", enabled: true }
    ]);
  });

  it("rejects unsafe ids, duplicate resources, and literal credentials", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-validation-"));
    await writeProfile(root);
    const store = createProfileStore({ appDataRoot: root });
    const profile = await store.readProfile("daily-coding");

    await expect(store.readProfile("../bad")).rejects.toThrow("Invalid profile id");
    await expect(store.saveProfile({
      manifest: profile.manifest,
      instructions: "api_key: sk-1234567890abcdefghijklmnop",
      resources: profile.resources
    })).rejects.toThrow("literal credentials");
    await expect(store.saveProfile({
      manifest: profile.manifest,
      instructions: profile.instructions,
      resources: {
        ...profile.resources,
        skills: [
          { libraryId: "one", targetName: "same", enabled: true },
          { libraryId: "two", targetName: "same", enabled: true }
        ]
      }
    })).rejects.toThrow("more than once");
  });

  it("duplicates canonical Profile content", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-copy-"));
    await writeProfile(root);
    const store = createProfileStore({ appDataRoot: root });

    const duplicate = await store.duplicateProfile("daily-coding");

    expect(duplicate.id).not.toBe("daily-coding");
    expect(duplicate.manifest.name).toBe("Daily Coding Copy");
    expect(duplicate.instructions).toBe("# Agent\n");
    expect(duplicate.resources.skills).toEqual([
      { libraryId: "review", targetName: "review", enabled: true }
    ]);
  });

  it("moves deleted Profiles to recovery trash", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-delete-"));
    await writeProfile(root);
    const store = createProfileStore({ appDataRoot: root });

    await store.deleteProfile("daily-coding");

    await expect(store.listProfiles()).resolves.toEqual([]);
    await expect(readdir(join(root, "trash", "profiles"))).resolves.toEqual([
      expect.stringMatching(/^daily-coding-/)
    ]);
  });

  it("refuses to follow a Profile directory symlink", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-profile-symlink-"));
    const outside = join(root, "outside");
    await writeProfile(outside, { id: "linked" });
    await mkdir(join(root, "profiles"), { recursive: true });
    await symlink(join(outside, "profiles", "linked"), join(root, "profiles", "linked"));

    await expect(createProfileStore({ appDataRoot: root }).readProfile("linked"))
      .rejects.toThrow("real directory");
  });
});
