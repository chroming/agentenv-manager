import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, posix } from "node:path";
import {
  AddProjectInputSchema,
  ProjectReferenceFileSchema,
  ProjectReferenceSchema,
  SafeIdSchema
} from "../../shared/schemas";
import type {
  AddProjectInput,
  ProjectReference,
  ProjectSummary,
  UpdateProjectInput
} from "../../shared/types";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import { createPaths, type PathOverrides } from "../paths";
import type { RemoteDeviceStore } from "../remoteDevices/remoteDeviceStore";
import type { SshTransport } from "../remoteDevices/systemSshTransport";
import { testRemoteProjectPath } from "./remoteProjectTransport";

interface StoredProjects {
  formatVersion: 1;
  projects: ProjectReference[];
}

export interface ProjectStoreOptions extends PathOverrides {
  deviceStore?: RemoteDeviceStore;
  sshTransport?: SshTransport;
}

export interface ProjectStore {
  listProjects(): Promise<ProjectSummary[]>;
  findProjectByPath(rootPath: string, deviceId?: string): Promise<ProjectSummary | undefined>;
  addProject(rootPathOrInput: string | AddProjectInput, name?: string): Promise<ProjectSummary>;
  updateProject(input: UpdateProjectInput): Promise<ProjectSummary>;
  removeProject(id: string): Promise<void>;
}

const emptyProjects = (): StoredProjects => ({ formatVersion: 1, projects: [] });

const parseProjectId = (id: string) => {
  const parsed = SafeIdSchema.safeParse(id);
  if (!parsed.success) throw new Error("Invalid Project id");
  return parsed.data;
};

const projectExists = async (rootPath: string) => {
  try {
    const stats = await lstat(rootPath);
    return stats.isDirectory() || (stats.isSymbolicLink() && await realpath(rootPath).then(() => true));
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
};

export const createProjectStore = (options: ProjectStoreOptions): ProjectStore => {
  const paths = createPaths(options);
  const deviceStore = options.deviceStore;
  const sshTransport = options.sshTransport;

  const readStored = async (): Promise<StoredProjects> => {
    try {
      return ProjectReferenceFileSchema.parse(
        JSON.parse(await readFile(paths.projectsPath, "utf8"))
      );
    } catch (error) {
      if (isMissingFileError(error)) return emptyProjects();
      throw error;
    }
  };

  const writeStored = async (stored: StoredProjects) => {
    const parsed = ProjectReferenceFileSchema.parse(stored);
    await writeAtomic(paths.projectsPath, `${JSON.stringify(parsed, null, 2)}\n`);
  };

  const summarize = async (project: ProjectReference): Promise<ProjectSummary> => {
    if (project.deviceId) {
      const device = await deviceStore?.get(project.deviceId).catch(() => undefined);
      if (!device) {
        return {
          ...project,
          exists: false,
          isRemote: true,
          remoteStatus: "unreachable"
        };
      }
      let exists = false;
      let remoteStatus: ProjectSummary["remoteStatus"] = "ready";
      if (sshTransport) {
        const probe = await testRemoteProjectPath(device, sshTransport, project.rootPath);
        exists = probe.exists && Boolean(probe.isDirectory);
        remoteStatus = exists
          ? "ready"
          : probe.error?.toLowerCase().includes("timed out") || probe.error?.toLowerCase().includes("unreachable")
            ? "unreachable"
            : "path-missing";
      } else {
        exists = true;
      }
      return {
        ...project,
        exists,
        isRemote: true,
        deviceName: device.name,
        deviceHost: device.host,
        remoteStatus
      };
    }
    return {
      ...project,
      exists: await projectExists(project.rootPath),
      isRemote: false
    };
  };

  const listProjects = async () => {
    const stored = await readStored();
    const summaries = await Promise.all(stored.projects.map(summarize));
    return summaries.sort((left, right) =>
      Date.parse(right.lastOpenedAt ?? right.createdAt) -
        Date.parse(left.lastOpenedAt ?? left.createdAt) ||
      left.name.localeCompare(right.name)
    );
  };

  const addProject = async (rootPathOrInput: string | AddProjectInput, requestedName?: string) => {
    let rootPath: string;
    let name = requestedName;
    let deviceId: string | undefined;

    if (typeof rootPathOrInput === "object" && rootPathOrInput !== null) {
      const parsed = AddProjectInputSchema.parse(rootPathOrInput);
      if (typeof parsed === "string") {
        rootPath = parsed;
      } else {
        rootPath = parsed.rootPath;
        name = parsed.name ?? name;
        deviceId = parsed.deviceId;
      }
    } else {
      rootPath = String(rootPathOrInput);
    }

    const stored = await readStored();
    const now = new Date().toISOString();

    if (deviceId) {
      if (!deviceStore) throw new Error("SSH device store is not available");
      const device = await deviceStore.get(deviceId).catch(() => undefined);
      if (!device) throw new Error(`SSH device was not found: ${deviceId}`);
      if (!sshTransport) throw new Error("SSH transport is not available");

      const probe = await testRemoteProjectPath(device, sshTransport, rootPath);
      if (!probe.exists) {
        throw new Error(probe.error || `Remote directory does not exist on ${device.name}: ${rootPath}`);
      }
      if (!probe.isDirectory) {
        throw new Error(`Remote path is not a directory on ${device.name}: ${rootPath}`);
      }
      const canonicalPath = probe.canonicalPath || rootPath;
      if (stored.projects.some((p) => p.deviceId === deviceId && p.rootPath === canonicalPath)) {
        throw new Error("This Project folder is already added");
      }
      const project = ProjectReferenceSchema.parse({
        id: `project-${randomUUID()}`,
        name: name?.trim() || posix.basename(canonicalPath) || canonicalPath,
        rootPath: canonicalPath,
        deviceId,
        createdAt: now,
        lastOpenedAt: now
      });
      await writeStored({ ...stored, projects: [...stored.projects, project] });
      return summarize(project);
    }

    if (!isAbsolute(rootPath)) throw new Error("Project folder must use an absolute path");
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(rootPath);
      const stats = await lstat(canonicalPath);
      if (!stats.isDirectory()) throw new Error("Project path is not a directory");
    } catch (error) {
      if (isMissingFileError(error)) throw new Error("Project folder does not exist");
      throw error;
    }

    if (stored.projects.some((project) => !project.deviceId && project.rootPath === canonicalPath)) {
      throw new Error("This Project folder is already added");
    }
    const project = ProjectReferenceSchema.parse({
      id: `project-${randomUUID()}`,
      name: name?.trim() || basename(canonicalPath) || canonicalPath,
      rootPath: canonicalPath,
      createdAt: now,
      lastOpenedAt: now
    });
    await writeStored({ ...stored, projects: [...stored.projects, project] });
    return summarize(project);
  };

  const findProjectByPath = async (rootPath: string, deviceId?: string) => {
    const stored = await readStored();
    if (deviceId) {
      const project = stored.projects.find(
        (candidate) => candidate.deviceId === deviceId && candidate.rootPath === rootPath
      );
      return project ? summarize(project) : undefined;
    }
    if (!isAbsolute(rootPath)) return undefined;
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(rootPath);
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
    const project = stored.projects.find(
      (candidate) => !candidate.deviceId && candidate.rootPath === canonicalPath
    );
    return project ? summarize(project) : undefined;
  };

  const updateProject = async (input: UpdateProjectInput) => {
    const id = parseProjectId(input.id);
    const stored = await readStored();
    const index = stored.projects.findIndex((project) => project.id === id);
    if (index < 0) throw new Error(`Project not found: ${id}`);
    const current = stored.projects[index];
    const updated = ProjectReferenceSchema.parse({
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.deviceId !== undefined ? { deviceId: input.deviceId } : {}),
      ...(input.lastAgentId !== undefined ? { lastAgentId: input.lastAgentId } : {}),
      ...(input.markOpened ? { lastOpenedAt: new Date().toISOString() } : {})
    });
    const projects = [...stored.projects];
    projects[index] = updated;
    await writeStored({ ...stored, projects });
    return summarize(updated);
  };

  const removeProject = async (unsafeId: string) => {
    const id = parseProjectId(unsafeId);
    const stored = await readStored();
    const projects = stored.projects.filter((project) => project.id !== id);
    if (projects.length === stored.projects.length) {
      throw new Error(`Project not found: ${id}`);
    }
    await writeStored({ ...stored, projects });
  };

  return { listProjects, findProjectByPath, addProject, updateProject, removeProject };
};
