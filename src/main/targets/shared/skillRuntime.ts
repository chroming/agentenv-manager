import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
  SkillExternalEvidence,
  SkillRuntimeIssue,
  SkillRuntimeObservation,
  SkillRuntimeSnapshot,
  TargetPaths,
  TargetSkillLocation
} from "../../../shared/types";
import {
  isPortableSkillRuntimeName,
  normalizeSkillKey
} from "../../../shared/skillIdentity";
import { pathExists } from "../../fileUtils";
import { isAgentEnvOwnedDir } from "../../ownershipMarkers";
import { parseSkillFrontmatter } from "../../skillFrontmatter";
import type { TargetSkillDriver } from "../contract";

export interface DiscoveredSkillDirectory {
  path: string;
  deploymentName: string;
  brokenLink: boolean;
}

interface FilesystemSkillDriverOptions {
  targetId: string;
  discoverLocations?: (targetPaths: TargetPaths) => Promise<{
    locations: TargetSkillLocation[];
    issues?: SkillRuntimeIssue[];
  }>;
  readNativeState?: (targetPaths: TargetPaths) => Promise<{
    disabledRuntimeNames: ReadonlySet<string> | readonly string[];
    issues?: SkillRuntimeIssue[];
  }>;
}

const locationForRoot = (targetPaths: TargetPaths, root: string): TargetSkillLocation =>
  targetPaths.skillLocations?.find((location) => resolve(location.path) === resolve(root)) ?? {
    path: root,
    role: "preferred-runtime",
    shared: false,
    scope: "user",
    scanDepth: "direct",
    management: "managed"
  };

const targetSkillLocations = async (
  targetPaths: TargetPaths,
  discoverLocations?: FilesystemSkillDriverOptions["discoverLocations"]
): Promise<{ locations: TargetSkillLocation[]; issues: SkillRuntimeIssue[] }> => {
  const configured = targetPaths.skillLocations?.length
    ? targetPaths.skillLocations
    : [...new Set([targetPaths.skillsDir, ...(targetPaths.skillScanDirs ?? [])].filter(Boolean))]
        .map((path) => locationForRoot(targetPaths, path as string));
  const discovered = discoverLocations
    ? await discoverLocations(targetPaths)
    : { locations: [], issues: [] };
  const byPath = new Map<string, TargetSkillLocation>();
  for (const location of [...configured, ...discovered.locations]) {
    const key = resolve(location.path);
    if (!byPath.has(key)) byPath.set(key, location);
  }
  return { locations: [...byPath.values()], issues: discovered.issues ?? [] };
};

export const discoverSkillDirectories = async (
  root: string,
  scanDepth: TargetSkillLocation["scanDepth"] = "direct"
): Promise<DiscoveredSkillDirectory[]> => {
  if (!(await pathExists(root))) return [];

  const discovered: DiscoveredSkillDirectory[] = [];
  const visit = async (
    candidate: string,
    deploymentName: string,
    ancestors: ReadonlySet<string>,
    depth: number
  ): Promise<void> => {
    if (depth > 12) return;
    const entryStats = await lstat(candidate).catch(() => undefined);
    if (!entryStats || (!entryStats.isDirectory() && !entryStats.isSymbolicLink())) return;

    let resolvedCandidate: string;
    try {
      resolvedCandidate = await realpath(candidate);
      if (!(await stat(candidate)).isDirectory()) return;
    } catch {
      if (entryStats.isSymbolicLink()) {
        discovered.push({ path: candidate, deploymentName, brokenLink: true });
      }
      return;
    }

    if (ancestors.has(resolvedCandidate)) return;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(resolvedCandidate);

    if (await pathExists(join(candidate, "SKILL.md"))) {
      discovered.push({ path: candidate, deploymentName, brokenLink: false });
      return;
    }
    if (scanDepth !== "recursive" || entryStats.isSymbolicLink()) return;

    const children = await readdir(candidate, { withFileTypes: true }).catch(() => []);
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      if (child.name.startsWith(".")) continue;
      if (!child.isDirectory() && !child.isSymbolicLink()) continue;
      await visit(join(candidate, child.name), child.name, nextAncestors, depth + 1);
    }
  };

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const rootAncestors = new Set([await realpath(root).catch(() => resolve(root))]);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    await visit(join(root, entry.name), entry.name, rootAncestors, 1);
  }
  return discovered;
};

export const inspectExternalSkillEvidence = async (
  skillPath: string,
  location: TargetSkillLocation | undefined
): Promise<SkillExternalEvidence | undefined> => {
  if (!location?.externalContainerMarkers?.length) return undefined;

  const canonicalPath = await realpath(skillPath).catch(() => resolve(skillPath));
  let current = canonicalPath;
  for (let depth = 0; depth < 24; depth += 1) {
    for (const marker of location.externalContainerMarkers) {
      if (await pathExists(join(current, marker.relativePath))) {
        return {
          manager: marker.manager,
          displayName: marker.displayName,
          importable: marker.importable,
          canonicalPath,
          confidence: "confirmed",
          state: "healthy"
        };
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
};

export const createFilesystemSkillDriver = (
  options: FilesystemSkillDriverOptions
): TargetSkillDriver => {
  const readNativeState: TargetSkillDriver["readNativeState"] = async (targetPaths) => {
    const nativeState = options.readNativeState
      ? await options.readNativeState(targetPaths)
      : { disabledRuntimeNames: [] as string[], issues: [] as SkillRuntimeIssue[] };
    return {
      disabledRuntimeNames: [...nativeState.disabledRuntimeNames].sort((left, right) =>
        left.localeCompare(right)
      ),
      issues: nativeState.issues ?? []
    };
  };

  const inspectRuntime: TargetSkillDriver["inspectRuntime"] = async (
    targetPaths
  ): Promise<SkillRuntimeSnapshot> => {
    const { disabledRuntimeNames, issues: nativeIssues } = await readNativeState(targetPaths);
    const disabledNames = new Set(disabledRuntimeNames);
    const disabledKeys = new Set([...disabledNames].map(normalizeSkillKey));
    const observations: SkillRuntimeObservation[] = [];
    const snapshotIssues: SkillRuntimeIssue[] = [...nativeIssues];

    const discoveredLocations = await targetSkillLocations(
      targetPaths,
      options.discoverLocations
    );
    snapshotIssues.push(...discoveredLocations.issues);
    for (const location of discoveredLocations.locations) {
      const candidates = await discoverSkillDirectories(
        location.path,
        location.scanDepth ?? "direct"
      );
      for (const candidate of candidates) {
        if (candidate.brokenLink) {
          const issue: SkillRuntimeIssue = {
            code: "unreadable-skill",
            severity: "warning",
            message: `Skill link target is unavailable: ${candidate.path}`
          };
          snapshotIssues.push(issue);
          observations.push({
            targetId: options.targetId,
            locationPath: location.path,
            path: candidate.path,
            runtimeName: candidate.deploymentName,
            deploymentName: candidate.deploymentName,
            scope: location.scope ?? (location.shared ? "shared" : "user"),
            owner: location.scope === "builtin" ? "agent" : "user",
            availability: "unknown",
            confidence: "inferred",
            locationRole: location.role,
            shared: location.shared,
            sharedLocationId: location.sharedLocationId,
            legacy: location.management === "legacy",
            issues: [issue]
          });
          continue;
        }

        let content: string;
        try {
          content = await readFile(join(candidate.path, "SKILL.md"), "utf8");
        } catch {
          const issue: SkillRuntimeIssue = {
            code: "unreadable-skill",
            severity: "warning",
            message: `Skill manifest is unreadable: ${join(candidate.path, "SKILL.md")}`
          };
          snapshotIssues.push(issue);
          observations.push({
            targetId: options.targetId,
            locationPath: location.path,
            path: candidate.path,
            runtimeName: candidate.deploymentName,
            deploymentName: candidate.deploymentName,
            scope: location.scope ?? (location.shared ? "shared" : "user"),
            owner: location.scope === "builtin" ? "agent" : "user",
            availability: "unknown",
            confidence: "inferred",
            locationRole: location.role,
            shared: location.shared,
            sharedLocationId: location.sharedLocationId,
            legacy: location.management === "legacy",
            issues: [issue]
          });
          continue;
        }

        const frontmatter = parseSkillFrontmatter(content);
        const runtimeName = frontmatter.name || candidate.deploymentName;
        const issues: SkillRuntimeIssue[] = frontmatter.errors.map((message) => ({
          code: "invalid-runtime-name",
          severity: "warning",
          message
        }));
        if (!frontmatter.name) {
          issues.push({
            code: "missing-runtime-name",
            severity: "warning",
            message: `SKILL.md has no name; ${candidate.deploymentName} is used as a fallback`
          });
        } else if (!isPortableSkillRuntimeName(frontmatter.name)) {
          issues.push({
            code: "invalid-runtime-name",
            severity: "warning",
            message: `Runtime Skill name does not follow the portable Agent Skills format: ${frontmatter.name}`
          });
        }

        const externalEvidence = await inspectExternalSkillEvidence(candidate.path, location);
        const agentEnvOwned = await isAgentEnvOwnedDir(candidate.path, {
          targetId: options.targetId,
          kind: "skill"
        });
        if (externalEvidence) {
          issues.push({
            code: "external-owner",
            severity: "info",
            message: `${runtimeName} is provided by ${externalEvidence.displayName ?? externalEvidence.manager}`
          });
        }

        observations.push({
          targetId: options.targetId,
          locationPath: location.path,
          path: candidate.path,
          runtimeName,
          deploymentName: candidate.deploymentName,
          version: frontmatter.version,
          scope: location.scope ?? (location.shared ? "shared" : "user"),
          owner: agentEnvOwned
            ? "agentenv"
            : externalEvidence
              ? "external"
              : location.scope === "builtin"
                ? "agent"
                : "user",
          availability:
            location.role === "discovery-only"
              ? "unknown"
              : disabledKeys.has(normalizeSkillKey(runtimeName))
                ? "disabled"
                : "enabled",
          confidence: frontmatter.name ? "verified" : "inferred",
          locationRole: location.role,
          shared: location.shared,
          sharedLocationId: location.sharedLocationId,
          legacy: location.management === "legacy",
          externalEvidence,
          issues
        });
      }
    }

    const byRuntimeName = new Map<string, SkillRuntimeObservation[]>();
    for (const observation of observations) {
      if (observation.availability === "unknown") continue;
      const key = normalizeSkillKey(observation.runtimeName);
      byRuntimeName.set(key, [...(byRuntimeName.get(key) ?? []), observation]);
    }
    for (const duplicates of byRuntimeName.values()) {
      if (duplicates.length < 2) continue;
      const paths = duplicates.map((item) => item.path).join(", ");
      for (const observation of duplicates) {
        observation.issues.push({
          code: "duplicate-runtime-name",
          severity: "warning",
          message: `Runtime name ${observation.runtimeName} is declared by multiple Skills: ${paths}`
        });
      }
    }

    return {
      targetId: options.targetId,
      observations,
      issues: snapshotIssues,
      nativeDisabledRuntimeNames: [...disabledNames].sort((left, right) =>
        left.localeCompare(right)
      )
    };
  };

  return { readNativeState, inspectRuntime };
};
