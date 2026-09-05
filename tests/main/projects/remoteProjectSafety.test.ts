import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RemoteDevice, SkillLibraryEntry } from "../../../src/shared/types";
import type { SshTransport } from "../../../src/main/remoteDevices/systemSshTransport";
import { createProjectMutationService } from "../../../src/main/projects/projectMutationService";
import type { ProjectEnvironmentService } from "../../../src/main/projects/projectEnvironmentService";
import type { ProjectStore } from "../../../src/main/projects/projectStore";
import type { RemoteDeviceStore } from "../../../src/main/remoteDevices/remoteDeviceStore";
import { createProjectRecoveryStore } from "../../../src/main/projects/projectRecoveryStore";
import { hashFileContent } from "../../../src/main/filesystemIntegrity";
import { hashSkillContent } from "../../../src/main/skillContentHash";
import { createTarArchiveFromDirectory, extractTarArchiveSafely, fetchRemoteWorkspaceResourcesTar, testRemoteProjectPath, listRemoteDirectories } from "../../../src/main/projects/remoteProjectTransport";
import { shellQuote } from "../../../src/main/remoteDevices/systemSshTransport";
import { workspaceSshCommand } from "../../../src/shared/workspaceSshCommand";

// Execute the actual remote shell scripts against disposable directories, never a real SSH host.
const transport: SshTransport = {
  execute: async (_device, command, options) => await new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), exitCode: code ?? 1 }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(options?.input);
  })
};

describe.skipIf(process.platform === "win32")("remote Workspace safety", () => {
  let root: string;
  beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "aem-remote-safety-"))); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  const setup = async (sshTransport = transport) => {
    const projectRoot = join(root, "workspace");
    const destination = join(projectRoot, "skills", "review");
    const instruction = join(projectRoot, "AGENTS.md");
    const libraryPath = join(root, "library");
    await mkdir(destination, { recursive: true });
    await mkdir(libraryPath);
    await writeFile(instruction, "original");
    await writeFile(join(destination, "SKILL.md"), "old");
    await writeFile(join(destination, "obsolete.txt"), "old file");
    await writeFile(join(libraryPath, "SKILL.md"), "new");
    await writeFile(join(libraryPath, ".agentenv-skill.json"), "{}");
    const device = { id: "remote", host: "fixture" } as RemoteDevice;
    const project = { id: "workspace", rootPath: projectRoot, deviceId: device.id };
    const recoveryStore = createProjectRecoveryStore(join(root, "data"));
    const environmentService = {
      findResource: async (_id: string, resourceId: string) => resourceId === "instruction"
        ? { kind: "instructions", state: "ready", editable: true, absolutePath: instruction, name: "AGENTS.md" }
        : { kind: "skill", state: "ready", editable: true, absolutePath: destination, contentHash: await hashSkillContent(destination) },
      resolveInstructionDestination: async () => ({ projectRoot, destination: instruction }),
      resolveSkillDestination: async () => ({ projectRoot, skillRoot: join(projectRoot, "skills"), destination }),
      assertProjectSkillPath: async () => undefined
    } as unknown as ProjectEnvironmentService;
    const service = createProjectMutationService({
      environmentService, recoveryStore, sshTransport,
      projectStore: { listProjects: async () => [project] } as unknown as ProjectStore,
      deviceStore: { get: async () => device } as unknown as RemoteDeviceStore,
      enabledAgentIds: async () => ["codex"],
      skillLibraryStore: { listSkills: async () => [{ id: "review", path: libraryPath } as SkillLibraryEntry] }
    });
    return { service, recoveryStore, destination, instruction, libraryPath, device };
  };

  it("replaces a remote Skill completely without leaking Library metadata", async () => {
    const { service, destination, libraryPath } = await setup();
    await service.addSkill({ projectId: "workspace", locationId: "skills", libraryId: "review", conflictResolution: "replace" });
    expect(await hashSkillContent(destination)).toBe(await hashSkillContent(libraryPath));
    await expect(readFile(join(destination, "obsolete.txt"))).rejects.toThrow();
    await expect(readFile(join(destination, ".agentenv-skill.json"))).rejects.toThrow();
  });

  it("preserves externally edited instructions when restoring a remote recovery point", async () => {
    const { service, instruction } = await setup();
    const result = await service.save({ projectId: "workspace", resourceId: "instruction", expectedHash: hashFileContent("original"), content: "applied" });
    await writeFile(instruction, "external edit");
    await expect(service.restore(result.receiptId!)).rejects.toThrow(/changed/);
    expect(await readFile(instruction, "utf8")).toBe("external edit");
  });

  it("does not treat a failed remote read as permission to create an instruction", async () => {
    let writes = 0;
    const { service, recoveryStore } = await setup({ execute: async (_device, _command, options) => {
      if (options?.input) writes++;
      throw new Error("SSH permission denied");
    } });
    await expect(service.prepareInstruction("workspace", "codex")).rejects.toThrow("SSH permission denied");
    await expect(service.createInstruction({ projectId: "workspace", agentId: "codex", content: "new" })).rejects.toThrow("SSH permission denied");
    expect(writes).toBe(0);
    expect(await recoveryStore.list()).toEqual([]);
  });

  it("does not report recovery as successful when the remote device is unreachable", async () => {
    let offline = false;
    const { service, recoveryStore } = await setup({ execute: (...args) => {
      if (offline) return Promise.reject(new Error("SSH offline"));
      return transport.execute(...args);
    } });
    const result = await service.addSkill({ projectId: "workspace", locationId: "skills", libraryId: "review", conflictResolution: "replace" });
    offline = true;
    await expect(service.restore(result.receiptId!)).rejects.toThrow();
    expect((await recoveryStore.get(result.receiptId!)).status).not.toBe("restored");
  });

  it("rejects archive links before extracting any content", async () => {
    const source = join(root, "archive");
    await mkdir(source);
    await symlink(root, join(source, "escape"));
    const archive = await createTarArchiveFromDirectory(source);
    await expect(extractTarArchiveSafely(archive, join(root, "extracted"))).rejects.toThrow(/link/);
  });

  it("expands the remote home shorthand without evaluating directory characters", async () => {
    const name = "project ' $(touch injected)";
    await mkdir(join(root, name));
    const homeTransport: SshTransport = { execute: (device, command, options) =>
      transport.execute(device, `HOME=${shellQuote(root)} ${command}`, options) };
    const probe = await testRemoteProjectPath({} as RemoteDevice, homeTransport, `~/${name}`);
    expect(probe).toMatchObject({ exists: true, canonicalPath: join(root, name), isDirectory: true });
    const directories = await listRemoteDirectories({} as RemoteDevice, homeTransport, "~");
    expect(directories.currentPath).toBe(root);
    expect(directories.directories.map((entry) => entry.name)).toContain(name);
    await expect(readFile(join(root, "injected"))).rejects.toThrow();
  });

  it("rejects a linked parent before reading resources outside the Workspace", async () => {
    const project = join(root, "workspace");
    const outside = join(root, "outside");
    await mkdir(project);
    await mkdir(join(outside, "skills"), { recursive: true });
    await symlink(outside, join(project, ".agents"));
    await expect(fetchRemoteWorkspaceResourcesTar({} as RemoteDevice, transport, project, [".agents/skills"]))
      .rejects.toThrow(/link/i);
  });

  it("preserves spaces in archive candidates and skips only missing paths", async () => {
    await writeFile(join(root, "My instructions.md"), "workspace rules");
    const archive = await fetchRemoteWorkspaceResourcesTar({} as RemoteDevice, transport, root,
      ["missing.md", "My instructions.md", "also-missing.md"]);
    const destination = join(root, "extracted");
    await extractTarArchiveSafely(archive, destination);
    expect(await readFile(join(destination, "My instructions.md"), "utf8")).toBe("workspace rules");
  });

  it("keeps special directory characters literal across the local and remote shells", async () => {
    const path = "/work/it's $(touch injected) $HOME `pwd`";
    const command = workspaceSshCommand({ host: "fixture", port: 2222 }, path);
    const result = await transport.execute({} as RemoteDevice,
      `ssh() { printf '%s\\0' "$@"; }; ${command}`);
    const args = result.stdout.toString().split("\0").filter(Boolean);
    expect(args.slice(0, 5)).toEqual(["-p", "2222", "-t", "--", "fixture"]);
    const remote = args[5]!;
    expect(remote).toContain('exec "${SHELL:-/bin/sh}" -l');
    const interpreted = await transport.execute({} as RemoteDevice,
      `cd() { printf '%s' "$1"; }; ${remote.split(" && exec")[0]}`);
    expect(interpreted.stdout.toString()).toBe(path);
  });

  it("refuses recovery after the SSH device address changes", async () => {
    const { service, device, instruction } = await setup();
    const result = await service.save({ projectId: "workspace", resourceId: "instruction", expectedHash: hashFileContent("original"), content: "applied" });
    device.host = "another-device";
    await expect(service.restore(result.receiptId!)).rejects.toThrow(/does not match/);
    expect(await readFile(instruction, "utf8")).toBe("applied");
  });

  it("preserves recovery-required status after a connection loss following a write", async () => {
    let offline = false;
    const { service, recoveryStore } = await setup({ execute: async (...args) => {
      if (offline) throw new Error("SSH disconnected");
      const result = await transport.execute(...args);
      if (args[2]?.input) { offline = true; throw new Error("SSH disconnected after write"); }
      return result;
    } });
    await expect(service.save({ projectId: "workspace", resourceId: "instruction", expectedHash: hashFileContent("original"), content: "applied" }))
      .rejects.toThrow(/recovery requires attention/);
    expect((await recoveryStore.list())[0]?.status).toBe("recovery-required");
    offline = false;
  });

  it("retains external Skill edits when a recovery point is used", async () => {
    const { service, destination } = await setup();
    const result = await service.addSkill({ projectId: "workspace", locationId: "skills", libraryId: "review", conflictResolution: "replace" });
    await writeFile(join(destination, "extra.txt"), "external");
    await expect(service.restore(result.receiptId!)).rejects.toThrow(/changed/);
    expect(await readFile(join(destination, "extra.txt"), "utf8")).toBe("external");
  });

  it("checks the live instruction again at commit without blocking recovery for a rejected write", async () => {
    let instruction = "";
    const fixture = await setup({ execute: async (...args) => {
      if (args[2]?.input) await writeFile(instruction, "racing external edit");
      return transport.execute(...args);
    } });
    instruction = fixture.instruction;
    await expect(fixture.service.save({ projectId: "workspace", resourceId: "instruction", expectedHash: hashFileContent("original"), content: "applied" }))
      .rejects.toThrow(/changed after review/);
    expect(await readFile(instruction, "utf8")).toBe("racing external edit");
    expect((await fixture.recoveryStore.list())[0]?.status).toBe("failed-restored");
  });

  it("restores replaced Skill contents exactly, including removing newly deployed files", async () => {
    const { service, destination, libraryPath } = await setup();
    const originalHash = await hashSkillContent(destination);
    await writeFile(join(libraryPath, "new-only.txt"), "new file");
    const result = await service.addSkill({ projectId: "workspace", locationId: "skills", libraryId: "review", conflictResolution: "replace" });
    await service.restore(result.receiptId!);
    expect(await hashSkillContent(destination)).toBe(originalHash);
    await expect(readFile(join(destination, "new-only.txt"))).rejects.toThrow();
    expect(await readFile(join(destination, "obsolete.txt"), "utf8")).toBe("old file");
  });
});
