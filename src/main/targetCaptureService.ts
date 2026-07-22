import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rm } from "node:fs/promises";
import type {
  CreateProfileFromTargetInput,
  TargetCapturePreview,
  TargetCaptureResource,
  TargetCaptureResult,
  SkillImportConflictResolution
} from "../shared/types";
import { pathExists } from "./fileUtils";
import type { AgentEnvPaths } from "./paths";
import type { ProfileStore } from "./profileStore";
import { hashComparableResource } from "./resourceHash";
import type { SkillLibraryStore } from "./skillLibraryStore";
import type { TargetDiscoveryService } from "./targetDiscovery";
import type { TargetRegistry } from "./targets/registry";
import type { TargetScope } from "./targets/targetScope";
import { createSettingsStore, type SettingsStore } from "./settingsStore";
import { targetPathInputFor } from "./targets/pathInput";
import type { CapturedTargetProfile } from "./targets/types";
import { isTargetInstalled } from "../shared/targetHealth";
import {
  createCaptureReceiptStore,
  type CaptureSkillCopy
} from "./captureReceiptStore";

interface CapturedSkill {
  targetName: string;
  libraryId: string;
  sourcePath: string;
  sourcePaths: string[];
  contentHash: string;
  copies: CaptureSkillCopy[];
  existing: boolean;
  conflictResolution?: SkillImportConflictResolution;
}

interface InternalCapture {
  preview: TargetCapturePreview;
  captured: CapturedTargetProfile;
  skills: CapturedSkill[];
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
  targetDiscoveryService: TargetDiscoveryService;
  targetScope?: TargetScope;
  settingsStore?: SettingsStore;
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
  targetDiscoveryService,
  targetScope,
  settingsStore = createSettingsStore(paths)
}: TargetCaptureServiceOptions): TargetCaptureService => {
  const previews = new Map<string, InternalCapture>();
  const captureReceiptStore = createCaptureReceiptStore(paths);

  const buildCapture = async (targetId: string): Promise<InternalCapture> => {
    await targetScope?.assertEnabled(targetId);
    const discoveredTargets = await targetDiscoveryService.listTargets();
    const target = discoveredTargets.find((item) => item.id === targetId);
    if (!target || !isTargetInstalled(target.health)) {
      throw new Error("Agent installation is not detected");
    }
    const adapter = targetRegistry.get(targetId);
    const settings = await settingsStore.readSettings();
    const targetPaths = adapter.createTargetPaths(targetPathInputFor(paths, settings, targetId));
    const captured = await adapter.captureProfile(targetPaths);
    const librarySkills = await skillLibraryStore.listSkills();
    const inventory = await skillLibraryStore.scanInventory(
      [targetPaths],
      librarySkills
    );
    const runtimeInventory = inventory.filter(
      (entry) =>
        entry.locationRole !== "discovery-only" ||
        (entry.legacyLocation && entry.status === "managed" && entry.managedByTarget === true)
    );
    const isUnavailableSkill = (entry: (typeof runtimeInventory)[number]) =>
      entry.runtimeIssues?.some((issue) => issue.code === "unreadable-skill") === true;
    const unavailableInventory = runtimeInventory.filter(isUnavailableSkill);
    const ignoredInventory = runtimeInventory.filter(
      (entry) => entry.status === "ignored" && !isUnavailableSkill(entry)
    );
    const externalInventory = runtimeInventory.filter(
      (entry) => entry.status === "external" && !isUnavailableSkill(entry)
    );
    const skillInventory = runtimeInventory.filter(
      (entry) =>
        entry.status !== "ignored" &&
        entry.status !== "external" &&
        !isUnavailableSkill(entry)
    );
    const groupedSkills = new Map<string, typeof skillInventory>();
    for (const entry of skillInventory) {
      groupedSkills.set(entry.skillKey, [
        ...(groupedSkills.get(entry.skillKey) ?? []),
        entry
      ]);
    }

    const resources: TargetCaptureResource[] = [];
    const errors: string[] = [];
    const warnings = [...captured.warnings];
    for (const entry of unavailableInventory) {
      const runtimeIssue = entry.runtimeIssues?.find(
        (issue) => issue.code === "unreadable-skill"
      );
      const isBrokenLink = runtimeIssue?.message.includes("link target") === true;
      resources.push({
        kind: "skill",
        id: entry.id,
        name: entry.name,
        sourcePath: entry.path,
        action: "exclude",
        detail: isBrokenLink ? "Broken link; skipped" : "Unavailable; skipped"
      });
      warnings.push(`Skill ${entry.name} was skipped. ${runtimeIssue?.message ?? entry.path}`);
    }
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
      const manager = entry.externalOwnership?.displayName ??
        entry.externalOwnership?.manager ??
        "another tool";
      resources.push({
        kind: "skill",
        id: entry.id,
        name: entry.name,
        sourcePath: entry.path,
        action: "exclude",
        detail: `Managed by ${manager}; remains unchanged`
      });
      warnings.push(`${manager} Skill ${entry.name} remains externally managed`);
    }
    const reservedSkillIds = new Set(librarySkills.map((skill) => skill.id));
    const skills: CapturedSkill[] = [];
    for (const [runtimeName, entries] of groupedSkills) {
      const preferredEntry =
        entries.find((entry) => entry.locationRole === "preferred-runtime") ??
        entries.find((entry) => entry.locationRole === "alternate-runtime") ??
        entries[0];
      const targetName = preferredEntry.deploymentName ?? preferredEntry.id;
      if (!safeName.test(targetName)) {
        errors.push(`Skill ${targetName} cannot be captured because its directory name is invalid`);
        continue;
      }
      const hashes = new Set(entries.map((entry) => entry.contentHash));
      if (hashes.size > 1) {
        errors.push(
          `Runtime Skill ${runtimeName} has different content in multiple active locations`
        );
        continue;
      }
      const requestedLibraryId = uniqueId(
        reservedSkillIds.has(safeId(runtimeName)) ? `${targetId}-${runtimeName}` : runtimeName,
        reservedSkillIds
      );
      const sourcePath = preferredEntry.path;
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
        copies: entries.map((entry) => ({
          path: entry.path,
          contentHash: entry.contentHash,
          locationRole: entry.locationRole,
          sharedLocation: entry.sharedLocation
        })),
        existing: Boolean(existing),
        conflictResolution
      });
      resources.push({
        kind: "skill",
        id: targetName,
        name: preferredEntry.runtimeName ?? preferredEntry.name,
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

    if (captured.instructions.trim()) {
      resources.unshift({
        kind: "instructions",
        id: "instructions",
        name: adapter.descriptor.instructionsLabel,
        sourcePath: targetPaths.instructionsPath,
        action: "include"
      });
    }
    for (const excluded of captured.excluded) {
      warnings.push(`${excluded} remains Agent-owned`);
    }

    const fingerprintPaths = new Set([
      targetPaths.instructionsPath,
      targetPaths.configPath,
      ...(targetPaths.mcpConfigPath ? [targetPaths.mcpConfigPath] : []),
      ...skills.flatMap((skill) => skill.sourcePaths)
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
    return { preview, captured, skills, fingerprints };
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
        preferredTargetId: capture.preview.targetId,
        name: profileName,
        description: `Captured from ${capture.preview.targetName}`
      });
      profileId = created.id;
      const adapter = targetRegistry.get(capture.preview.targetId);
      const capturedMcp = (capture.captured.mcpConnections ?? []).filter(
        (connection) => connection.controllable
      );
      const mcpPolicy = adapter.descriptor.capabilities.mcpActivation && capturedMcp.length > 0
        ? {
            mode: "manage" as const,
            selections: capturedMcp.map((connection) => ({
              name: connection.name,
              enabled: connection.enabled
            }))
          }
        : { mode: "ignore" as const, selections: [] };
      const saved = await profileStore.saveProfile({
        manifest: {
          ...created.manifest,
          name: profileName,
          description: `Captured from ${capture.preview.targetName}`,
          preferredTargetId: capture.preview.targetId,
          createdFromTargetId: capture.preview.targetId
        },
        instructions: capture.captured.instructions,
        resources: {
          skills: capture.skills.map((skill) => ({
            libraryId: skill.libraryId,
            targetName: skill.targetName,
            enabled: true
          })),
          mcpByTarget: {
            [capture.preview.targetId]: mcpPolicy
          }
        }
      });
      const receiptWarnings: string[] = [];
      try {
        await captureReceiptStore.write({
          formatVersion: 1,
          profileId: saved.id,
          targetId: capture.preview.targetId,
          createdAt: capture.preview.createdAt,
          skills: capture.skills.map((skill) => ({
            libraryId: skill.libraryId,
            targetName: skill.targetName,
            copies: skill.copies
          }))
        });
      } catch (error) {
        receiptWarnings.push(
          `Capture handoff evidence could not be saved; first Apply will use current content validation. ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      previews.delete(input.previewId);
      return {
        profile: await profileStore.readProfile(saved.id),
        targetId: capture.preview.targetId,
        importedSkillCount: importedSkillPaths.length,
        importedMcpCount: 0,
        warnings: [...capture.preview.warnings, ...receiptWarnings]
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
