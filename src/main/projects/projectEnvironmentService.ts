import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import * as TOML from "@iarna/toml";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseYaml } from "yaml";
import type {
  ProjectEnvironmentPreview,
  ProjectEnvironmentSnapshot,
  ProjectGitObservation,
  ProjectResourceKind,
  ProjectResourceSummary,
  ProjectSkillLocationSummary,
  TargetInfo
} from "../../shared/types";
import { isMissingFileError, pathExists } from "../fileUtils";
import { hashFileContent } from "../filesystemIntegrity";
import { hashSkillContent } from "../skillContentHash";
import { parseSkillFrontmatter } from "../skillFrontmatter";
import type { TargetRegistry } from "../targets/registry";
import type { ProjectStore } from "./projectStore";
import type { ProjectGitService } from "./projectGitService";
import type { RemoteDeviceStore } from "../remoteDevices/remoteDeviceStore";
import type { SshTransport } from "../remoteDevices/systemSshTransport";
import {
  extractTarArchiveSafely,
  fetchRemoteWorkspaceResourcesTar,
  inspectRemoteGit
} from "./remoteProjectTransport";
import { SafeIdSchema } from "../../shared/schemas";

export interface ProjectEnvironmentServiceOptions {
  projectStore: ProjectStore;
  targetRegistry: TargetRegistry;
  gitService?: ProjectGitService;
  deviceStore?: RemoteDeviceStore;
  sshTransport?: SshTransport;
  cacheDir?: string;
}

export interface ProjectEnvironmentService {
  inspectProject(projectId: string, enabledAgentIds: readonly string[]): Promise<ProjectEnvironmentSnapshot>;
  findResource(projectId: string, resourceId: string, enabledAgentIds: readonly string[]): Promise<ProjectResourceSummary>;
  previewProject(projectId: string, target: TargetInfo): Promise<ProjectEnvironmentPreview>;
  resolveInstructionDestination(projectId: string, agentId: string): Promise<{
    projectRoot: string;
    destination: string;
    relativePath: string;
  }>;
  resolveSkillDestination(
    projectId: string,
    locationId: string,
    skillId: string,
    enabledAgentIds: readonly string[]
  ): Promise<{
    projectRoot: string;
    skillRoot: string;
    destination: string;
  }>;
  assertProjectSkillPath(projectId: string, path: string): Promise<void>;
}

const MAX_SKILL_TREE_ENTRIES = 2_000;

const resourceId = (kind: ProjectResourceKind, relativePath: string) =>
  `${kind}-${createHash("sha256").update(relativePath).digest("hex").slice(0, 20)}`;

const skillLocationId = (relativePath: string) =>
  `project-skill-location-${createHash("sha256").update(relativePath).digest("hex").slice(0, 20)}`;

const normalizeRelativeDeclaration = (value: string) => {
  if (!value || isAbsolute(value)) throw new Error(`Unsafe absolute Project resource path: ${value}`);
  const normalized = value.split(/[\\/]+/).filter((part) => part && part !== ".");
  if (normalized.some((part) => part === "..")) {
    throw new Error(`Unsafe escaping Project resource path: ${value}`);
  }
  return normalized.join(sep);
};

const assertBoundedParents = async (root: string, candidate: string) => {
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath === ".") return;
  if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath)) {
    throw new Error(`Project resource escapes its root: ${candidate}`);
  }
  let current = root;
  const parts = relativePath.split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new Error(`Project resource uses an unsafe symbolic link: ${current}`);
      }
      if (index < parts.length - 1 && !entry.isDirectory()) {
        throw new Error(`Project resource parent is not a regular directory: ${current}`);
      }
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
  }
};

const assertPortableTree = async (root: string) => {
  const queue = [root];
  let count = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      count += 1;
      if (count > MAX_SKILL_TREE_ENTRIES) throw new Error("Project Skill contains too many files");
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Project Skill contains a symbolic link: ${path}`);
      if (entry.isDirectory()) queue.push(path);
      else if (!entry.isFile()) throw new Error(`Project Skill contains an unsupported entry: ${path}`);
    }
  }
};

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const mcpNamesFromValue = (value: unknown): string[] => {
  const root = objectRecord(value);
  if (!root) return [];
  const candidates = [root.mcpServers, root.mcp, root.servers]
    .map(objectRecord)
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  return [...new Set(candidates.flatMap((candidate) => Object.keys(candidate)))].sort();
};

const parseMcpNames = (path: string, content: string): string[] => {
  const extension = extname(path).toLowerCase();
  if (extension === ".toml") return mcpNamesFromValue(TOML.parse(content));
  if (extension === ".yaml" || extension === ".yml") return mcpNamesFromValue(parseYaml(content));
  return mcpNamesFromValue(parseJsonc(content));
};

export const createProjectEnvironmentService = (
  options: ProjectEnvironmentServiceOptions
): ProjectEnvironmentService => {
  const { projectStore, targetRegistry, gitService, deviceStore, sshTransport, cacheDir } = options;
  const requireProject = async (projectId: string) => {
    const project = (await projectStore.listProjects()).find((candidate) => candidate.id === projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    if (!project.exists) throw new Error(`Project folder is unavailable: ${project.rootPath}`);
    return project;
  };

  const inspectProject: ProjectEnvironmentService["inspectProject"] = async (projectId, enabledAgentIds) => {
    const project = await requireProject(projectId);

    const enabled = new Set(enabledAgentIds);
    const adapters = targetRegistry.listAdapters().filter((adapter) =>
      enabled.has(adapter.descriptor.id) && adapter.projects
    );
    const resources = new Map<string, ProjectResourceSummary>();
    const skillLocationCandidates = new Map<string, ProjectSkillLocationSummary & { priority: number }>();
    const issues: string[] = [];

    const addResource = (resource: ProjectResourceSummary) => {
      const existing = resources.get(resource.id);
      if (!existing) {
        resources.set(resource.id, resource);
        return;
      }
      existing.consumerAgentIds = [...new Set([
        ...existing.consumerAgentIds,
        ...resource.consumerAgentIds
      ])].sort();
      existing.editable = existing.editable || resource.editable;
      if (resource.state !== "ready") existing.state = resource.state;
    };

    for (const adapter of adapters) {
      const capability = adapter.projects!;
      for (const declaration of capability.skillLocations) {
        const normalized = normalizeRelativeDeclaration(declaration.relativePath);
        const relativePath = normalized.split(sep).join("/");
        const id = skillLocationId(relativePath);
        const writable = capability.support.skills.mutate === "supported" && declaration.writable;
        const existing = skillLocationCandidates.get(id);
        if (existing) {
          existing.consumerAgentIds = [...new Set([
            ...existing.consumerAgentIds,
            adapter.descriptor.id
          ])].sort();
          existing.writable = existing.writable || writable;
          existing.priority = Math.max(existing.priority, declaration.priority);
          if (declaration.scope === "shared") existing.scope = "shared";
        } else {
          skillLocationCandidates.set(id, {
            id,
            relativePath,
            scope: declaration.scope,
            consumerAgentIds: [adapter.descriptor.id],
            writable,
            recommended: false,
            priority: declaration.priority
          });
        }
      }
    }

    const skillLocationsWithPriority = [...skillLocationCandidates.values()].sort((left, right) =>
      Number(right.writable) - Number(left.writable) ||
      right.priority - left.priority ||
      Number(right.scope === "shared") - Number(left.scope === "shared") ||
      left.relativePath.localeCompare(right.relativePath)
    );
    const recommendedLocation = skillLocationsWithPriority.find((location) => location.writable);
    const skillLocations: ProjectSkillLocationSummary[] = skillLocationsWithPriority.map(({ priority: _priority, ...location }) => ({
      ...location,
      recommended: location.id === recommendedLocation?.id
    }));

    let basePath = project.rootPath;
    let gitObservation: ProjectGitObservation | undefined;

    if (project.deviceId) {
      if (!deviceStore) throw new Error("SSH device store is not available");
      const device = await deviceStore.get(project.deviceId).catch(() => undefined);
      if (!device) throw new Error(`SSH device not found: ${project.deviceId}`);
      if (!sshTransport) throw new Error("SSH transport is not available");

      const candidates = new Set<string>();
      for (const adapter of adapters) {
        const capability = adapter.projects!;
        for (const declaration of capability.instructionFiles) {
          candidates.add(normalizeRelativeDeclaration(declaration).split(sep).join("/"));
        }
        for (const declaration of capability.skillLocations) {
          candidates.add(normalizeRelativeDeclaration(declaration.relativePath).split(sep).join("/"));
        }
        for (const declaration of capability.mcpFiles) {
          candidates.add(normalizeRelativeDeclaration(declaration).split(sep).join("/"));
        }
      }

      const candidateList = [...candidates];
      const localInspectRoot = join(cacheDir ?? tmpdir(), "agentenv-remote-workspaces", project.id);
      await rm(localInspectRoot, { recursive: true, force: true }).catch(() => undefined);

      try {
        const tarBuffer = await fetchRemoteWorkspaceResourcesTar(
          device,
          sshTransport,
          project.rootPath,
          candidateList
        );
        await extractTarArchiveSafely(tarBuffer, localInspectRoot);
      } catch (error) {
        issues.push(`Remote resource inspection issue: ${error instanceof Error ? error.message : String(error)}`);
      }

      gitObservation = await inspectRemoteGit(
        device,
        sshTransport,
        project.rootPath,
        candidateList
      ).catch((error) => ({
        repository: "unavailable" as const,
        pathStates: {},
        issue: error instanceof Error ? error.message : String(error)
      }));

      basePath = localInspectRoot;
    }

    for (const adapter of adapters) {
      const capability = adapter.projects!;
      const agentId = adapter.descriptor.id;

      for (const declaration of capability.instructionFiles) {
        try {
          const relativeDeclaration = normalizeRelativeDeclaration(declaration);
          const candidate = resolve(basePath, relativeDeclaration);
          if (!project.deviceId) await assertBoundedParents(basePath, candidate);
          let entry;
          try {
            entry = await lstat(candidate);
          } catch (error) {
            if (isMissingFileError(error)) continue;
            throw error;
          }
          const paths = entry.isDirectory()
            ? (await readdir(candidate, { withFileTypes: true }))
                .filter((child) => child.isFile() && /\.md$/i.test(child.name))
                .map((child) => join(candidate, child.name))
            : entry.isFile()
              ? [candidate]
              : [];
          for (const path of paths) {
            if (!project.deviceId) await assertBoundedParents(basePath, path);
            const content = await readFile(path);
            const info = await stat(path);
            const relativePath = relative(basePath, path).split(sep).join("/");
            const absolutePath = project.deviceId ? posix.join(project.rootPath, relativePath) : path;
            addResource({
              id: resourceId("instructions", relativePath),
              kind: "instructions",
              name: basename(path),
              relativePath,
              absolutePath,
              consumerAgentIds: [agentId],
              state: "ready",
              editable: capability.support.instructions.mutate === "supported",
              contentHash: hashFileContent(content),
              modifiedAt: info.mtime.toISOString()
            });
          }
        } catch (error) {
          issues.push(`${adapter.descriptor.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      for (const declaration of capability.skillLocations) {
        try {
          const relativeDeclaration = normalizeRelativeDeclaration(declaration.relativePath);
          const skillRoot = resolve(basePath, relativeDeclaration);
          if (!project.deviceId) await assertBoundedParents(basePath, skillRoot);
          let rootEntry;
          try {
            rootEntry = await lstat(skillRoot);
          } catch (error) {
            if (isMissingFileError(error)) continue;
            throw error;
          }
          if (!rootEntry.isDirectory()) throw new Error(`Project Skill root is not a directory: ${skillRoot}`);
          for (const child of await readdir(skillRoot, { withFileTypes: true })) {
            if (!child.isDirectory() || child.isSymbolicLink()) {
              if (child.isSymbolicLink()) issues.push(`${adapter.descriptor.name}: Project Skill uses an unsafe symbolic link: ${join(skillRoot, child.name)}`);
              continue;
            }
            const skillPath = join(skillRoot, child.name);
            const skillFile = join(skillPath, "SKILL.md");
            try {
              const markdown = await readFile(skillFile, "utf8");
              await assertPortableTree(skillPath);
              const frontmatter = parseSkillFrontmatter(markdown);
              const info = await stat(skillFile);
              const relativePath = relative(basePath, skillPath).split(sep).join("/");
              const absolutePath = project.deviceId ? posix.join(project.rootPath, relativePath) : skillPath;
              addResource({
                id: resourceId("skill", relativePath),
                kind: "skill",
                name: frontmatter.name || child.name,
                relativePath,
                absolutePath,
                consumerAgentIds: [agentId],
                state: frontmatter.errors.length > 0 ? "partial" : "ready",
                editable: capability.support.skills.mutate === "supported" && declaration.writable,
                description: frontmatter.description,
                version: frontmatter.version,
                contentHash: await hashSkillContent(skillPath),
                modifiedAt: info.mtime.toISOString(),
                issue: frontmatter.errors.join("; ") || undefined
              });
            } catch (error) {
              if (!isMissingFileError(error)) {
                issues.push(`${adapter.descriptor.name}: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          }
        } catch (error) {
          issues.push(`${adapter.descriptor.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      for (const declaration of capability.mcpFiles) {
        try {
          const relativeDeclaration = normalizeRelativeDeclaration(declaration);
          const path = resolve(basePath, relativeDeclaration);
          if (!project.deviceId) await assertBoundedParents(basePath, path);
          let entry;
          try {
            entry = await lstat(path);
          } catch (error) {
            if (isMissingFileError(error)) continue;
            throw error;
          }
          if (!entry.isFile()) throw new Error(`Project MCP resource is not a regular file: ${path}`);
          const names = parseMcpNames(path, await readFile(path, "utf8"));
          const info = await stat(path);
          for (const name of names) {
            const relativePath = relative(basePath, path).split(sep).join("/");
            const absolutePath = project.deviceId ? posix.join(project.rootPath, relativePath) : path;
            addResource({
              id: resourceId("mcp", `${relativePath}:${name}`),
              kind: "mcp",
              name,
              relativePath,
              absolutePath,
              consumerAgentIds: [agentId],
              state: "partial",
              editable: false,
              modifiedAt: info.mtime.toISOString(),
              issue: "Only non-secret MCP names are available"
            });
          }
        } catch (error) {
          issues.push(`${adapter.descriptor.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const sortedResources = [...resources.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.relativePath.localeCompare(right.relativePath)
    );
    const git = gitObservation ?? (gitService
      ? await gitService.inspect(project.rootPath, sortedResources.map((resource) => resource.relativePath))
      : { repository: "not-git" as const, pathStates: {} });
    for (const resource of sortedResources) {
      resource.gitState = git.pathStates[resource.relativePath];
    }

    return {
      projectId: project.id,
      projectRoot: project.rootPath,
      resources: sortedResources,
      skillLocations,
      agentSupport: adapters.map((adapter) => ({
        agentId: adapter.descriptor.id,
        agentName: adapter.descriptor.name,
        instructions: { ...adapter.projects!.support.instructions },
        instructionCreateFile: adapter.projects!.instructionCreateFile,
        skills: { ...adapter.projects!.support.skills },
        mcp: { ...adapter.projects!.support.mcp },
        effectivePreview: adapter.projects!.support.effectivePreview,
        cliLaunch: adapter.projects!.support.cliLaunch
      })),
      issues,
      partial: issues.length > 0,
      git
    };
  };

  return {
    inspectProject,
    resolveInstructionDestination: async (projectId, agentId) => {
      const project = await requireProject(projectId);
      const adapter = targetRegistry.get(agentId);
      if (!adapter.projects || adapter.projects.support.instructions.mutate !== "supported") {
        throw new Error(`${adapter.descriptor.name} does not support Project instruction changes`);
      }
      const declaration = adapter.projects.instructionCreateFile;
      if (!declaration) {
        throw new Error(`${adapter.descriptor.name} does not declare a Project instruction file`);
      }
      const relativePath = normalizeRelativeDeclaration(declaration).split(sep).join("/");
      if (project.deviceId) {
        const destination = posix.join(project.rootPath, relativePath);
        return { projectRoot: project.rootPath, destination, relativePath };
      }
      const destination = resolve(project.rootPath, relativePath);
      await assertBoundedParents(project.rootPath, destination);
      const entry = await lstat(destination).catch((error) => {
        if (isMissingFileError(error)) return undefined;
        throw error;
      });
      if (entry && (!entry.isFile() || entry.isSymbolicLink())) {
        throw new Error(`Project instruction destination is not a regular file: ${destination}`);
      }
      return { projectRoot: project.rootPath, destination, relativePath };
    },
    resolveSkillDestination: async (projectId, locationId, unsafeSkillId, enabledAgentIds) => {
      const project = await requireProject(projectId);
      const enabledIds = new Set(enabledAgentIds);
      const declaration = targetRegistry.listAdapters().flatMap((adapter) =>
        enabledIds.has(adapter.descriptor.id) &&
        adapter.projects?.support.skills.mutate === "supported"
          ? adapter.projects.skillLocations
              .filter((location) => location.writable)
              .map((location) => ({ adapter, location }))
          : []
      ).find(({ location }) => {
        const relativePath = normalizeRelativeDeclaration(location.relativePath).split(sep).join("/");
        return skillLocationId(relativePath) === locationId;
      });
      if (!declaration) throw new Error("Project Skill location is unavailable or read-only");
      const relativeRoot = normalizeRelativeDeclaration(declaration.location.relativePath).split(sep).join("/");
      const skillId = SafeIdSchema.parse(unsafeSkillId);

      if (project.deviceId) {
        const skillRoot = posix.join(project.rootPath, relativeRoot);
        const destination = posix.join(skillRoot, skillId);
        return { projectRoot: project.rootPath, skillRoot, destination };
      }

      const skillRoot = resolve(project.rootPath, relativeRoot);
      await assertBoundedParents(project.rootPath, skillRoot);
      const rootEntry = await lstat(skillRoot).catch((error) => {
        if (isMissingFileError(error)) return undefined;
        throw error;
      });
      if (rootEntry && (!rootEntry.isDirectory() || rootEntry.isSymbolicLink())) {
        throw new Error(`Project Skills destination is not a regular directory: ${skillRoot}`);
      }
      const destination = join(skillRoot, skillId);
      await assertBoundedParents(project.rootPath, destination);
      return { projectRoot: project.rootPath, skillRoot, destination };
    },
    assertProjectSkillPath: async (projectId, path) => {
      const project = await requireProject(projectId);
      if (project.deviceId) {
        const rel = posix.relative(project.rootPath, path);
        if (!rel || rel.startsWith("../") || posix.isAbsolute(rel)) {
          throw new Error("Project Skill path escapes workspace root");
        }
        const candidates = targetRegistry.listAdapters().flatMap((adapter) =>
          adapter.projects?.support.skills.mutate === "supported"
            ? adapter.projects.skillLocations
                .filter((decl) => decl.writable)
                .map((decl) =>
                  posix.join(project.rootPath, normalizeRelativeDeclaration(decl.relativePath).split(sep).join("/")))
            : []
        );
        const insideDeclaredRoot = candidates.some((root) => {
          const relFromRoot = posix.relative(root, path);
          return relFromRoot && !relFromRoot.startsWith("../") && !posix.isAbsolute(relFromRoot);
        });
        if (!insideDeclaredRoot) throw new Error("Project Skill path is no longer declared by a supported Agent");
        return;
      }
      const candidates = targetRegistry.listAdapters().flatMap((adapter) =>
        adapter.projects?.support.skills.mutate === "supported"
          ? adapter.projects.skillLocations
              .filter((declaration) => declaration.writable)
              .map((declaration) =>
                resolve(project.rootPath, normalizeRelativeDeclaration(declaration.relativePath)))
          : []
      );
      const insideDeclaredRoot = candidates.some((root) => {
        const relativePath = relative(root, path);
        return relativePath && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
      });
      if (!insideDeclaredRoot) throw new Error("Project Skill path is no longer declared by a supported Agent");
      await assertBoundedParents(project.rootPath, path);
    },
    findResource: async (projectId, requestedResourceId, enabledAgentIds) => {
      const resource = (await inspectProject(projectId, enabledAgentIds)).resources.find(
        (candidate) => candidate.id === requestedResourceId
      );
      if (!resource) throw new Error("Project resource is unavailable or no longer declared by an enabled Agent");
      return resource;
    },
    previewProject: async (projectId, target) => {
      const adapter = targetRegistry.get(target.id);
      if (!adapter.projects) throw new Error(`${target.name} does not support Project inspection`);
      const snapshot = await inspectProject(projectId, [target.id]);
      const globalResources: ProjectEnvironmentPreview["globalResources"] = [];
      const issues = [...snapshot.issues];

      if (await pathExists(target.paths.instructionsPath)) {
        globalResources.push({
          kind: "instructions",
          name: basename(target.paths.instructionsPath),
          path: target.paths.instructionsPath,
          state: "ready",
          detail: "Agent global"
        });
      }

      try {
        const runtime = await adapter.skills.inspectRuntime(target.paths);
        for (const observation of runtime.observations) {
          globalResources.push({
            kind: "skill",
            name: observation.runtimeName,
            path: observation.path,
            state: observation.availability === "enabled" ? "ready" : "partial",
            detail: observation.owner === "agentenv" ? "AgentEnv managed" : "Agent global"
          });
        }
        issues.push(...runtime.issues.map((issue) => `${target.name}: ${issue.message}`));
      } catch (error) {
        issues.push(`${target.name}: Could not inspect global Skills: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (adapter.projects.support.mcp.inspect !== "unsupported") {
        try {
          const captured = await adapter.captureProfile(target.paths);
          for (const connection of captured.mcpConnections ?? []) {
            globalResources.push({
              kind: "mcp",
              name: connection.name,
              path: connection.sourcePath,
              state: connection.enabled ? "ready" : "partial",
              detail: connection.enabled ? "Agent global" : "Disabled in Agent"
            });
          }
          issues.push(...captured.warnings.map((warning) => `${target.name}: ${warning}`));
        } catch (error) {
          issues.push(`${target.name}: Could not inspect global MCP names: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return {
        projectId,
        agentId: target.id,
        agentName: target.name,
        fidelity: adapter.projects.support.effectivePreview === "supported" && issues.length === 0
          ? "full"
          : "partial",
        loadOrder: "unknown",
        projectResources: snapshot.resources,
        globalResources,
        issues
      };
    }
  };
};
