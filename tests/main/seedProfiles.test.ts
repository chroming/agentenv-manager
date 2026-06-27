import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { seedDefaultProfiles } from "../../src/main/seedProfiles";

let root = "";

const makePaths = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-seed-"));
  return createPaths({
    appDataRoot: root,
    codexHome: join(root, "fake-home", ".codex"),
    userSkillsDir: join(root, "fake-home", ".agents", "skills")
  });
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("seed profiles", () => {
  it("creates opencode-daily-coding when no profiles exist", async () => {
    const paths = await makePaths();

    await seedDefaultProfiles(paths);

    await expect(
      readFile(join(paths.profilesDir, "opencode-daily-coding", "profile.json"), "utf8")
    ).resolves.toContain("OpenCode Daily Coding");
  });

  it("does not overwrite existing profiles", async () => {
    const paths = await makePaths();
    const profileDir = join(paths.profilesDir, "custom");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "profile.json"), "{}");

    await seedDefaultProfiles(paths);

    await expect(
      readFile(join(paths.profilesDir, "custom", "profile.json"), "utf8")
    ).resolves.toBe("{}");
    await expect(
      readFile(join(paths.profilesDir, "opencode-daily-coding", "profile.json"), "utf8")
    ).rejects.toThrow();
  });
});
