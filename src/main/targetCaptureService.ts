import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CreateProfileFromTargetInput,
  TargetCapturePreview,
  TargetCaptureResource,
  TargetCaptureResult,
  SkillImportConflictResolution
} from "../shared/types";
import { pathExists } from "./fileUtils";
import type { McpLibraryStore } from "./mcpLibraryStore";
import type { AgentEnvPaths } from "./paths";
import type { ProfileStore } from "./profileStore";
import { hashComparableResource } from "./resourceHash";
import type { SkillLibraryStore } from "./skillLibraryStore";
import type { TargetDiscoveryService } from "./targetDiscovery";
import type { TargetRegistry } from "./targets/registry";
import type { TargetScope } from "./targets/targetScope";
import type { CapturedTargetProfile } from "./targets/types";
import { isTargetInstalled } from "../shared/targetHealth";

interface CapturedSkill {
  targetName: string;
  libraryId: string;
  sourcePath: string;
  sourcePaths: string[];
  contentHash: string;
  existing: boolean;
  conflictResolution?: SkillImportConflictResolution;
}

interface CapturedAgent {
  targetName: string;
  sourcePath: string;
  kind: "file" | "directory";
}

interface InternalCapture {
  preview: TargetCapturePreview;
  captured: CapturedTargetProfile;
  skills: CapturedSkill[];
  agents: CapturedAgent[];
  fingerprints: Record<string, string>;
}

export interface TargetCaptureService {
  previewTarget(targetId: string): Promise<TargetCapturePreview>;
  createFromTarget(input: CreateProfileFromTargetInput): Promise<TargetCaptureResult>;
}

interface TargetCaptureServiceOptions {
  paths: AgentEnvPaths;
  targetRegistry: TargetRegistry;
  profileStore: ProfileStore;
  skillLibraryStore: SkillLibraryStore;
  mcpLibraryStore: McpLibraryStore;
  targetDiscoveryService: TargetDiscoveryService;
  targetScope?: TargetScope;
}

const safeName = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const safeId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "resource";

const uniqueId = (base: string, reserved: Set<string>) => {
  let candidate = safeId(base);
  let index = 2;
  while (reserved.has(candidate)) {
    candidate = `${safeId(base)}-${index}`;
    index += 1;
  }
  reserved.add(candidate);
  return candidate;
};

const fingerprintPath = async (path: string) => {
  if (!(await pathExists(path))) return "missing";
  const stats = await lstat(path);
  if (stats.isDirectory() || stats.isSymbolicLink()) {
    return hashComparableResource(path);
  }
  return createHash("sha256").update(await readFile(path)).digest("hex");
};

export const createTargetCaptureService = ({
  paths,
  targetRegistry,
  profileStore,
  skillLibraryStore,
  mcpLibraryStore: _mcpLibraryStore,
  targetDiscoveryService,
  targetScope
}: TargetCaptureServiceOptions): TargetCaptureService => {
  const previews = new Map<string, InternalCapture>();

  const buildCapture = async (targetId: string): Promise<InternalCapture> => {
    await targetScope?.assertEnabled(targetId);
    const discoveredTargets = await targetDiscoveryService.listTargets();
    const target = discoveredTargets.find((item) => item.id === targetId);
    if (!target || !isTargetInstalled(target.health)) {
      throw new Error("Agent installation is not detected");
    }
    const adapter = targetRegistry.get(targetId);
    const targetPaths = adapter.createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    const captured = await adapter.captureProfile(targetPaths);
    const librarySkills = await skillLibraryStore.listSkills();
    const inventory = await skillLibraryStore.scanInventory(
      [targetPaths],
      librarySkills
    );
    const runtimeLocations = (targetPaths.skillLocations ?? [
      ...(targetPaths.skillsDir
        ? [{ path: targetPaths.skillsDir, role: "preferred-runtime" as const, shared: false }]
        : [])
    ]).filter((location) => location.role !== "discovery-only");
    const runtimeRoots = new Set(runtimeLocations.map((location) => location.path));
    const runtimeInventory = inventory.filter((entry) => runtimeRoots.has(dirname(entry.path)));
    const ignoredInventory = runtimeInventory.filter((entry) => entry.status === "ignored");
    const externalInventory = runtimeInventory.filter((entry) => entry.status === "external");
    const skillInventory = runtimeInventory.filter(
      (entry) => entry.status !== "ignored" && entry.status !== "external"
    );
    const groupedSkills = new Map<string, typeof skillInventory>();
    for (const entry of skillInventory) {
      groupedSkills.set(entry.id, [...(groupedSkills.get(entry.id) ?? []), entry]);
    }

    const resources: TargetCaptureResource[] = [];
    const errors: string[] = [];
    const warnings = [...captured.warnings];
    for (const entry of ignoredInventory) {
      resources.push({
        kind: "skill",
        id: entry.id,
        name: entry.name,
        sourcePath: entry.path,
        action: "exclude",
        detail: "Ignored; kept in its current location"
      });
      warnings.push(`Ignored Skill ${entry.name} will remain Agent-owned`);
    }
    for (const entry of externalInventory) {
      resources.push({
        kind: "skill",
        id: entry.id,
        name: entry.name,
        sourcePath: entry.path,
        action: "exclude",
        detail: "Managed by Skills CLI; remains unchanged"
      });
      warnings.push(`Skills CLI skill ${entry.name} remains externally managed`);
    }
    const reservedSkillIds = new Set(librarySkills.map((skill) => skill.id));
    const skills: CapturedSkill[] = [];
    for (const [targetName, entries] of groupedSkills) {
      if (!safeName.test(targetName)) {
        errors.push(`Skill ${targetName} cannot be captured because its directory name is invalid`);
        continue;
      }
      const hashes = new Set(entries.map((entry) => entry.contentHash));
      if (hashes.size > 1) {
        errors.push(`Skill ${targetName} has different content in multiple active locations`);
        continue;
      }
      const requestedLibraryId = uniqueId(
        reservedSkillIds.has(safeId(targetName)) ? `${targetId}-${targetName}` : targetName,
        reservedSkillIds
      );
      const preferredEntry = entries.find((entry) => dirname(entry.path) === targetPaths.skillsDir);
      const sourcePath = preferredEntry?.path ?? entries[0].path;
      const sourcePaths = [...new Set(entries.map((entry) => entry.path))];
      const importPreview = await skillLibraryStore.previewImport({
        kind: "local",
        input: { sourcePath, id: requestedLibraryId }
      });
      const identicalConflict = importPreview.conflicts.find(
        (conflict) => conflict.contentIdentical
      );
      const existing = identicalConflict
        ? librarySkills.find((skill) => skill.id === identicalConflict.existing.id)
        : undefined;
      const libraryId = existing?.id ?? requestedLibraryId;
      const conflictResolution = !existing && importPreview.conflicts.length > 0
        ? { action: "keep-both" as const, id: libraryId }
        : undefined;
      const contentHash = importPreview.incoming.contentHash;
      skills.push({
        targetName,
        libraryId,
        sourcePath,
        sourcePaths,
        contentHash,
        existing: Boolean(existing),
        conflictResolution
      });
      resources.push({
        kind: "skill",
        id: targetName,
        name: targetName,
        sourcePath,
        libraryId,
        action: existing ? "reuse" : "import",
        detail: conflictResolution
          ? `Import Agent copy as ${libraryId}; existing same-name Library Skill stays unchanged`
          : sourcePaths.length > 1
            ? `${sourcePaths.length} source copies stay unchanged`
            : undefined
      });
    }

    for (const connection of captured.mcpConnections ?? []) {
      resources.push({
        kind: "mcp",
        id: connection.name,
        name: connection.name,
        sourcePath: connection.sourcePath,
        action: "include",
        detail: connection.controllable
          ? connection.enabled
            ? "Enabled; Profile can control activation"
            : "Disabled; Profile can control activation"
          : connection.enabled
            ? "Enabled; remains Agent-controlled"
            : "Disabled; remains Agent-controlled"
      });
    }

    const agents: CapturedAgent[] = [];
    if (targetPaths.agentsDir && await pathExists(targetPaths.agentsDir)) {
      for (const entry of await readdir(targetPaths.agentsDir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name.endsWith(".agentenv-owner.json")) continue;
        if (!safeName.test(entry.name)) {
          warnings.push(`Agent ${entry.name} was left outside AgentEnv because its name is not portable`);
          continue;
        }
        if (!entry.isDirectory() && !entry.isFile()) continue;
        const sourcePath = join(targetPaths.agentsDir, entry.name);
        agents.push({
          targetName: entry.name,
          sourcePath,
          kind: entry.isDirectory() ? "directory" : "file"
        });
        resources.push({
          kind: "agent",
          id: entry.name,
          name: entry.name,
          sourcePath,
          action: "include"
        });
      }
    }

    if (captured.instructions.trim()) {
      resources.unshift({
        kind: "instructions",
        id: "instructions",
        name: adapter.descriptor.instructionsLabel,
        sourcePath: targetPaths.instructionsPath,
        action: "include"
      });
    }
    if (captured.configText.trim()) {
      resources.push({
        kind: "config",
        id: "config",
        name: adapter.descriptor.configLabel,
        sourcePath: targetPaths.configPath,
        action: "include"
      });
    }
    for (const excluded of captured.excluded) {
      resources.push({
        kind: "config",
        id: excluded,
        name: excluded,
        action: "exclude",
        detail: "Sensitive, unsupported, or runtime-owned"
      });
    }

    const fingerprintPaths = new Set([
      targetPaths.instructionsPath,
      targetPaths.configPath,
      ...(targetPaths.mcpConfigPath ? [targetPaths.mcpConfigPath] : []),
      ...skills.flatMap((skill) => skill.sourcePaths),
      ...agents.map((agent) => agent.sourcePath)
    ]);
    const fingerprints = Object.fromEntries(
      await Promise.all([...fingerprintPaths].map(async (path) => [path, await fingerprintPath(path)]))
    );
    const preview: TargetCapturePreview = {
      id: randomUUID(),
      targetId,
      targetName: adapter.descriptor.name,
      suggestedName: `${adapter.descriptor.name} Current`,
      createdAt: new Date().toISOString(),
      resources,
      warnings,
      errors
    };
    return { preview, captured, skills, agents, fingerprints };
  };

  const previewTarget = async (targetId: string) => {
    const capture = await buildCapture(targetId);
    previews.set(capture.preview.id, capture);
    return capture.preview;
  };

  const createFromTarget = async (
    input: CreateProfileFromTargetInput
  ): Promise<TargetCaptureResult> => {
    const capture = previews.get(input.previewId);
    if (!capture) throw new Error("Capture preview is missing or expired");
    await targetScope?.assertEnabled(capture.preview.targetId);
    if (capture.preview.errors.length > 0) {
      throw new Error(capture.preview.errors.join("; "));
    }
    const profileName = input.name.trim();
    if (!profileName) throw new Error("Profile name is required");
    for (const [path, fingerprint] of Object.entries(capture.fingerprints)) {
      if (await fingerprintPath(path) !== fingerprint) {
        throw new Error(`Agent changed after capture preview: ${path}`);
      }
    }

    const importedSkillPaths: string[] = [];
    let profileId: string | undefined;
    try {
      for (const skill of capture.skills.filter((item) => !item.existing)) {
        const imported = await skillLibraryStore.importSkill({
          sourcePath: skill.sourcePath,
          id: skill.libraryId,
          sourceType: "local",
          expectedContentHash: skill.contentHash,
          conflictResolution: skill.conflictResolution
        });
        importedSkillPaths.push(imported.path);
      }
      const created = await profileStore.createProfile({
        targetId: capture.preview.targetId,
        name: profileName,
        description: `Captured from ${capture.preview.targetName}`
      });
      profileId = created.id;
      const profileDir = created.profileDir;
      if (!profileDir) throw new Error("Created Profile has no storage directory");
      const ownedDirs = [];
      const ownedFiles = [];
      for (const agent of capture.agents) {
        const relativeSource = `agents/${agent.targetName}`;
        const destination = join(profileDir, relativeSource);
        await mkdir(dirname(destination), { recursive: true });
        await cp(agent.sourcePath, destination, {
          recursive: agent.kind === "directory",
          dereference: true
        });
        if (agent.kind === "directory") {
          ownedDirs.push({ kind: "agent" as const, source: relativeSource, targetName: agent.targetName });
        } else {
          ownedFiles.push({ kind: "agent" as const, source: relativeSource, targetName: agent.targetName });
        }
      }
      const saved = await profileStore.saveProfile({
        manifest: {
          ...created.manifest,
          name: profileName,
          description: `Captured from ${capture.preview.targetName}`
        },
        instructions: capture.captured.instructions,
        configText: capture.captured.configText,
        assetPolicy: {
          ownedDirs,
          ownedFiles,
          skillRefs: capture.skills.map((skill) => ({
            libraryId: skill.libraryId,
            targetName: skill.targetName
          })),
          mcpRefs: [],
          mcpSelections: (capture.captured.mcpConnections ?? []).map(
            (connection) => ({
              targetId: connection.targetId,
              name: connection.name,
              enabled: connection.enabled
            })
          ),
          disabledSkillPaths: capture.captured.disabledSkillPaths
        }
      });
      previews.delete(input.previewId);
      return {
        profile: await profileStore.readProfile(saved.id),
        targetId: capture.preview.targetId,
        importedSkillCount: importedSkillPaths.length,
        importedMcpCount: 0,
        warnings: capture.preview.warnings
      };
    } catch (error) {
      if (profileId) await profileStore.deleteProfile(profileId);
      for (const path of importedSkillPaths)
        await rm(path, { recursive: true, force: true });
      throw new Error(
        `Create from Agent failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  return { previewTarget, createFromTarget };
};
