import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import type {
  ActivationPreview,
  ApplyIssue,
  ApplyResult,
  CreateRemoteDeviceInput,
  ManagedResourceSnapshot,
  PlannedFileChange,
  PlannedResourceChange,
  ProfileDetail,
  RemoteAgentEndpoint,
  RemoteDevice,
  RemoteDeviceProbe,
  SshConfigHost,
  SshConfigHostResolution,
  TargetManagementState,
  TargetPaths,
  UpdateRemoteDeviceInput
} from "../../shared/types";
import { collectLibraryResourceVersions, libraryResourceVersionsEqual } from "../../shared/libraryVersions";
import { profileEffectiveInstructions } from "../../shared/profileInstructions";
import { materializeTargetResourcePolicy, profileResourceMode } from "../../shared/profileResources";
import { createUnifiedDiff } from "../diff";
import { createExecutableResolver } from "../executableDiscovery";
import { hashPathEntry } from "../filesystemIntegrity";
import { pathEntryExists, readTextIfExists, writeAtomic } from "../fileUtils";
import type { AgentEnvPaths } from "../paths";
import { createProfileContentHash, createProfileSnapshotHash } from "../profileFingerprint";
import type { ProfileStore } from "../profileStore";
import { hashSkillContent } from "../skillContentHash";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { TargetRegistry } from "../targets/registry";
import { createRemoteDeviceStore, type RemoteDeviceStore } from "./remoteDeviceStore";
import {
  createRemoteEndpointStateRepository,
  type RemoteEndpointState,
  type RemoteEndpointStateRepository
} from "./remoteEndpointStateRepository";
import {
  createSystemSshTransport,
  remoteDeviceFingerprint,
  shellQuote,
  type SshTransport
} from "./systemSshTransport";
import { createSshConfigDiscovery, type SshConfigDiscovery } from "./sshConfigDiscovery";

const ENDPOINT_PREFIX = "ssh:";
const PROBE_TTL_MS = 30_000;
const PREVIEW_TTL_MS = 30 * 60_000;
const MAX_REMOTE_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const LIBRARY_METADATA_FILES = [".agentenv-skill.json", ".agentenv-owner.json"];

interface RemoteOperation {
  relativePath: string;
  localPath: string;
  action: "write" | "remove";
  kind: "instructions" | "skill";
  name: string;
  origin: "adopted" | "created" | "replaced";
}

interface PendingRemotePreview {
  publicPreview: ActivationPreview;
  endpoint: RemoteAgentEndpoint & {
    availability: "ready";
    homeDir: string;
    executablePath: string;
  };
  device: RemoteDevice;
  profile: ProfileDetail;
  profileHash: string;
  snapshotHash: string;
  snapshotPaths: string[];
  operations: RemoteOperation[];
  desiredRoot: string;
  nextManagedResources: ManagedResourceSnapshot[];
  expiresAt: number;
}

export interface RemoteActivationService {
  listDevices(): Promise<RemoteDevice[]>;
  listSshConfigHosts(): Promise<SshConfigHost[]>;
  resolveSshConfigHost(alias: string): Promise<SshConfigHostResolution>;
  addDevice(input: CreateRemoteDeviceInput): Promise<RemoteDevice>;
  updateDevice(input: UpdateRemoteDeviceInput): Promise<RemoteDevice>;
  removeDevice(id: string): Promise<void>;
  probeDevice(id: string, forceRefresh?: boolean): Promise<RemoteDeviceProbe>;
  listEndpoints(forceRefresh?: boolean): Promise<RemoteAgentEndpoint[]>;
  listTargetStates(): Promise<TargetManagementState[]>;
  isEndpointId(id: string): boolean;
  hasPreview(id: string): boolean;
  previewProfile(profileId: string, endpointId: string): Promise<ActivationPreview>;
  applyProfile(profileId: string, previewId: string): Promise<ApplyResult>;
}

const endpointIdFor = (deviceId: string, agentId: string) =>
  `${ENDPOINT_PREFIX}${deviceId}:${agentId}`;

const parseEndpointId = (value: string) => {
  if (!value.startsWith(ENDPOINT_PREFIX)) throw new Error("Invalid SSH Agent endpoint");
  const [deviceId, agentId, ...extra] = value.slice(ENDPOINT_PREFIX.length).split(":");
  if (!deviceId || !agentId || extra.length > 0) throw new Error("Invalid SSH Agent endpoint");
  return { deviceId, agentId };
};

const hashBuffer = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const hashText = (value: string) => createHash("sha256").update(value).digest("hex");
const connectionIdentityFor = (device: RemoteDevice) =>
  `${device.user ?? ""}@${device.host}:${device.port ?? 22}`;

const relativeToRemoteHome = (homeDir: string, path: string) => {
  const normalizedHome = posix.resolve(homeDir);
  const normalizedPath = posix.resolve(path);
  const relativePath = posix.relative(normalizedHome, normalizedPath);
  if (!relativePath || relativePath === ".") return ".";
  if (relativePath === ".." || relativePath.startsWith("../") || posix.isAbsolute(relativePath)) {
    throw new Error(`Remote Agent path is outside HOME: ${path}`);
  }
  return relativePath;
};

const localPathFor = (root: string, relativePath: string) =>
  join(root, ...relativePath.split("/"));

const runLocalCommand = async (
  executable: string,
  args: string[],
  options: { input?: Buffer; maxOutputBytes?: number } = {}
): Promise<Buffer> => await new Promise((resolvePromise, reject) => {
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let size = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > (options.maxOutputBytes ?? MAX_REMOTE_SNAPSHOT_BYTES)) {
      child.kill("SIGTERM");
      reject(new Error("Local archive operation produced too much output"));
      return;
    }
    stdout.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolvePromise(Buffer.concat(stdout));
    else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `Command exited with ${code}`));
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(options.input);
});

export const validateRemoteSnapshotArchive = (archive: Buffer) => {
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return;
    const type = String.fromCharCode(header[156] ?? 0).replace("\0", "");
    if (type === "1" || type === "2") {
      throw new Error("Remote Agent snapshot contains a symbolic link or hard link");
    }
    if (!["", "0", "5", "7", "x", "g", "L", "K"].includes(type)) {
      throw new Error("Remote Agent snapshot contains an unsupported filesystem entry");
    }
    const rawSize = header.subarray(124, 136);
    if ((rawSize[0] ?? 0) & 0x80) {
      throw new Error("Remote Agent snapshot uses an unsupported archive size encoding");
    }
    const encodedSize = rawSize.toString("ascii").replaceAll("\0", "").trim();
    const size = encodedSize ? Number.parseInt(encodedSize, 8) : 0;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Remote Agent snapshot has an invalid archive entry size");
    }
    offset += 512 + Math.ceil(size / 512) * 512;
    if (offset > archive.length) {
      throw new Error("Remote Agent snapshot is truncated");
    }
  }
  if (offset !== archive.length) {
    throw new Error("Remote Agent snapshot is malformed");
  }
};

const collectVerificationCommands = async (
  basePath: string,
  relativePath: string,
  remoteHome: string
): Promise<string[]> => {
  const localPath = localPathFor(basePath, relativePath);
  const remotePath = posix.join(remoteHome, relativePath);
  const stats = await lstat(localPath);
  if (stats.isSymbolicLink()) {
    return [`[ "$(readlink ${shellQuote(remotePath)})" = ${shellQuote(await readlink(localPath))} ]`];
  }
  if (stats.isFile()) {
    const hash = createHash("sha256").update(await readFile(localPath)).digest("hex");
    return [`[ "$(sha256sum ${shellQuote(remotePath)} | cut -d ' ' -f 1)" = ${shellQuote(hash)} ]`];
  }
  if (!stats.isDirectory()) throw new Error(`Unsupported remote resource entry: ${relativePath}`);
  const commands = [`[ -d ${shellQuote(remotePath)} ]`];
  for (const entry of (await readdir(localPath)).sort()) {
    commands.push(...await collectVerificationCommands(
      basePath,
      posix.join(relativePath, entry),
      remoteHome
    ));
  }
  return commands;
};

const createApplyScript = async (
  remoteHome: string,
  operationId: string,
  operations: RemoteOperation[],
  payloadRoot: string
) => {
  const stateRoot = posix.join(remoteHome, ".local", "state", "agentenv-manager", "operations", operationId);
  const lines = [
    "set -eu",
    `op=${shellQuote(stateRoot)}`,
    'umask 077',
    'mkdir -p "$op/backup" "$op/touched"',
    'printf staging > "$op/status"',
    'rollback() {',
    '  set +e'
  ];
  for (const [index, operation] of [...operations.entries()].reverse()) {
    const target = posix.join(remoteHome, operation.relativePath);
    const backup = posix.join(stateRoot, "backup", operation.relativePath);
    const touched = posix.join(stateRoot, "touched", String(index));
    lines.push(`  if [ -e ${shellQuote(touched)} ]; then`);
    lines.push(`    rm -rf ${shellQuote(target)}`);
    lines.push(`    if [ -e ${shellQuote(backup)} ] || [ -L ${shellQuote(backup)} ]; then mkdir -p ${shellQuote(posix.dirname(target))}; cp -a ${shellQuote(backup)} ${shellQuote(target)}; fi`);
    lines.push("  fi");
  }
  lines.push('  printf rolled-back > "$op/status"', '}', "trap rollback EXIT HUP INT TERM");
  for (const [index, operation] of operations.entries()) {
    const target = posix.join(remoteHome, operation.relativePath);
    const backup = posix.join(stateRoot, "backup", operation.relativePath);
    const staged = posix.join(stateRoot, "staged", operation.relativePath);
    const touched = posix.join(stateRoot, "touched", String(index));
    lines.push(`mkdir -p ${shellQuote(posix.dirname(backup))}`);
    lines.push(`if [ -e ${shellQuote(target)} ] || [ -L ${shellQuote(target)} ]; then cp -a ${shellQuote(target)} ${shellQuote(backup)}; fi`);
    lines.push(`: > ${shellQuote(touched)}`);
    lines.push(`rm -rf ${shellQuote(target)}`);
    if (operation.action === "write") {
      lines.push(`mkdir -p ${shellQuote(posix.dirname(target))}`);
      lines.push(`cp -a ${shellQuote(staged)} ${shellQuote(target)}`);
    }
  }
  for (const operation of operations) {
    const target = posix.join(remoteHome, operation.relativePath);
    if (operation.action === "remove") {
      lines.push(`[ ! -e ${shellQuote(target)} ] && [ ! -L ${shellQuote(target)} ]`);
    } else {
      lines.push(...await collectVerificationCommands(payloadRoot, operation.relativePath, remoteHome));
    }
  }
  lines.push(
    'printf committed > "$op/status"',
    'trap - EXIT HUP INT TERM',
    'printf "%s\\n" "$op"'
  );
  return lines.join("\n");
};

const createApplyBootstrap = (remoteHome: string, operationId: string) => {
  const stateRoot = posix.join(
    remoteHome,
    ".local",
    "state",
    "agentenv-manager",
    "operations",
    operationId
  );
  return [
    "set -eu",
    `op=${shellQuote(stateRoot)}`,
    "umask 077",
    'mkdir -p "$op/staged"',
    'printf receiving > "$op/status"',
    'if ! tar -xf - -C "$op/staged"; then printf rolled-back > "$op/status"; exit 1; fi',
    'sh "$op/staged/.agentenv-apply.sh"'
  ].join("\n");
};

const targetSnapshotPaths = (targetPaths: TargetPaths) => [
  targetPaths.instructionsPath,
  targetPaths.instructionsOverridePath,
  targetPaths.skillsDir,
  ...(targetPaths.skillLocations ?? [])
    .filter((location) => location.shared)
    .map((location) => location.path)
].filter((path): path is string => Boolean(path));

const publicStateFor = (
  endpoint: RemoteAgentEndpoint,
  state: RemoteEndpointState | undefined
): TargetManagementState => ({
  targetId: endpoint.id,
  activeProfileId: state?.activeProfileId,
  activeProfileName: state?.appliedProfileSnapshot?.profileName,
  appliedProfileHash: state?.appliedProfileHash,
  appliedProfileSnapshot: state?.appliedProfileSnapshot
    ? {
        profileId: state.appliedProfileSnapshot.profileId,
        profileName: state.appliedProfileSnapshot.profileName,
        capturedAt: state.appliedProfileSnapshot.capturedAt,
        contentHash: state.appliedProfileSnapshot.contentHash,
        instructionsLength: state.appliedProfileSnapshot.instructions.length,
        skillCount: state.appliedProfileSnapshot.resources.skills.length,
        mcpCount: Object.values(state.appliedProfileSnapshot.resources.mcpByTarget)
          .reduce((count, policy) => count + policy.selections.length, 0)
      }
    : undefined,
  appliedLibraryVersions: state?.appliedLibraryVersions,
  status: state?.activeProfileId ? "managed" : "unmanaged",
  lifecycleStatus: state?.recoveryRequired
    ? "recovery-required"
    : state?.activeProfileId
      ? "applied"
      : "unmanaged",
  lifecycleReason: state?.recoveryRequired?.error,
  lastAppliedAt: state?.lastAppliedAt,
  managedResourceCount: state?.managedResources?.length ?? 0,
  warningCount: 0,
  errorCount: state?.recoveryRequired ? 1 : 0
});

export const createRemoteActivationService = (options: {
  paths: AgentEnvPaths;
  profileStore: ProfileStore;
  skillLibraryStore: SkillLibraryStore;
  targetRegistry: TargetRegistry;
  deviceStore?: RemoteDeviceStore;
  stateRepository?: RemoteEndpointStateRepository;
  transport?: SshTransport;
  sshConfigDiscovery?: SshConfigDiscovery;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}): RemoteActivationService => {
  const deviceStore = options.deviceStore ?? createRemoteDeviceStore(options.paths);
  const stateRepository = options.stateRepository ?? createRemoteEndpointStateRepository(options.paths);
  const transport = options.transport ?? createSystemSshTransport({
    homeDir: options.paths.homeDir,
    platform: options.platform,
    environment: options.environment
  });
  const sshConfigDiscovery = options.sshConfigDiscovery ?? createSshConfigDiscovery({
    homeDir: options.paths.homeDir,
    platform: options.platform,
    environment: options.environment
  });
  const tarResolver = createExecutableResolver({
    homeDir: options.paths.homeDir,
    platform: options.platform ?? process.platform,
    environment: options.environment ?? process.env,
    pathEnv: options.environment?.PATH ?? process.env.PATH ?? "",
    systemPathLookup: true,
    shellPathLookup: true
  });
  const probes = new Map<string, { probe: RemoteDeviceProbe; at: number }>();
  const previews = new Map<string, PendingRemotePreview>();
  let previewCachePreparation: Promise<void> | undefined;

  const preparePreviewCache = () => {
    previewCachePreparation ??= (async () => {
      await rm(options.paths.remotePreviewCacheDir, { recursive: true, force: true });
      await mkdir(options.paths.remotePreviewCacheDir, { recursive: true, mode: 0o700 });
    })();
    return previewCachePreparation;
  };

  const disposePreview = async (previewId: string) => {
    const pending = previews.get(previewId);
    previews.delete(previewId);
    if (pending) await rm(dirname(pending.desiredRoot), { recursive: true, force: true });
  };

  const sweepExpiredPreviews = async () => {
    const expired = [...previews.entries()]
      .filter(([, pending]) => pending.expiresAt < Date.now())
      .map(([previewId]) => previewId);
    await Promise.all(expired.map(disposePreview));
  };

  const cleanupRemoteOperation = async (
    device: RemoteDevice,
    endpoint: RemoteAgentEndpoint,
    operationId: string
  ) => {
    if (!endpoint.homeDir) return;
    const operationRoot = posix.join(
      endpoint.homeDir,
      ".local",
      "state",
      "agentenv-manager",
      "operations",
      operationId
    );
    await transport.execute(
      device,
      `sh -c ${shellQuote(`rm -rf -- ${shellQuote(operationRoot)}`)}`,
      { timeoutMs: 15_000, maxOutputBytes: 1024 }
    ).catch(() => undefined);
  };

  const clearRecoveryState = (state: RemoteEndpointState): RemoteEndpointState => {
    const { recoveryRequired: _recoveryRequired, pendingAppliedState: _pending, ...rest } = state;
    return rest;
  };

  const reconcileRemoteRecovery = async (
    device: RemoteDevice,
    endpoint: RemoteAgentEndpoint,
    state: RemoteEndpointState | undefined
  ): Promise<RemoteEndpointState | undefined> => {
    const operationId = state?.recoveryRequired?.operationId;
    if (!state?.recoveryRequired || !operationId) return state;
    if (endpoint.availability !== "ready" || !endpoint.homeDir) return state;
    const operationRoot = posix.join(
      endpoint.homeDir,
      ".local",
      "state",
      "agentenv-manager",
      "operations",
      operationId
    );
    const statusResult = await transport.execute(
      device,
      `sh -c ${shellQuote(`cat ${shellQuote(posix.join(operationRoot, "status"))} 2>/dev/null || true`)}`,
      { timeoutMs: 15_000, maxOutputBytes: 1024 }
    ).catch(() => undefined);
    if (!statusResult || statusResult.exitCode !== 0) return state;
    const remoteStatus = statusResult.stdout.toString("utf8").trim();
    if (remoteStatus === "committed" && state.pendingAppliedState) {
      const reconciled: RemoteEndpointState = {
        ...clearRecoveryState(state),
        ...state.pendingAppliedState
      };
      await stateRepository.write(reconciled);
      await cleanupRemoteOperation(device, endpoint, operationId);
      return reconciled;
    }
    if (remoteStatus === "rolled-back") {
      const reconciled = clearRecoveryState(state);
      await stateRepository.write(reconciled);
      await cleanupRemoteOperation(device, endpoint, operationId);
      return reconciled;
    }
    return state;
  };

  const probeDevice = async (id: string, forceRefresh = false): Promise<RemoteDeviceProbe> => {
    const cached = probes.get(id);
    if (!forceRefresh && cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.probe;
    const device = await deviceStore.get(id);
    const commandNames = [...new Set(options.targetRegistry.list().flatMap((target) => target.executableCandidates))]
      .filter((name) => /^[A-Za-z0-9._+-]+$/.test(name));
    const script = [
      "set -eu",
      "home=${HOME:?}",
      "printf 'HOME\\t%s\\n' \"$home\"",
      "printf 'OS\\t%s\\n' \"$(uname -s)\"",
      "printf 'ARCH\\t%s\\n' \"$(uname -m)\"",
      "if [ -r /etc/machine-id ]; then printf 'MACHINE\\t%s\\n' \"$(cat /etc/machine-id)\"; fi",
      "for tool in sh tar sha256sum; do command -v \"$tool\" >/dev/null 2>&1 || { printf 'MISSING\\t%s\\n' \"$tool\"; }; done",
      ...commandNames.map((name) => `if path=$(command -v ${shellQuote(name)} 2>/dev/null); then printf 'CMD\\t%s\\t%s\\n' ${shellQuote(name)} "$path"; fi`)
    ].join("\n");
    let probe: RemoteDeviceProbe;
    try {
      const result = await transport.execute(device, `sh -c ${shellQuote(script)}`, { timeoutMs: 15_000 });
      if (result.exitCode !== 0) throw new Error(result.stderr || "SSH probe failed");
      const values = new Map<string, string>();
      const commands: Record<string, string> = {};
      const missing: string[] = [];
      for (const line of result.stdout.toString("utf8").split("\n")) {
        const [kind, key, value] = line.split("\t");
        if (kind === "CMD" && key && value) commands[key] = value;
        else if (kind === "MISSING" && key) missing.push(key);
        else if (kind && key) values.set(kind, key);
      }
      const homeDir = values.get("HOME");
      const platform = values.get("OS");
      const architecture = values.get("ARCH");
      if (!homeDir || !platform || !architecture) throw new Error("Remote probe returned incomplete device information");
      const supported = platform === "Linux" && missing.length === 0;
      probe = {
        deviceId: id,
        status: supported ? "ready" : "unsupported",
        homeDir,
        platform,
        architecture,
        deviceFingerprint: remoteDeviceFingerprint({
          homeDir,
          platform,
          architecture,
          machineId: values.get("MACHINE"),
          connectionIdentity: connectionIdentityFor(device)
        }),
        agentExecutables: commands,
        checkedAt: new Date().toISOString(),
        ...(supported ? {} : { error: missing.length > 0 ? `Missing remote tools: ${missing.join(", ")}` : `Unsupported remote system: ${platform}` })
      };
    } catch (error) {
      probe = {
        deviceId: id,
        status: "unavailable",
        agentExecutables: {},
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
    probes.set(id, { probe, at: Date.now() });
    return probe;
  };

  const listEndpoints = async (forceRefresh = false) => {
    const devices = await deviceStore.list();
    const deviceProbes = await Promise.all(devices.map(async (device) => ({
      device,
      probe: await probeDevice(device.id, forceRefresh)
    })));
    const endpoints: RemoteAgentEndpoint[] = [];
    for (const { device, probe } of deviceProbes) {
      if (probe.status !== "ready" || !probe.homeDir || !probe.deviceFingerprint) continue;
      for (const descriptor of options.targetRegistry.list()) {
        const executable = descriptor.executableCandidates
          .map((candidate) => probe.agentExecutables[candidate])
          .find(Boolean);
        if (!executable) continue;
        endpoints.push({
          id: endpointIdFor(device.id, descriptor.id),
          deviceId: device.id,
          deviceName: device.name,
          agentId: descriptor.id,
          agentName: descriptor.name,
          homeDir: probe.homeDir,
          executablePath: executable,
          deviceFingerprint: probe.deviceFingerprint,
          checkedAt: probe.checkedAt,
          availability: "ready",
          capabilities: {
            apply: true,
            capture: false,
            conversations: false,
            workspaceOpen: false,
            comparison: false
          }
        });
      }
    }
    const endpointIds = new Set(endpoints.map((endpoint) => endpoint.id));
    const deviceById = new Map(devices.map((device) => [device.id, device]));
    const probeByDeviceId = new Map(deviceProbes.map(({ device, probe }) => [device.id, probe]));
    for (const state of await stateRepository.list()) {
      if (endpointIds.has(state.endpointId)) continue;
      const { deviceId, agentId } = parseEndpointId(state.endpointId);
      const device = deviceById.get(deviceId);
      if (!device) continue;
      let descriptor;
      try {
        descriptor = options.targetRegistry.get(agentId).descriptor;
      } catch {
        continue;
      }
      const probe = probeByDeviceId.get(deviceId);
      const availability = probe?.status === "ready"
        ? "agent-missing"
        : probe?.status ?? "unavailable";
      endpoints.push({
        id: state.endpointId,
        deviceId,
        deviceName: device.name,
        agentId,
        agentName: descriptor.name,
        homeDir: probe?.homeDir,
        executablePath: undefined,
        deviceFingerprint: state.deviceFingerprint,
        checkedAt: probe?.checkedAt ?? state.lastAppliedAt ?? device.updatedAt,
        availability,
        availabilityReason: availability === "agent-missing"
          ? `${descriptor.name} is no longer installed on ${device.name}`
          : probe?.error ?? "SSH device is unavailable",
        capabilities: {
          apply: true,
          capture: false,
          conversations: false,
          workspaceOpen: false,
          comparison: false
        }
      });
    }
    return endpoints;
  };

  const endpointFor = async (endpointId: string) => {
    const parsed = parseEndpointId(endpointId);
    const device = await deviceStore.get(parsed.deviceId);
    const probe = await probeDevice(device.id, true);
    if (probe.status !== "ready" || !probe.homeDir || !probe.deviceFingerprint) {
      throw new Error(probe.error ?? "SSH device is unavailable");
    }
    const descriptor = options.targetRegistry.get(parsed.agentId).descriptor;
    const executable = descriptor.executableCandidates
      .map((candidate) => probe.agentExecutables[candidate])
      .find(Boolean);
    if (!executable) throw new Error(`${descriptor.name} is not installed on ${device.name}`);
    return {
      device,
      endpoint: {
        id: endpointId,
        deviceId: device.id,
        deviceName: device.name,
        agentId: descriptor.id,
        agentName: descriptor.name,
        homeDir: probe.homeDir,
        executablePath: executable,
        deviceFingerprint: probe.deviceFingerprint,
        checkedAt: probe.checkedAt,
        availability: "ready" as const,
        capabilities: {
          apply: true as const,
          capture: false as const,
          conversations: false as const,
          workspaceOpen: false as const,
          comparison: false as const
        }
      } as RemoteAgentEndpoint & {
        availability: "ready";
        homeDir: string;
        executablePath: string;
      }
    };
  };

  const createRemoteTargetPaths = (endpoint: RemoteAgentEndpoint & { homeDir: string }) =>
    options.targetRegistry.get(endpoint.agentId).createTargetPaths({
      homeDir: endpoint.homeDir,
      platform: "linux",
      environment: { HOME: endpoint.homeDir }
    });

  const snapshotRemote = async (
    device: RemoteDevice,
    homeDir: string,
    absolutePaths: string[]
  ) => {
    const relativePaths = [...new Set(absolutePaths.map((path) => relativeToRemoteHome(homeDir, path)))];
    const script = [
      "set -eu",
      "set --",
      ...relativePaths.map((path) => `if [ -e ${shellQuote(posix.join(homeDir, path))} ] || [ -L ${shellQuote(posix.join(homeDir, path))} ]; then set -- "$@" ${shellQuote(path)}; fi`),
      `if [ "$#" -eq 0 ]; then tar -cf - -C ${shellQuote(homeDir)} --files-from /dev/null; else tar -cf - -C ${shellQuote(homeDir)} "$@"; fi`
    ].join("\n");
    const result = await transport.execute(device, `sh -c ${shellQuote(script)}`, {
      timeoutMs: 45_000,
      maxOutputBytes: MAX_REMOTE_SNAPSHOT_BYTES
    });
    if (result.exitCode !== 0) throw new Error(result.stderr || "Could not read the remote Agent");
    return { archive: result.stdout, fingerprint: hashBuffer(result.stdout), relativePaths };
  };

  const extractArchive = async (archive: Buffer, destination: string) => {
    validateRemoteSnapshotArchive(archive);
    const tar = await tarResolver.find("tar");
    if (!tar) throw new Error("System tar was not found");
    const listing = (await runLocalCommand(tar, ["-tf", "-"], {
      input: archive,
      maxOutputBytes: 8 * 1024 * 1024
    })).toString("utf8");
    for (const rawEntry of listing.split("\n")) {
      const entry = rawEntry.replace(/^\.\//, "").replace(/\/$/, "");
      if (!entry) continue;
      if (
        entry.includes("\\") ||
        posix.isAbsolute(entry) ||
        entry.split("/").some((segment) => !segment || segment === "." || segment === "..")
      ) {
        throw new Error("Remote Agent snapshot contains an unsafe archive path");
      }
    }
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await runLocalCommand(tar, ["-xf", "-", "-C", destination], { input: archive });
  };

  const createPayloadArchive = async (payloadRoot: string) => {
    const tar = await tarResolver.find("tar");
    if (!tar) throw new Error("System tar was not found");
    return runLocalCommand(tar, ["-cf", "-", "-C", payloadRoot, "."], {
      maxOutputBytes: MAX_REMOTE_SNAPSHOT_BYTES
    });
  };

  const previewProfile = async (profileId: string, endpointId: string): Promise<ActivationPreview> => {
    await preparePreviewCache();
    await sweepExpiredPreviews();
    const { device, endpoint } = await endpointFor(endpointId);
    const adapter = options.targetRegistry.get(endpoint.agentId);
    const targetPaths = createRemoteTargetPaths(endpoint);
    const snapshotPaths = targetSnapshotPaths(targetPaths);
    const snapshot = await snapshotRemote(device, endpoint.homeDir, snapshotPaths);
    const previewRoot = options.paths.remotePreviewCacheDir || tmpdir();
    const root = await mkdtemp(join(previewRoot, "ssh-apply-"));
    const currentRoot = join(root, "current");
    const desiredRoot = join(root, "desired");
    await extractArchive(snapshot.archive, currentRoot);
    await cp(currentRoot, desiredRoot, { recursive: true, dereference: false, force: true });

    const profile = await options.profileStore.readProfile(profileId);
    const effectiveProfile = materializeTargetResourcePolicy(profile, endpoint.agentId);
    const profileHash = profile.targetContentHashes?.[endpoint.agentId]
      ?? createProfileContentHash(profile, endpoint.agentId);
    const skillLibrary = await options.skillLibraryStore.listSkills();
    const libraryById = new Map(skillLibrary.map((skill) => [skill.id, skill]));
    const state = await reconcileRemoteRecovery(
      device,
      endpoint,
      await stateRepository.read(endpoint.id)
    );
    if (state && state.deviceFingerprint !== endpoint.deviceFingerprint) {
      await rm(root, { recursive: true, force: true });
      throw new Error("This SSH destination now identifies a different device. Review the device before applying.");
    }
    if (state?.recoveryRequired) {
      await rm(root, { recursive: true, force: true });
      throw new Error(`Remote recovery is required before Apply: ${state.recoveryRequired.error}`);
    }

    const operations: RemoteOperation[] = [];
    const fileChanges: PlannedFileChange[] = [];
    const resourceChanges: PlannedResourceChange[] = [];
    const issues: ApplyIssue[] = [];
    const nextManagedResources: ManagedResourceSnapshot[] = [];
    const footprint = { adopted: 0, modified: 0, created: 0, removed: 0, liveLinks: 0 };

    const instructionsMode = profileResourceMode(effectiveProfile.resources, endpoint.agentId, "instructions");
    const instructionRelative = relativeToRemoteHome(endpoint.homeDir, targetPaths.instructionsPath);
    const currentInstructionPath = localPathFor(currentRoot, instructionRelative);
    const desiredInstructionPath = localPathFor(desiredRoot, instructionRelative);
    const beforeInstructions = await readTextIfExists(currentInstructionPath);
    const previousInstructionResource = state?.managedResources?.find(
      (resource) => resource.kind === "instructions" && resource.path === targetPaths.instructionsPath
    );
    if (instructionsMode === "manage") {
      const afterInstructions = profileEffectiveInstructions(effectiveProfile);
      if (beforeInstructions !== afterInstructions) {
        await writeAtomic(desiredInstructionPath, afterInstructions);
        operations.push({
          relativePath: instructionRelative,
          localPath: desiredInstructionPath,
          action: "write",
          kind: "instructions",
          name: adapter.descriptor.instructionsLabel,
          origin: beforeInstructions ? "replaced" : "created"
        });
        fileChanges.push({
          path: targetPaths.instructionsPath,
          before: beforeInstructions,
          after: afterInstructions,
          diff: createUnifiedDiff(targetPaths.instructionsPath, beforeInstructions, afterInstructions),
          action: "write",
          category: "instructions"
        });
        beforeInstructions ? footprint.modified++ : footprint.created++;
      } else if (afterInstructions) {
        footprint.adopted++;
      }
      if (afterInstructions) {
        nextManagedResources.push(
          beforeInstructions === afterInstructions && previousInstructionResource
            ? { ...previousInstructionResource, contentHash: hashText(afterInstructions), paused: undefined }
            : {
                kind: "instructions",
                id: "instructions",
                path: targetPaths.instructionsPath,
                contentHash: hashText(afterInstructions),
                materialization: "copy",
                origin: beforeInstructions === afterInstructions ? "adopted" : beforeInstructions ? "replaced" : "created"
              }
        );
      }
    } else if (instructionsMode === "disable" && state?.managedResources?.some(
      (resource) => resource.kind === "instructions" && resource.path === targetPaths.instructionsPath
    ) && await pathEntryExists(currentInstructionPath)) {
      await rm(desiredInstructionPath, { force: true });
      operations.push({
        relativePath: instructionRelative,
        localPath: desiredInstructionPath,
        action: "remove",
        kind: "instructions",
        name: adapter.descriptor.instructionsLabel,
        origin: "replaced"
      });
      fileChanges.push({
        path: targetPaths.instructionsPath,
        before: beforeInstructions,
        after: "",
        diff: createUnifiedDiff(targetPaths.instructionsPath, beforeInstructions, ""),
        action: "remove",
        category: "instructions"
      });
      footprint.removed++;
    } else if (instructionsMode === "ignore") {
      nextManagedResources.push(...(state?.managedResources ?? []).filter((resource) => resource.kind === "instructions"));
    }

    const mcpMode = profileResourceMode(effectiveProfile.resources, endpoint.agentId, "mcp");
    if (mcpMode !== "ignore") {
      issues.push({
        id: `remote-mcp-${endpoint.id}`,
        code: "unsupported-mcp-management",
        disposition: "block",
        resolution: "edit-profile",
        resourceKind: "mcp",
        message: `Remote ${adapter.descriptor.name} MCP settings cannot be isolated safely yet`,
        detail: "Set MCPs to Keep Agent for this Profile before applying over SSH. Definitions and credentials stay on the remote device."
      });
    }

    const skillsMode = profileResourceMode(effectiveProfile.resources, endpoint.agentId, "skills");
    const skillsDir = targetPaths.skillsDir;
    if (!skillsDir && skillsMode !== "ignore") {
      issues.push({
        id: `remote-skills-${endpoint.id}`,
        code: "unsupported-skill-management",
        disposition: "block",
        resolution: "edit-profile",
        resourceKind: "skill",
        message: `${adapter.descriptor.name} does not expose a remote Skills directory`
      });
    } else if (skillsDir) {
      const managedSkillResources = (state?.managedResources ?? []).filter((resource) => resource.kind === "skill");
      const desiredReferences = skillsMode === "manage"
        ? effectiveProfile.resources.skills.filter((reference) =>
            reference.enabled && libraryById.get(reference.libraryId)?.globallyEnabled !== false
          )
        : [];
      const desiredRemotePaths = new Set<string>();
      for (const reference of desiredReferences) {
        const librarySkill = libraryById.get(reference.libraryId);
        if (!librarySkill) {
          issues.push({
            id: `remote-missing-skill-${reference.libraryId}`,
            code: "missing-library-skill",
            disposition: "block",
            resolution: "edit-profile",
            resourceKind: "skill",
            resourceId: reference.libraryId,
            message: `Library Skill ${reference.libraryId} is unavailable`
          });
          continue;
        }
        const remotePath = posix.join(skillsDir, reference.targetName);
        desiredRemotePaths.add(remotePath);
        const skillRelative = relativeToRemoteHome(endpoint.homeDir, remotePath);
        const currentPath = localPathFor(currentRoot, skillRelative);
        const desiredPath = localPathFor(desiredRoot, skillRelative);
        const existing = await pathEntryExists(currentPath);
        const currentHash = existing ? await hashSkillContent(currentPath).catch(() => undefined) : undefined;
        const unchanged = currentHash === librarySkill.contentHash;
        const previousManagedResource = managedSkillResources.find(
          (resource) => resource.path === remotePath
        );
        const previouslyManaged = Boolean(previousManagedResource);
        if (!unchanged) {
          await rm(desiredPath, { recursive: true, force: true });
          await mkdir(dirname(desiredPath), { recursive: true, mode: 0o700 });
          await cp(librarySkill.path, desiredPath, { recursive: true, dereference: true });
          await Promise.all(LIBRARY_METADATA_FILES.map((name) => rm(join(desiredPath, name), { force: true })));
          operations.push({
            relativePath: skillRelative,
            localPath: desiredPath,
            action: "write",
            kind: "skill",
            name: reference.targetName,
            origin: existing ? "replaced" : "created"
          });
          resourceChanges.push({
            kind: "skill",
            action: existing ? "replace" : "install",
            name: reference.targetName,
            path: remotePath,
            source: librarySkill.path
          });
          if (existing && !previouslyManaged) {
            issues.push({
              id: `remote-replace-${endpoint.id}-${reference.targetName}`,
              code: "outside-skill-replacement",
              disposition: "review",
              resolution: "backup-replace",
              resourceKind: "skill",
              resourceId: reference.libraryId,
              path: remotePath,
              message: `Replace existing remote Skill ${reference.targetName}`,
              detail: "The current copy will be included in the remote recovery point before replacement."
            });
          }
          existing ? footprint.modified++ : footprint.created++;
        } else {
          footprint.adopted++;
        }
        nextManagedResources.push(
          unchanged && previousManagedResource
            ? {
                ...previousManagedResource,
                id: reference.libraryId,
                contentHash: librarySkill.contentHash,
                source: librarySkill.path,
                paused: undefined
              }
            : {
                kind: "skill",
                id: reference.libraryId,
                path: remotePath,
                contentHash: librarySkill.contentHash,
                source: librarySkill.path,
                materialization: "copy",
                origin: unchanged && !previouslyManaged ? "adopted" : existing ? "replaced" : "created"
              }
        );
      }

      if (skillsMode !== "ignore") {
        for (const managed of managedSkillResources) {
          if (desiredRemotePaths.has(managed.path)) continue;
          const relativePath = relativeToRemoteHome(endpoint.homeDir, managed.path);
          const currentPath = localPathFor(currentRoot, relativePath);
          if (!(await pathEntryExists(currentPath))) continue;
          await rm(localPathFor(desiredRoot, relativePath), { recursive: true, force: true });
          operations.push({
            relativePath,
            localPath: localPathFor(desiredRoot, relativePath),
            action: "remove",
            kind: "skill",
            name: posix.basename(managed.path),
            origin: "replaced"
          });
          resourceChanges.push({
            kind: "skill",
            action: "remove",
            name: posix.basename(managed.path),
            path: managed.path
          });
          footprint.removed++;
        }
      } else {
        nextManagedResources.push(...managedSkillResources.map((resource) => ({ ...resource, paused: true })));
      }

      if (skillsMode !== "ignore") {
        const desiredNames = new Set(desiredReferences.map((reference) => reference.targetName));
        for (const sharedLocation of (targetPaths.skillLocations ?? []).filter((location) => location.shared)) {
          for (const name of desiredNames) {
            const sharedPath = posix.join(sharedLocation.path, name);
            const sharedRelative = relativeToRemoteHome(endpoint.homeDir, sharedPath);
            if (!(await pathEntryExists(localPathFor(currentRoot, sharedRelative)))) continue;
            issues.push({
              id: `remote-shared-${endpoint.id}-${name}-${hashText(sharedPath).slice(0, 8)}`,
              code: "shared-skill-conflict",
              disposition: "block",
              resolution: "review-local-skills",
              resourceKind: "skill",
              resourceId: name,
              path: sharedPath,
              message: `Shared Skill ${name} is also loaded on ${device.name}`,
              detail: "Review the shared Skill on the remote device before Profile Apply. AgentEnv will not silently remove a shared copy that may affect other Agents."
            });
          }
        }
      }
    }

    const libraryVersions = collectLibraryResourceVersions(profile, skillLibrary, endpoint.agentId);
    const targetStateChanged =
      state?.activeProfileId !== profile.id ||
      state?.appliedProfileHash !== profileHash ||
      !libraryResourceVersionsEqual(state?.appliedLibraryVersions, libraryVersions) ||
      JSON.stringify(state?.managedResources ?? []) !== JSON.stringify(nextManagedResources);
    const preview: ActivationPreview = {
      id: randomUUID(),
      profileId,
      profileContentHash: profileHash,
      libraryVersions,
      createdAt: new Date().toISOString(),
      issues,
      changes: fileChanges,
      resourceChanges,
      liveFingerprints: {},
      resourceFingerprints: {},
      sourceFingerprints: {},
      targetStateChanged,
      targetId: endpoint.id,
      targetState: {
        formatVersion: 3,
        managedMcpNames: [],
        activeProfileId: state?.activeProfileId,
        appliedProfileHash: state?.appliedProfileHash,
        appliedProfileSnapshot: state?.appliedProfileSnapshot,
        appliedLibraryVersions: state?.appliedLibraryVersions,
        lastAppliedAt: state?.lastAppliedAt,
        managedResources: state?.managedResources,
        recoveryRequired: state?.recoveryRequired
      },
      effectivePayload: {
        instructions: instructionsMode === "manage" && profileEffectiveInstructions(effectiveProfile) ? 1 : 0,
        skills: nextManagedResources.filter((resource) => resource.kind === "skill" && !resource.paused).length,
        mcpServers: 0,
        total: (instructionsMode === "manage" && profileEffectiveInstructions(effectiveProfile) ? 1 : 0) + nextManagedResources.filter((resource) => resource.kind === "skill" && !resource.paused).length
      },
      localFootprint: footprint,
      operation: state?.activeProfileId ? "apply" : "takeover"
    };
    previews.set(preview.id, {
      publicPreview: preview,
      endpoint,
      device,
      profile,
      profileHash,
      snapshotHash: snapshot.fingerprint,
      snapshotPaths,
      operations,
      desiredRoot,
      nextManagedResources,
      expiresAt: Date.now() + PREVIEW_TTL_MS
    });
    return preview;
  };

  const applyProfile = async (profileId: string, previewId: string): Promise<ApplyResult> => {
    await preparePreviewCache();
    await sweepExpiredPreviews();
    const pending = previews.get(previewId);
    if (!pending || pending.profile.id !== profileId || pending.expiresAt < Date.now()) {
      await disposePreview(previewId);
      return { ok: false, kind: "stale", errors: ["Remote Apply preview expired; review the current device again"] };
    }
    if (pending.publicPreview.issues.some((issue) => issue.disposition === "block")) {
      return {
        ok: false,
        kind: "blocked",
        errors: pending.publicPreview.issues.filter((issue) => issue.disposition === "block").map((issue) => issue.message)
      };
    }
    if (pending.operations.length === 0 && !pending.publicPreview.targetStateChanged) {
      await disposePreview(previewId);
      return { ok: false, kind: "no-op", errors: ["No changes to apply"] };
    }
    const latestProfile = await options.profileStore.readProfile(profileId);
    const latestHash = latestProfile.targetContentHashes?.[pending.endpoint.agentId]
      ?? createProfileContentHash(latestProfile, pending.endpoint.agentId);
    if (latestHash !== pending.profileHash) {
      await disposePreview(previewId);
      return { ok: false, kind: "stale", errors: ["Profile changed after preview; review the remote device again"] };
    }
    const latestLibrary = await options.skillLibraryStore.listSkills();
    if (!libraryResourceVersionsEqual(
      collectLibraryResourceVersions(latestProfile, latestLibrary, pending.endpoint.agentId),
      pending.publicPreview.libraryVersions
    )) {
      await disposePreview(previewId);
      return { ok: false, kind: "stale", errors: ["Library Skills changed after preview; review the remote device again"] };
    }
    const currentEndpoint = await endpointFor(pending.endpoint.id);
    if (currentEndpoint.endpoint.deviceFingerprint !== pending.endpoint.deviceFingerprint) {
      await disposePreview(previewId);
      return { ok: false, kind: "stale", errors: ["SSH device identity changed after preview"] };
    }
    const latestSnapshot = await snapshotRemote(
      pending.device,
      pending.endpoint.homeDir,
      pending.snapshotPaths
    );
    if (latestSnapshot.fingerprint !== pending.snapshotHash) {
      await disposePreview(previewId);
      return { ok: false, kind: "stale", errors: ["The remote Agent changed after preview; review it again"] };
    }
    const operationId = randomUUID();
    const payloadRoot = join(dirname(pending.desiredRoot), "payload");
    await rm(payloadRoot, { recursive: true, force: true });
    await mkdir(payloadRoot, { recursive: true, mode: 0o700 });
    for (const operation of pending.operations) {
      if (operation.action !== "write") continue;
      const payloadPath = localPathFor(payloadRoot, operation.relativePath);
      await mkdir(dirname(payloadPath), { recursive: true, mode: 0o700 });
      await cp(operation.localPath, payloadPath, {
        recursive: true,
        dereference: false,
        force: true
      });
    }
    const script = await createApplyScript(
      pending.endpoint.homeDir,
      operationId,
      pending.operations,
      payloadRoot
    );
    await writeFile(join(payloadRoot, ".agentenv-apply.sh"), `${script}\n`, { mode: 0o700 });
    const payload = await createPayloadArchive(payloadRoot);
    const bootstrap = createApplyBootstrap(pending.endpoint.homeDir, operationId);
    const previousState = await stateRepository.read(pending.endpoint.id);
    const appliedAt = new Date().toISOString();
    const pendingAppliedState: NonNullable<RemoteEndpointState["pendingAppliedState"]> = {
      activeProfileId: pending.profile.id,
      appliedProfileHash: pending.profileHash,
      appliedProfileSnapshot: {
        profileId: pending.profile.id,
        profileName: pending.profile.manifest.name,
        capturedAt: appliedAt,
        contentHash: pending.profileHash,
        snapshotHash: createProfileSnapshotHash(pending.profile),
        manifest: pending.profile.manifest,
        instructions: profileEffectiveInstructions(pending.profile),
        resources: pending.profile.resources
      },
      appliedLibraryVersions: pending.publicPreview.libraryVersions,
      lastAppliedAt: appliedAt,
      managedResources: pending.nextManagedResources
    };
    await stateRepository.write({
      ...previousState,
      formatVersion: 1,
      endpointId: pending.endpoint.id,
      deviceFingerprint: pending.endpoint.deviceFingerprint,
      recoveryRequired: {
        operation: "apply",
        operationId,
        error: "Remote Apply was interrupted before verification",
        occurredAt: new Date().toISOString()
      },
      pendingAppliedState
    });
    const finalizeAppliedState = async () => {
      await stateRepository.write({
        ...(previousState ? clearRecoveryState(previousState) : {}),
        formatVersion: 1,
        endpointId: pending.endpoint.id,
        deviceFingerprint: pending.endpoint.deviceFingerprint,
        ...pendingAppliedState
      });
      await cleanupRemoteOperation(pending.device, pending.endpoint, operationId);
      await disposePreview(previewId);
    };
    try {
      const result = await transport.execute(
        pending.device,
        `sh -c ${shellQuote(bootstrap)}`,
        { input: payload, timeoutMs: 120_000, maxOutputBytes: 1024 * 1024 }
      );
      if (result.exitCode !== 0) throw new Error(result.stderr || "Remote Apply failed and was rolled back");
      await finalizeAppliedState();
      return { ok: true, backupId: operationId };
    } catch (error) {
      const operationRoot = posix.join(
        pending.endpoint.homeDir,
        ".local",
        "state",
        "agentenv-manager",
        "operations",
        operationId
      );
      const statusResult = await transport.execute(
        pending.device,
        `sh -c ${shellQuote(`cat ${shellQuote(posix.join(operationRoot, "status"))} 2>/dev/null || true`)}`,
        { timeoutMs: 15_000, maxOutputBytes: 1024 }
      ).catch(() => undefined);
      const remoteStatus = statusResult?.stdout.toString("utf8").trim();
      if (remoteStatus === "committed") {
        await finalizeAppliedState();
        return { ok: true, backupId: operationId };
      }
      if (remoteStatus === "rolled-back") {
        await stateRepository.write(previousState ? clearRecoveryState(previousState) : {
          formatVersion: 1,
          endpointId: pending.endpoint.id,
          deviceFingerprint: pending.endpoint.deviceFingerprint
        });
        await cleanupRemoteOperation(pending.device, pending.endpoint, operationId);
        await disposePreview(previewId);
        return {
          ok: false,
          kind: "failed",
          errors: [`Remote Apply failed and restored its recovery point: ${error instanceof Error ? error.message : String(error)}`]
        };
      }
      await stateRepository.write({
        ...previousState,
        formatVersion: 1,
        endpointId: pending.endpoint.id,
        deviceFingerprint: pending.endpoint.deviceFingerprint,
        recoveryRequired: {
          operation: "apply",
          operationId,
          error: error instanceof Error ? error.message : String(error),
          occurredAt: new Date().toISOString()
        },
        pendingAppliedState
      });
      return {
        ok: false,
        kind: "recovery-required",
        errors: ["Remote connection ended before AgentEnv could confirm Apply. Reconnect this device before making more changes."]
      };
    }
  };

  return {
    listDevices: () => deviceStore.list(),
    listSshConfigHosts: () => sshConfigDiscovery.listHosts(),
    resolveSshConfigHost: (alias) => sshConfigDiscovery.resolveHost(alias),
    addDevice: async (input) => {
      const device = await deviceStore.add(input);
      await probeDevice(device.id, true);
      return device;
    },
    updateDevice: async (input) => {
      const previous = await deviceStore.get(input.id);
      const device = await deviceStore.update(input);
      probes.delete(device.id);
      const probe = await probeDevice(device.id, true);
      const identityChanged = probe.status === "ready" && probe.deviceFingerprint
        ? (await Promise.all(options.targetRegistry.list().map((descriptor) =>
            stateRepository.read(endpointIdFor(device.id, descriptor.id))
          ))).some((state) => state && state.deviceFingerprint !== probe.deviceFingerprint)
        : false;
      const managedStates = (await stateRepository.list()).filter((state) =>
        state.endpointId.startsWith(`ssh:${device.id}:`)
      );
      if (identityChanged || (probe.status !== "ready" && managedStates.length > 0)) {
        await deviceStore.update({
          id: previous.id,
          name: previous.name,
          host: previous.host,
          user: previous.user,
          port: previous.port
        });
        probes.delete(device.id);
        throw new Error(
          identityChanged
            ? "This connection points to a different Linux device. Remove it and add the new device separately."
            : "Reconnect this managed SSH device before changing its connection details"
        );
      }
      return device;
    },
    removeDevice: async (id) => {
      const states = (await stateRepository.list()).filter((state) =>
        state.endpointId.startsWith(`ssh:${id}:`)
      );
      if (states.some((state) => state.recoveryRequired)) {
        throw new Error("Reconnect this SSH device and finish recovery before removing it");
      }
      await deviceStore.remove(id);
      probes.delete(id);
      await stateRepository.removeDevice(id);
    },
    probeDevice,
    listEndpoints,
    listTargetStates: async () => {
      const endpoints = await listEndpoints(false);
      const devices = new Map((await deviceStore.list()).map((device) => [device.id, device]));
      return Promise.all(endpoints.map(async (endpoint) => {
        const device = devices.get(endpoint.deviceId);
        const state = device
          ? await reconcileRemoteRecovery(device, endpoint, await stateRepository.read(endpoint.id))
          : await stateRepository.read(endpoint.id);
        return publicStateFor(endpoint, state);
      }));
    },
    isEndpointId: (id) => id.startsWith(ENDPOINT_PREFIX),
    hasPreview: (id) => previews.has(id),
    previewProfile,
    applyProfile
  };
};
