import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateAppDataRoot } from "../../src/main/appDataValidation";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("AgentEnv data validation", () => {
  it("accepts an empty legacy data directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-validation-"));
    await mkdir(join(root, "profiles"), { recursive: true });
    await writeFile(join(root, "profiles", ".DS_Store"), "finder metadata");
    await expect(validateAppDataRoot(root)).resolves.toBeUndefined();
  });

  it("rejects malformed settings instead of restoring them as defaults", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-validation-"));
    await writeFile(join(root, "settings.json"), '{"skillAutoCheckEnabled":"yes"}\n');
    await expect(validateAppDataRoot(root)).rejects.toThrow();
  });

  it("rejects malformed Target management state", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-validation-"));
    await mkdir(join(root, "target-states"), { recursive: true });
    await writeFile(
      join(root, "target-states", "opencode.json"),
      '{"formatVersion":1,"managedResources":"all"}\n'
    );
    await expect(validateAppDataRoot(root)).rejects.toThrow();
  });

  it("rejects malformed SSH device descriptors and remote endpoint state", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-validation-"));
    await writeFile(
      join(root, "remote-devices.json"),
      '{"formatVersion":1,"devices":[{"name":"Server","host":"server"}]}\n'
    );
    await expect(validateAppDataRoot(root)).rejects.toThrow();

    await writeFile(join(root, "remote-devices.json"), '{"formatVersion":1,"devices":[]}\n');
    await mkdir(join(root, "remote-endpoint-states"), { recursive: true });
    await writeFile(
      join(root, "remote-endpoint-states", "invalid.json"),
      '{"formatVersion":1,"endpointId":"ssh:fixture:opencode"}\n'
    );
    await expect(validateAppDataRoot(root)).rejects.toThrow();
  });

  it("rejects a Skill Library entry without a valid SKILL.md", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-validation-"));
    await mkdir(join(root, "skills-library", "broken-skill"), { recursive: true });

    await expect(validateAppDataRoot(root)).rejects.toThrow("SKILL.md");
  });

  it("rejects malformed Skill Library metadata", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-validation-"));
    const skillDir = join(root, "skills-library", "review-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: review-skill\ndescription: Review code\n---\n\n# Review\n"
    );
    await writeFile(
      join(skillDir, ".agentenv-skill.json"),
      '{"sourceType":"github","globallyEnabled":"yes"}\n'
    );

    await expect(validateAppDataRoot(root)).rejects.toThrow();
  });
});
