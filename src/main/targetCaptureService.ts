import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  CreateProfileFromTargetInput,
  TargetCapturePreview,
  TargetCaptureIssue,
  TargetCaptureResource,
  TargetCaptureResult,
  TargetCaptureScope,
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
import {
  createSettingsStore,
  resolveSkillsLibraryDir,
  type SettingsStore
} from "./settingsStore";
import { targetPathInputFor } from "./targets/pathInput";
import type { CapturedTargetProfile } from "./targets/types";
import { isTargetInstalled } from "../shared/targetHealth";
import {
  createCaptureReceiptStore,
  type CaptureSkillCopy
} from "./captureReceiptStore";
import { createBackupStore, type BackupStore } from "./backupStore";
import {
  createBackupMutationClaimer,
  restoreBackupWithSafety,
  selectBackupEntries
} from "./backupRestore";
import { hashPathEntry } from "./filesystemIntegrity";
import type { RuntimeDiagnostics } from "./runtimeDiagnostics";
import { createSkillChanges } from "./skillFileChanges";

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
  scope: TargetCaptureScope;
  captured: CapturedTargetProfile;
  skills: CapturedSkill[];
  skillDecisions: Array<{
    issue: TargetCaptureIssue;
    candidates: Map<string, CapturedSkill>;
  }>;
  fingerprints: Record<string, string>;
}

export interface TargetCaptureService {
  previewTarget(targetId: string, scope?: TargetCaptureScope): Promise<TargetCapturePreview>;
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
  backupStore?: BackupStore;
  diagnostics?: RuntimeDiagnostics;
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
  settingsStore = createSettingsStore(paths),
  backupStore = createBackupStore(paths),
  diagnostics
}: TargetCaptureServiceOptions): TargetCaptureService => {
  const previews = new Map<string, InternalCapture>();
  const captureReceiptStore = createCaptureReceiptStore(paths);

  const buildCapture = async (
    targetId: string,
    scope: TargetCaptureScope = "all"
  ): Promise<InternalCapture> => {
    await targetScope?.assertEnabled(targetId);
    const discoveredTargets = await targetDiscoveryService.listTargets();
    const target = discoveredTargets.find((item) => item.id === targetId);
    if (!target || !isTargetInstalled(target.health)) {
      throw new Error("Agent installation is not detected");
    }
    const adapter = targetRegistry.get(targetId);
    const settings = await settingsStore.readSettings();
    const targetPaths = adapter.createTargetPaths(targetPathInputFor(paths, settings, targetId));
    const captured: CapturedTargetProfile = scope === "skills"
      ? {
          instructions: "",
          mcpConnections: [],
          warnings: [],
          excluded: []
        }
      : await adapter.captureProfile(targetPaths);
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
    const skillInventory = runtimeInventory.filter(
      (entry) => !isUnavailableSkill(entry)
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
    const warnings = scope === "all" ? [...captured.warnings] : [];
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
    const reservedSkillIds = new Set(librarySkills.map((skill) => skill.id));
    const skills: CapturedSkill[] = [];
    const skillDecisions: InternalCapture["skillDecisions"] = [];
    const prepareSkill = async (
      runtimeName: string,
      entries: typeof skillInventory,
      requestedLibraryId: string
    ): Promise<{
      skill: CapturedSkill;
      resource: TargetCaptureResource;
      hasSameNameLibraryConflict: boolean;
    }> => {
      const preferredEntry =
        entries.find((entry) => entry.locationRole === "preferred-runtime") ??
        entries.find((entry) => entry.locationRole === "alternate-runtime") ??
        entries[0];
      const targetName = preferredEntry.deploymentName ?? preferredEntry.id;
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
      const skill: CapturedSkill = {
        targetName,
        libraryId,
        sourcePath,
        sourcePaths,
        contentHash: importPreview.incoming.contentHash,
        copies: entries.map((entry) => ({
          path: entry.path,
          contentHash: entry.contentHash,
          locationRole: entry.locationRole,
          sharedLocation: entry.sharedLocation,
          sharedLocationId: entry.sharedLocationId
        })),
        existing: Boolean(existing),
        conflictResolution
      };
      return {
        skill,
        hasSameNameLibraryConflict: !existing && importPreview.conflicts.length > 0,
        resource: {
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
              : preferredEntry.status === "left-unmanaged"
                ? "Included in the Profile; this device leaves the current path unmanaged"
                : preferredEntry.externalEvidence
                  ? `Included from a readable Agent path; ${preferredEntry.externalEvidence.displayName ?? preferredEntry.externalEvidence.manager} metadata was detected`
                  : undefined
        }
      };
    };
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
      const requestedLibraryId = uniqueId(
        reservedSkillIds.has(safeId(runtimeName)) ? `${targetId}-${runtimeName}` : runtimeName,
        reservedSkillIds
      );
      if (hashes.size > 1) {
        const candidateSkills = new Map<string, CapturedSkill>();
        const comparisonBase = entries[0];
        const candidates = await Promise.all(entries.map(async (entry, index) => {
          const candidateId = createHash("sha256").update(entry.path).digest("hex").slice(0, 16);
          const prepared = await prepareSkill(runtimeName, [entry], requestedLibraryId);
          candidateSkills.set(candidateId, prepared.skill);
          const matchingLibrary = librarySkills.find(
            (skill) => skill.contentHash === entry.contentHash
          );
          return {
            id: candidateId,
            path: entry.path,
            canonicalPath: await realpath(entry.path).catch(() => resolve(entry.path)),
            version: entry.version,
            contentHash: entry.contentHash,
            modifiedAt: entry.modifiedAt,
            locationRole: entry.locationRole,
            shared: entry.sharedLocation === true,
            sharedLocationId: entry.sharedLocationId,
            collectionPath: entry.collectionLink?.path,
            libraryId: prepared.skill.libraryId,
            libraryMatch: matchingLibrary
              ? "identical" as const
              : prepared.hasSameNameLibraryConflict
                ? "same-name" as const
                : undefined,
            comparisonBaseId: index > 0
              ? createHash("sha256").update(comparisonBase.path).digest("hex").slice(0, 16)
              : undefined,
            comparisonChanges: index > 0
              ? await createSkillChanges(comparisonBase.path, entry.path)
              : []
          };
        }));
        const diagnosticReference = await diagnostics?.record(
          "profiles:capture",
          "decision-required",
          {
            outcome: "decision-required",
            context: {
              targetId,
              scope,
              skillName: runtimeName,
              candidateCount: candidates.length,
              candidates: candidates.map((candidate) => ({
                path: candidate.path,
                canonicalPath: candidate.canonicalPath,
                version: candidate.version,
                contentHash: candidate.contentHash,
                modifiedAt: candidate.modifiedAt,
                locationRole: candidate.locationRole,
                sharedLocationId: candidate.sharedLocationId,
                collectionPath: candidate.collectionPath,
                libraryId: candidate.libraryId
              }))
            }
          }
        );
        const issue: TargetCaptureIssue = {
          id: `skill-conflict:${safeId(runtimeName)}`,
          code: "conflicting-skill-copies",
          severity: "decision",
          skillName: runtimeName,
          message: `${candidates.length} active copies have different content`,
          diagnosticReference,
          candidates
        };
        skillDecisions.push({ issue, candidates: candidateSkills });
        continue;
      }
      const prepared = await prepareSkill(runtimeName, entries, requestedLibraryId);
      skills.push(prepared.skill);
      resources.push(prepared.resource);
    }

    if (scope === "all") {
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
    }

    const fingerprintPaths = new Set([
      ...(scope === "all"
        ? [
            targetPaths.instructionsPath,
            targetPaths.configPath,
            ...(targetPaths.mcpConfigPath ? [targetPaths.mcpConfigPath] : [])
          ]
        : []),
      ...skills.flatMap((skill) => skill.sourcePaths),
      ...skillDecisions.flatMap((decision) =>
        decision.issue.candidates.map((candidate) => candidate.path)
      )
    ]);
    const fingerprints = Object.fromEntries(
      await Promise.all([...fingerprintPaths].map(async (path) => [path, await fingerprintPath(path)]))
    );
    const blockingDiagnosticReference = errors.length > 0
      ? await diagnostics?.record("profiles:capture", "blocked", {
          outcome: "blocked",
          context: {
            targetId,
            scope,
            errors
          }
        })
      : undefined;
    const preview: TargetCapturePreview = {
      id: randomUUID(),
      targetId,
      targetName: adapter.descriptor.name,
      scope,
      suggestedName: adapter.descriptor.name,
      createdAt: new Date().toISOString(),
      resources,
      issues: skillDecisions.map((item) => item.issue),
      warnings,
      errors,
      blockingDiagnosticReference
    };
    await diagnostics?.record("profiles:capture", "inventory-reviewed", {
      outcome: skillDecisions.length > 0 ? "decision-required" : "completed",
      context: {
        targetId,
        scope,
        skillCount: groupedSkills.size,
        resourceCount: resources.length,
        decisionCount: skillDecisions.length,
        warningCount: warnings.length,
        errorCount: errors.length
      }
    });
    return { preview, scope, captured, skills, skillDecisions, fingerprints };
  };

  const previewTarget = async (
    targetId: string,
    scope: TargetCaptureScope = "all"
  ) => {
    const capture = await buildCapture(targetId, scope);
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
    const decisions = new Map((input.decisions ?? []).map((decision) => [decision.issueId, decision]));
    const resolvedSkills = [...capture.skills];
    const keepOutside: Array<{ targetId: string; path: string }> = [];
    for (const pending of capture.skillDecisions) {
      const decision = decisions.get(pending.issue.id);
      if (!decision) {
        throw new Error(`Choose how to capture ${pending.issue.skillName} before saving the Profile`);
      }
      if (decision.action === "keep-outside") {
        keepOutside.push(
          ...pending.issue.candidates.map((candidate) => ({
            targetId: capture.preview.targetId,
            path: candidate.path
          }))
        );
        continue;
      }
      const selected = pending.candidates.get(decision.candidateId);
      if (!selected) {
        throw new Error(`The selected ${pending.issue.skillName} copy is no longer available`);
      }
      resolvedSkills.push(selected);
    }
    if (capture.skillDecisions.length > 0) {
      await diagnostics?.record("profiles:capture", "decisions-recorded", {
        outcome: "completed",
        context: {
          targetId: capture.preview.targetId,
          selectedCopyCount: input.decisions?.filter((item) => item.action === "use-copy").length ?? 0,
          keptOutsideCount: input.decisions?.filter((item) => item.action === "keep-outside").length ?? 0
        }
      });
    }
    const profileName = input.name.trim();
    if (!profileName) throw new Error("Profile name is required");
    for (const [path, fingerprint] of Object.entries(capture.fingerprints)) {
      if (await fingerprintPath(path) !== fingerprint) {
        throw new Error(`Agent changed after capture preview: ${path}`);
      }
    }

    const importCandidates = resolvedSkills.filter((item) => !item.existing);
    const settings = await settingsStore.readSettings();
    const libraryRoot = resolveSkillsLibraryDir(paths, settings);
    const affectedLibraryIds = new Set<string>();
    for (const skill of importCandidates) {
      affectedLibraryIds.add(skill.libraryId);
      const resolution = skill.conflictResolution;
      if (resolution) {
        affectedLibraryIds.add(
          resolution.action === "keep-both" ? resolution.id : resolution.existingId
        );
      }
    }
    const policyPaths = keepOutside.length > 0 ? [paths.unmanagedSkillLocationsPath] : [];
    const libraryBackup = affectedLibraryIds.size > 0 || policyPaths.length > 0
      ? await backupStore.createBackup(
          [
            ...[...affectedLibraryIds].map((id) => join(libraryRoot, id)),
            ...policyPaths
          ],
          { operation: "data-import", profileName }
        )
      : undefined;
    const claimLibraryPath = libraryBackup
      ? createBackupMutationClaimer(libraryBackup, {
          changedMessage: (path) =>
            `AgentEnv data changed while Capture was being prepared: ${path}`
        })
      : undefined;
    const importedLibraryHashes = new Map<string, string | undefined>();
    let importedSkillCount = 0;
    let profileId: string | undefined;
    let createdProfileHash: string | undefined;
    try {
      for (const skill of importCandidates) {
        const skillLibraryIds = new Set([skill.libraryId]);
        if (skill.conflictResolution) {
          skillLibraryIds.add(
            skill.conflictResolution.action === "keep-both"
              ? skill.conflictResolution.id
              : skill.conflictResolution.existingId
          );
        }
        const skillLibraryPaths = [...skillLibraryIds].map((id) => join(libraryRoot, id));
        await claimLibraryPath?.(...skillLibraryPaths);
        await skillLibraryStore.importSkill({
          sourcePath: skill.sourcePath,
          id: skill.libraryId,
          sourceType: "local",
          expectedContentHash: skill.contentHash,
          conflictResolution: skill.conflictResolution
        });
        for (const path of skillLibraryPaths) {
          importedLibraryHashes.set(resolve(path), await hashPathEntry(path));
        }
        await claimLibraryPath?.recordMutation(...skillLibraryPaths);
        importedSkillCount += 1;
        await diagnostics?.record("profiles:capture", "library-skill-imported", {
          outcome: "completed",
          context: {
            targetId: capture.preview.targetId,
            libraryId: skill.libraryId,
            sourcePath: skill.sourcePath,
            contentHash: skill.contentHash
          }
        });
      }
      if (keepOutside.length > 0) {
        await claimLibraryPath?.(paths.unmanagedSkillLocationsPath);
        await skillLibraryStore.setUnmanagedSkillLocations({
          items: keepOutside.map((item) => ({
            path: item.path,
            targetId: item.targetId,
            coverage: "exact" as const
          })),
          unmanaged: true
        });
        importedLibraryHashes.set(
          resolve(paths.unmanagedSkillLocationsPath),
          await hashPathEntry(paths.unmanagedSkillLocationsPath)
        );
        await claimLibraryPath?.recordMutation(paths.unmanagedSkillLocationsPath);
        await diagnostics?.record("profiles:capture", "management-boundaries-saved", {
          outcome: "completed",
          context: {
            targetId: capture.preview.targetId,
            count: keepOutside.length,
            paths: keepOutside.map((item) => item.path)
          }
        });
      }
      const created = await profileStore.createProfile({
        preferredTargetId: capture.preview.targetId,
        name: profileName,
        description: `Captured from ${capture.preview.targetName}`
      });
      profileId = created.id;
      const adapter = targetRegistry.get(capture.preview.targetId);
      const capturedMcp = capture.scope === "all"
        ? (capture.captured.mcpConnections ?? []).filter(
            (connection) => connection.controllable
          )
        : [];
      const mcpPolicy = capture.scope === "all" &&
        adapter.descriptor.capabilities.mcpActivation &&
        capturedMcp.length > 0
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
        instructions: capture.scope === "all" ? capture.captured.instructions : "",
        resources: {
          skills: resolvedSkills.map((skill) => ({
            libraryId: skill.libraryId,
            targetName: skill.targetName,
            enabled: true
          })),
          managementByTarget: {
            [capture.preview.targetId]: {
              instructions: capture.scope === "all" ? "manage" : "ignore",
              skills: "manage"
            }
          },
          mcpByTarget: {
            [capture.preview.targetId]: mcpPolicy
          }
        },
        expectedContentHash: created.contentHash
      });
      createdProfileHash = saved.contentHash;
      const receiptWarnings: string[] = [];
      try {
        await captureReceiptStore.write({
          formatVersion: 1,
          profileId: saved.id,
          targetId: capture.preview.targetId,
          createdAt: capture.preview.createdAt,
          skills: resolvedSkills.map((skill) => ({
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
      await diagnostics?.record("profiles:capture", "completed", {
        outcome: "completed",
        context: {
          targetId: capture.preview.targetId,
          profileId: saved.id,
          importedSkillCount,
          keptOutsideCount: keepOutside.length,
          warningCount: capture.preview.warnings.length + receiptWarnings.length
        }
      });
      return {
        profile: await profileStore.readProfile(saved.id),
        targetId: capture.preview.targetId,
        importedSkillCount,
        importedMcpCount: 0,
        warnings: [...capture.preview.warnings, ...receiptWarnings]
      };
    } catch (error) {
      const recoveryFailures: string[] = [];
      if (libraryBackup) {
        const rollbackPaths: string[] = [];
        for (const [path, importedHash] of importedLibraryHashes) {
          if (await hashPathEntry(path) === importedHash) {
            rollbackPaths.push(path);
          } else {
            recoveryFailures.push(
              `Library path changed after Capture wrote it and was left in place: ${path}. ` +
              `Backup ${libraryBackup.id} preserves its pre-Capture state.`
            );
          }
        }
        try {
          const rollbackBackup = selectBackupEntries(libraryBackup, rollbackPaths);
          if (rollbackBackup.entries.length > 0) {
            await restoreBackupWithSafety({
              backup: rollbackBackup,
              backupStore,
              safetyProfileName: `${profileName} before Capture recovery`,
              expectedCurrentHashes: importedLibraryHashes
            });
          }
        } catch (restoreError) {
          recoveryFailures.push(
            `Library recovery from ${libraryBackup.id} failed: ${
              restoreError instanceof Error ? restoreError.message : String(restoreError)
            }`
          );
        }
      }
      if (profileId) {
        try {
          const currentProfile = await profileStore.readProfile(profileId);
          if (createdProfileHash && currentProfile.contentHash !== createdProfileHash) {
            recoveryFailures.push(
              `Incomplete Profile ${profileId} changed after Capture and was preserved.`
            );
          } else {
            await profileStore.deleteProfile(profileId);
          }
        } catch (deleteError) {
          recoveryFailures.push(
            `Incomplete Profile ${profileId} could not be moved to Trash: ${
              deleteError instanceof Error ? deleteError.message : String(deleteError)
            }`
          );
        }
      }
      throw new Error(
        `Create from Agent failed: ${
          error instanceof Error ? error.message : String(error)
        }${recoveryFailures.length > 0 ? `. Recovery required: ${recoveryFailures.join("; ")}` : ""}`
      );
    }
  };

  return { previewTarget, createFromTarget };
};
