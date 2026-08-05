import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import {
  ProjectReferenceFileSchema,
  ProjectReferenceSchema,
  SafeIdSchema
} from "../../shared/schemas";
import type {
  ProjectReference,
  ProjectSummary,
  UpdateProjectInput
} from "../../shared/types";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import { createPaths, type PathOverrides } from "../paths";

interface StoredProjects {
  formatVersion: 1;
  projects: ProjectReference[];
}

export interface ProjectStore {
  listProjects(): Promise<ProjectSummary[]>;
  findProjectByPath(rootPath: string): Promise<ProjectSummary | undefined>;
  addProject(rootPath: string, name?: string): Promise<ProjectSummary>;
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

export const createProjectStore = (overrides: PathOverrides): ProjectStore => {
  const paths = createPaths(overrides);

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

  const summarize = async (project: ProjectReference): Promise<ProjectSummary> => ({
    ...project,
    exists: await projectExists(project.rootPath)
  });

  const listProjects = async () => {
    const stored = await readStored();
    const summaries = await Promise.all(stored.projects.map(summarize));
    return summaries.sort((left, right) =>
      Date.parse(right.lastOpenedAt ?? right.createdAt) -
        Date.parse(left.lastOpenedAt ?? left.createdAt) ||
      left.name.localeCompare(right.name)
    );
  };

  const addProject = async (rootPath: string, requestedName?: string) => {
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

    const stored = await readStored();
    if (stored.projects.some((project) => project.rootPath === canonicalPath)) {
      throw new Error("This Project folder is already added");
    }
    const now = new Date().toISOString();
    const project = ProjectReferenceSchema.parse({
      id: `project-${randomUUID()}`,
      name: requestedName?.trim() || basename(canonicalPath) || canonicalPath,
      rootPath: canonicalPath,
      createdAt: now,
      lastOpenedAt: now
    });
    await writeStored({ ...stored, projects: [...stored.projects, project] });
    return summarize(project);
  };

  const findProjectByPath = async (rootPath: string) => {
    if (!isAbsolute(rootPath)) return undefined;
    let canonicalPath: string;
    try {
      canonicalPath = await realpath(rootPath);
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
    const stored = await readStored();
    const project = stored.projects.find((candidate) => candidate.rootPath === canonicalPath);
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
