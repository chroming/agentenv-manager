import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../../src/main/paths";
import { createProfileStore } from "../../../src/main/profileStore";
import { createRemoteActivationService } from "../../../src/main/remoteDevices/remoteActivationService";
import type {
  SshCommandResult,
  SshTransport
} from "../../../src/main/remoteDevices/systemSshTransport";
import { createSkillLibraryStore } from "../../../src/main/skillLibraryStore";
import { createOpenCodeTargetAdapter } from "../../../src/main/targets/opencodeTarget";
import { createTargetRegistry } from "../../../src/main/targets/registry";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const runShell = async (command: string, input?: Buffer): Promise<SshCommandResult> =>
  await new Promise((resolvePromise, reject) => {
    const child = spawn("/bin/sh", ["-c", command], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString("utf8").trim(),
      exitCode: code ?? 1
    }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });

const createLocalSshFixture = (remoteHome: string): SshTransport => ({
  execute: async (_device, command, options) => {
    if (command.includes("uname -s")) {
      return {
        stdout: Buffer.from([
          `HOME\t${remoteHome}`,
          "OS\tLinux",
          "ARCH\tx86_64",
          "MACHINE\tfixture-machine",
          "CMD\topencode\t/usr/bin/opencode",
          ""
        ].join("\n")),
        stderr: "",
        exitCode: 0
      };
    }
    return runShell(command, options?.input);
  }
});

const createFixture = async (
  transportFactory: (remoteHome: string) => SshTransport = createLocalSshFixture,
  extraSkillFiles = 0
) => {
  root = await mkdtemp(join(tmpdir(), "agentenv-remote-activation-"));
  const appDataRoot = join(root, "data");
  const localHome = join(root, "local-home");
  const remoteHome = join(root, "remote-home");
  await Promise.all([
    mkdir(appDataRoot, { recursive: true }),
    mkdir(localHome, { recursive: true }),
    mkdir(remoteHome, { recursive: true })
  ]);
  const paths = createPaths({ appDataRoot, homeDir: localHome });
  const profileStore = createProfileStore(paths);
  const skillLibraryStore = createSkillLibraryStore(paths);
  const source = join(root, "review-source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), [
    "---",
    "name: review",
    "description: Review changes carefully",
    "---",
    "# Review",
    ""
  ].join("\n"));
  await Promise.all(Array.from({ length: extraSkillFiles }, (_, index) =>
    writeFile(join(source, `reference-${String(index).padStart(3, "0")}.md`), `Reference ${index}\n`)
  ));
  await skillLibraryStore.importSkill({ sourcePath: source, id: "review" });
  const created = await profileStore.createProfile({
    preferredTargetId: "opencode",
    name: "Remote review"
  });
  const profile = await profileStore.saveProfile({
    manifest: created.manifest,
    instructions: "# Remote instructions\n",
    resources: {
      skills: [{ libraryId: "review", targetName: "review", enabled: true }],
      managementByTarget: {
        opencode: { instructions: "manage", skills: "manage" }
      },
      mcpByTarget: {
        opencode: { mode: "ignore", selections: [] }
      }
    },
    expectedContentHash: created.contentHash
  });
  const targetRegistry = createTargetRegistry([createOpenCodeTargetAdapter()]);
  const service = createRemoteActivationService({
    paths,
    profileStore,
    skillLibraryStore,
    targetRegistry,
    transport: transportFactory(remoteHome)
  });
  const device = await service.addDevice({ name: "Fixture Linux", host: "fixture" });
  const [endpoint] = await service.listEndpoints();
  return {
    endpoint,
    profile,
    remoteHome,
    service,
    device,
    paths,
    profileStore,
    skillLibraryStore,
    targetRegistry
  };
};

describe("remote Profile activation", () => {
  it("keeps an unavailable SSH device saved so the user can reconnect later", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-remote-offline-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const service = createRemoteActivationService({
      paths,
      profileStore: createProfileStore(paths),
      skillLibraryStore: createSkillLibraryStore(paths),
      targetRegistry: createTargetRegistry([createOpenCodeTargetAdapter()]),
      transport: {
        execute: async () => {
          throw new Error("device is offline");
        }
      }
    });

    const device = await service.addDevice({ name: "Offline Linux", host: "offline" });

    await expect(service.listDevices()).resolves.toContainEqual(device);
    await expect(service.probeDevice(device.id)).resolves.toMatchObject({
      status: "unavailable",
      error: "device is offline"
    });
  });

  it("rejects remote snapshot symlinks before preview reads their local targets", async () => {
    const fixture = await createFixture();
    const localSecret = join(root, "local-secret.txt");
    const instructionPath = join(fixture.remoteHome, ".config", "opencode", "AGENTS.md");
    await writeFile(localSecret, "local-only-secret\n");
    await mkdir(join(fixture.remoteHome, ".config", "opencode"), { recursive: true });
    await symlink(localSecret, instructionPath);

    await expect(fixture.service.previewProfile(fixture.profile.manifest.id, fixture.endpoint.id))
      .rejects.toThrow(/link points outside HOME/i);
  });

  it("previews a remote Skill linked to a regular directory inside remote HOME", async () => {
    const fixture = await createFixture();
    const sharedSkill = join(fixture.remoteHome, ".remote-skills", "review");
    const runtimeSkill = join(fixture.remoteHome, ".config", "opencode", "skills", "review");
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(join(sharedSkill, "SKILL.md"), [
      "---",
      "name: review",
      "description: Remote linked copy",
      "---",
      "# Remote linked review",
      ""
    ].join("\n"));
    await mkdir(join(fixture.remoteHome, ".config", "opencode", "skills"), { recursive: true });
    await symlink(sharedSkill, runtimeSkill);

    const preview = await fixture.service.previewProfile(fixture.profile.manifest.id, fixture.endpoint.id);
    expect(preview.resourceChanges).toEqual([
      expect.objectContaining({ action: "replace", name: "review" })
    ]);
    await expect(fixture.service.applyProfile(fixture.profile.manifest.id, preview.id))
      .resolves.toMatchObject({ ok: true });
    expect((await lstat(runtimeSkill)).isDirectory()).toBe(true);
    expect((await lstat(runtimeSkill)).isSymbolicLink()).toBe(false);
    await expect(readFile(join(runtimeSkill, "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8"))
      .resolves.toContain("# Remote linked review");
  });

  it("rejects unavailable and cyclic links without extracting the remote snapshot", async () => {
    const broken = await createFixture();
    const brokenSkill = join(broken.remoteHome, ".config", "opencode", "skills", "review");
    await mkdir(join(broken.remoteHome, ".config", "opencode", "skills"), { recursive: true });
    await symlink(join(broken.remoteHome, "missing-review"), brokenSkill);
    await expect(broken.service.previewProfile(broken.profile.manifest.id, broken.endpoint.id))
      .rejects.toThrow(/link is unavailable/i);

    await rm(root, { recursive: true, force: true });
    root = "";
    const cyclic = await createFixture();
    const cyclicSkill = join(cyclic.remoteHome, ".config", "opencode", "skills", "review");
    await mkdir(cyclicSkill, { recursive: true });
    await writeFile(join(cyclicSkill, "SKILL.md"), "# Cyclic review\n");
    await symlink(".", join(cyclicSkill, "loop"));
    await expect(cyclic.service.previewProfile(cyclic.profile.manifest.id, cyclic.endpoint.id))
      .rejects.toThrow(/link cycle/i);
  });

  it("applies Instructions and managed-copy Skills without changing the local Agent", async () => {
    const { endpoint, paths, profile, remoteHome, service } = await createFixture();

    const preview = await service.previewProfile(profile.manifest.id, endpoint.id);
    expect(preview.issues).toEqual([]);
    expect(preview.resourceChanges).toEqual([
      expect.objectContaining({ action: "install", name: "review" })
    ]);
    await expect(service.applyProfile(profile.manifest.id, preview.id)).resolves.toMatchObject({
      ok: true
    });

    await expect(readFile(join(remoteHome, ".config", "opencode", "AGENTS.md"), "utf8"))
      .resolves.toBe("# Remote instructions\n");
    await expect(readFile(join(remoteHome, ".config", "opencode", "skills", "review", "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
    await expect(readdir(join(
      remoteHome,
      ".local",
      "state",
      "agentenv-manager",
      "operations"
    ))).resolves.toEqual([]);
    expect(await service.listTargetStates()).toEqual([
      expect.objectContaining({
        targetId: endpoint.id,
        activeProfileId: profile.manifest.id,
        lifecycleStatus: "applied"
      })
    ]);

    const noOp = await service.previewProfile(profile.manifest.id, endpoint.id);
    expect(noOp.changes).toEqual([]);
    expect(noOp.resourceChanges).toEqual([]);
    expect(noOp.targetStateChanged).toBe(false);
    await expect(service.applyProfile(profile.manifest.id, noOp.id)).resolves.toMatchObject({
      ok: false,
      kind: "no-op"
    });
    await expect(readdir(paths.remotePreviewCacheDir)).resolves.toEqual([]);
  });

  it("rejects Apply when the remote Agent changed after Preview", async () => {
    const { endpoint, profile, remoteHome, service } = await createFixture();
    const preview = await service.previewProfile(profile.manifest.id, endpoint.id);
    const instructionPath = join(remoteHome, ".config", "opencode", "AGENTS.md");
    await mkdir(join(remoteHome, ".config", "opencode"), { recursive: true });
    await writeFile(instructionPath, "# External change\n");

    await expect(service.applyProfile(profile.manifest.id, preview.id)).resolves.toMatchObject({
      ok: false,
      kind: "stale"
    });
    await expect(readFile(instructionPath, "utf8")).resolves.toBe("# External change\n");
  });

  it("sends a bounded SSH bootstrap command for Skills with many files", async () => {
    let applyCommandLength = 0;
    const fixture = await createFixture((remoteHome) => {
      const local = createLocalSshFixture(remoteHome);
      return {
        execute: async (device, command, options) => {
          if (command.includes("printf receiving") || command.includes("printf staging")) {
            applyCommandLength = command.length;
          }
          return local.execute(device, command, options);
        }
      };
    }, 80);
    const preview = await fixture.service.previewProfile(
      fixture.profile.manifest.id,
      fixture.endpoint.id
    );

    await expect(fixture.service.applyProfile(fixture.profile.manifest.id, preview.id))
      .resolves.toMatchObject({ ok: true });
    expect(applyCommandLength).toBeGreaterThan(0);
    expect(applyCommandLength).toBeLessThan(2_048);
  });

  it("never removes an untouched remote resource when a later backup fails", async () => {
    const fixture = await createFixture((remoteHome) => {
      const local = createLocalSshFixture(remoteHome);
      return {
        execute: async (device, command, options) => {
          if (!command.includes("printf receiving")) {
            return local.execute(device, command, options);
          }
          const failBin = join(root, "fail-bin");
          const counter = join(root, "cp-count");
          const cpShim = join(failBin, "cp");
          await mkdir(failBin, { recursive: true });
          await writeFile(cpShim, [
            "#!/bin/sh",
            `counter=${JSON.stringify(counter)}`,
            "count=0",
            "[ ! -f \"$counter\" ] || count=$(cat \"$counter\")",
            "count=$((count + 1))",
            "printf '%s' \"$count\" > \"$counter\"",
            "[ \"$count\" -ne 3 ] || exit 73",
            "exec /bin/cp \"$@\""
          ].join("\n"));
          await chmod(cpShim, 0o700);
          return runShell(`PATH=${JSON.stringify(failBin)}:$PATH ${command}`, options?.input);
        }
      };
    });
    const instructionPath = join(fixture.remoteHome, ".config", "opencode", "AGENTS.md");
    const skillPath = join(fixture.remoteHome, ".config", "opencode", "skills", "review");
    await mkdir(skillPath, { recursive: true });
    await writeFile(instructionPath, "# Original instructions\n");
    await writeFile(join(skillPath, "SKILL.md"), [
      "---",
      "name: review",
      "description: Original remote copy",
      "---",
      "# Original review",
      ""
    ].join("\n"));

    const preview = await fixture.service.previewProfile(
      fixture.profile.manifest.id,
      fixture.endpoint.id
    );
    await expect(fixture.service.applyProfile(fixture.profile.manifest.id, preview.id))
      .resolves.toMatchObject({ ok: false, kind: "failed" });
    await expect(readFile(instructionPath, "utf8")).resolves.toBe("# Original instructions\n");
    await expect(readFile(join(skillPath, "SKILL.md"), "utf8"))
      .resolves.toContain("# Original review");
  });

  it("records a different Profile as active even when its filesystem payload is identical", async () => {
    const fixture = await createFixture();
    const firstPreview = await fixture.service.previewProfile(
      fixture.profile.manifest.id,
      fixture.endpoint.id
    );
    await fixture.service.applyProfile(fixture.profile.manifest.id, firstPreview.id);
    const duplicate = await fixture.profileStore.createProfile({
      preferredTargetId: "opencode",
      name: "Same remote payload"
    });
    const secondProfile = await fixture.profileStore.saveProfile({
      manifest: duplicate.manifest,
      instructions: fixture.profile.instructions,
      resources: fixture.profile.resources,
      expectedContentHash: duplicate.contentHash
    });

    const preview = await fixture.service.previewProfile(
      secondProfile.manifest.id,
      fixture.endpoint.id
    );
    expect(preview.changes).toEqual([]);
    expect(preview.resourceChanges).toEqual([]);
    expect(preview.targetStateChanged).toBe(true);
    expect(preview.targetStateChanges).toEqual([
      { kind: "profile-assignment" }
    ]);
    await expect(fixture.service.applyProfile(secondProfile.manifest.id, preview.id))
      .resolves.toMatchObject({ ok: true });
    await expect(fixture.service.listTargetStates()).resolves.toEqual([
      expect.objectContaining({ activeProfileId: secondProfile.manifest.id })
    ]);
  });

  it("requires MCP settings to remain Agent-owned over SSH", async () => {
    const { endpoint, profile, service } = await createFixture();
    const profileStore = createProfileStore(createPaths({ appDataRoot: join(root, "data") }));
    const current = await profileStore.readProfile(profile.manifest.id);
    await profileStore.saveProfile({
      manifest: current.manifest,
      instructions: current.instructions,
      resources: {
        ...current.resources,
        mcpByTarget: { opencode: { mode: "manage", selections: [] } }
      },
      expectedContentHash: current.contentHash
    });

    const preview = await service.previewProfile(profile.manifest.id, endpoint.id);
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: "unsupported-mcp-management",
      disposition: "block",
      resolution: "edit-profile"
    }));
  });

  it("reconciles a committed remote Apply after the connection drops and the app restarts", async () => {
    let hideFirstStatus = true;
    const fixture = await createFixture((remoteHome) => {
      const local = createLocalSshFixture(remoteHome);
      return {
        execute: async (device, command, options) => {
          if (command.includes("printf receiving")) {
            await local.execute(device, command, options);
            throw new Error("connection dropped after commit");
          }
          if (command.includes("/status") && hideFirstStatus) {
            hideFirstStatus = false;
            throw new Error("device temporarily offline");
          }
          return local.execute(device, command, options);
        }
      };
    });
    const preview = await fixture.service.previewProfile(
      fixture.profile.manifest.id,
      fixture.endpoint.id
    );

    await expect(fixture.service.applyProfile(fixture.profile.manifest.id, preview.id))
      .resolves.toMatchObject({ ok: false, kind: "recovery-required" });
    await expect(fixture.service.removeDevice(fixture.device.id))
      .rejects.toThrow(/finish recovery/i);
    await expect(fixture.service.listDevices()).resolves.toContainEqual(fixture.device);

    const restarted = createRemoteActivationService({
      paths: fixture.paths,
      profileStore: fixture.profileStore,
      skillLibraryStore: fixture.skillLibraryStore,
      targetRegistry: fixture.targetRegistry,
      transport: createLocalSshFixture(fixture.remoteHome)
    });
    await expect(restarted.listTargetStates()).resolves.toEqual([
      expect.objectContaining({
        targetId: fixture.endpoint.id,
        activeProfileId: fixture.profile.manifest.id,
        lifecycleStatus: "applied"
      })
    ]);
  });

  it("keeps recovery required when the remote operation receipt is missing", async () => {
    let hideStatus = true;
    const fixture = await createFixture((remoteHome) => {
      const local = createLocalSshFixture(remoteHome);
      return {
        execute: async (device, command, options) => {
          if (command.includes("printf receiving")) {
            await local.execute(device, command, options);
            throw new Error("connection dropped after commit");
          }
          if (command.includes("/status") && hideStatus) {
            hideStatus = false;
            throw new Error("device temporarily offline");
          }
          return local.execute(device, command, options);
        }
      };
    });
    const preview = await fixture.service.previewProfile(
      fixture.profile.manifest.id,
      fixture.endpoint.id
    );
    await expect(fixture.service.applyProfile(fixture.profile.manifest.id, preview.id))
      .resolves.toMatchObject({ ok: false, kind: "recovery-required" });

    await rm(join(
      fixture.remoteHome,
      ".local",
      "state",
      "agentenv-manager",
      "operations"
    ), { recursive: true, force: true });
    const restarted = createRemoteActivationService({
      paths: fixture.paths,
      profileStore: fixture.profileStore,
      skillLibraryStore: fixture.skillLibraryStore,
      targetRegistry: fixture.targetRegistry,
      transport: createLocalSshFixture(fixture.remoteHome)
    });

    await expect(restarted.listTargetStates()).resolves.toContainEqual(expect.objectContaining({
      targetId: fixture.endpoint.id,
      lifecycleStatus: "recovery-required"
    }));
  });

  it("keeps the last applied endpoint and state visible while its device is offline", async () => {
    const fixture = await createFixture();
    const preview = await fixture.service.previewProfile(
      fixture.profile.manifest.id,
      fixture.endpoint.id
    );
    await fixture.service.applyProfile(fixture.profile.manifest.id, preview.id);
    const offline = createRemoteActivationService({
      paths: fixture.paths,
      profileStore: fixture.profileStore,
      skillLibraryStore: fixture.skillLibraryStore,
      targetRegistry: fixture.targetRegistry,
      transport: {
        execute: async () => {
          throw new Error("device is offline");
        }
      }
    });

    await expect(offline.listEndpoints()).resolves.toContainEqual(expect.objectContaining({
      id: fixture.endpoint.id,
      availability: "unavailable"
    }));
    await expect(offline.listTargetStates()).resolves.toContainEqual(expect.objectContaining({
      targetId: fixture.endpoint.id,
      activeProfileId: fixture.profile.manifest.id,
      lifecycleStatus: "applied"
    }));
  });
});
