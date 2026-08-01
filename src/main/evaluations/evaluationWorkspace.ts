import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  OneShotEvaluationFileDiff,
  OneShotEvaluationResourceScope
} from "../../shared/evaluations";
import { profileResourceMode } from "../../shared/profileResources";
import type {
  ProfileDetail,
  SkillLibraryEntry,
  TargetPaths,
  TargetSkillLocation
} from "../../shared/types";
import { hashPathEntry } from "../filesystemIntegrity";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import { hashSkillContent } from "../skillContentHash";
import type { GitCommandRunner } from "../skillSources/gitCommandRunner";
import type { AgentTargetAdapter } from "../targets/types";

export interface EvaluationProjectSnapshot {
  projectPath: string;
  revision: string;
  status: string;
  worktreeFingerprint: string;
  hasUncommittedChanges: boolean;
}

export interface EvaluationMaterializedResources {
  targetPaths: TargetPaths;
  skillContentHashes: Record<string, string>;
  scopes: {
    instructions: OneShotEvaluationResourceScope;
    skills: OneShotEvaluationResourceScope;
  };
  warnings: string[];
}

interface ProtectedPathSnapshot {
  path: string;
  hash?: string;
}

interface MaskedProjectResource {
  path: string;
  storedPath: string;
}

export interface PreparedEvaluationWorkspace {
  root: string;
  home: string;
  project: string;
  temp: string;
  projectSnapshot: EvaluationProjectSnapshot;
  protectedPaths: ProtectedPathSnapshot[];
  maskedProjectResources: MaskedProjectResource[];
  resources: EvaluationMaterializedResources;
}

export interface EvaluationWorkspace {
  cleanupStale(): Promise<void>;
  inspectProject(path: string): Promise<EvaluationProjectSnapshot>;
  prepare(input: {
    adapter: AgentTargetAdapter;
    profile: ProfileDetail;
    librarySkills: SkillLibraryEntry[];
    project: EvaluationProjectSnapshot;
    sourceTargetPaths: TargetPaths;
    platform?: NodeJS.Platform;
    signal?: AbortSignal;
  }): Promise<PreparedEvaluationWorkspace>;
  readChanges(workspace: PreparedEvaluationWorkspace): Promise<{
    diff: string;
    fileDiffs: OneShotEvaluationFileDiff[];
    changedFiles: string[];
  }>;
  verifyOriginals(workspace: PreparedEvaluationWorkspace): Promise<void>;
  cleanup(workspace: Pick<PreparedEvaluationWorkspace, "root">): Promise<void>;
}

export interface EvaluationWorkspaceOptions {
  cacheRoot: string;
  git: GitCommandRunner;
  platform?: NodeJS.Platform;
}

const trimGitOutput = (value: string) => value.replace(/[\r\n]+$/, "");

const nulSeparatedPaths = (value: string) =>
  value.split("\0").filter((path) => path.length > 0);

const fingerprintWorktree = async (
  projectPath: string,
  status: string,
  git: GitCommandRunner
) => {
  const [trackedResult, untrackedResult, indexResult] = await Promise.all([
    git.run(["-C", projectPath, "diff", "--name-only", "-z", "HEAD", "--"], {
      maxOutputBytes: 16 * 1024 * 1024
    }),
    git.run(["-C", projectPath, "ls-files", "--others", "--exclude-standard", "-z"], {
      maxOutputBytes: 16 * 1024 * 1024
    }),
    git.run(["-C", projectPath, "diff", "--cached", "--raw", "--full-index", "-z", "HEAD", "--"], {
      maxOutputBytes: 16 * 1024 * 1024
    })
  ]);
  const paths = [...new Set([
    ...nulSeparatedPaths(trackedResult.stdout),
    ...nulSeparatedPaths(untrackedResult.stdout)
  ])].sort((left, right) => left.localeCompare(right));
  const entries = await Promise.all(paths.map(async (path) => {
    const absolutePath = resolve(projectPath, path);
    const relation = relative(projectPath, absolutePath);
    if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
      throw new Error(`Git reported a path outside the selected project: ${path}`);
    }
    return { path, hash: await hashPathEntry(absolutePath) };
  }));
  return createHash("sha256").update(JSON.stringify({
    status,
    index: indexResult.stdout,
    entries
  })).digest("hex");
};

const portableRelativePath = (root: string, path: string) => {
  const result = relative(root, path);
  if (!result || result === ".") return basename(path);
  if (result === ".." || result.startsWith(`..${sep}`) || isAbsolute(result)) {
    throw new Error(`Evaluation resource is outside its declared location: ${path}`);
  }
  return result;
};

const pathType = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
};

const normalizedProjectResourcePaths = (projectRoot: string, paths: readonly string[]) => {
  const normalized = [...new Set(paths.map((path) => {
    const absolutePath = resolve(projectRoot, path);
    const relation = relative(projectRoot, absolutePath);
    if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
      throw new Error(`Evaluation project resource is outside the project: ${path}`);
    }
    return relation;
  }))].sort((left, right) => left.length - right.length || left.localeCompare(right));
  return normalized.filter((candidate, index) => !normalized.slice(0, index).some((parent) => {
    const relation = relative(parent, candidate);
    return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
  }));
};

const maskProjectResources = async (
  root: string,
  projectRoot: string,
  paths: readonly string[]
) => {
  const maskRoot = join(root, "project-agent-resources");
  const masked: MaskedProjectResource[] = [];
  for (const path of normalizedProjectResourcePaths(projectRoot, paths)) {
    const sourcePath = join(projectRoot, path);
    if (!await pathType(sourcePath)) continue;
    const storedPath = join(maskRoot, path);
    await mkdir(dirname(storedPath), { recursive: true, mode: 0o700 });
    await rename(sourcePath, storedPath);
    masked.push({ path, storedPath });
  }
  return masked;
};

const restoreMissingResourceTree = async (storedPath: string, destinationPath: string): Promise<void> => {
  const [storedStats, destinationStats] = await Promise.all([
    pathType(storedPath),
    pathType(destinationPath)
  ]);
  if (!storedStats) return;
  if (!destinationStats) {
    await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
    await rename(storedPath, destinationPath);
    return;
  }
  if (storedStats.isDirectory() && destinationStats.isDirectory()) {
    for (const entry of await readdir(storedPath)) {
      await restoreMissingResourceTree(
        join(storedPath, entry),
        join(destinationPath, entry)
      );
    }
  }
  await rm(storedPath, { recursive: true, force: true });
};

const restoreProjectResources = async (workspace: PreparedEvaluationWorkspace) => {
  if (workspace.maskedProjectResources.length === 0) return;
  const masked = workspace.maskedProjectResources.splice(0);
  for (const resource of masked) {
    await restoreMissingResourceTree(
      resource.storedPath,
      join(workspace.project, resource.path)
    );
  }
  await rm(join(workspace.root, "project-agent-resources"), {
    recursive: true,
    force: true
  });
};

const copySkillSnapshot = async (
  sourcePath: string,
  destinationPath: string,
  platform: NodeJS.Platform
) => {
  const sourceBefore = await hashSkillContent(sourcePath);
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
  await cp(sourcePath, destinationPath, {
    recursive: true,
    dereference: true
  });
  if (platform !== "win32") await chmod(destinationPath, 0o700);
  const [sourceAfter, destinationHash] = await Promise.all([
    hashSkillContent(sourcePath),
    hashSkillContent(destinationPath)
  ]);
  if (sourceBefore !== sourceAfter) {
    throw new Error(`Skill changed while its evaluation snapshot was created: ${sourcePath}`);
  }
  if (destinationHash !== sourceBefore) {
    throw new Error(`Evaluation Skill snapshot does not match its source: ${sourcePath}`);
  }
  return sourceBefore;
};

const locationIndex = (
  paths: TargetPaths,
  locationPath: string
) => (paths.skillLocations ?? []).findIndex(
  (location) => resolve(location.path) === resolve(locationPath)
);

const destinationLocationFor = (
  sourcePaths: TargetPaths,
  destinationPaths: TargetPaths,
  sourceLocationPath: string
): TargetSkillLocation | undefined => {
  const index = locationIndex(sourcePaths, sourceLocationPath);
  if (index < 0) return undefined;
  return destinationPaths.skillLocations?.[index];
};

const splitFileDiffs = (diff: string): OneShotEvaluationFileDiff[] => {
  if (!diff.trim()) return [];
  const starts: number[] = [];
  const pattern = /^diff --git /gm;
  for (let match = pattern.exec(diff); match; match = pattern.exec(diff)) {
    starts.push(match.index);
  }
  if (starts.length === 0) return [{ path: "workspace.diff", diff }];
  return starts.map((start, index) => {
    const chunk = diff.slice(start, starts[index + 1] ?? diff.length);
    const header = chunk.match(/^diff --git a\/(.+) b\/(.+)$/m);
    const path = header?.[2] ?? header?.[1] ?? `change-${index + 1}`;
    const action = /^new file mode /m.test(chunk)
      ? "add" as const
      : /^deleted file mode /m.test(chunk)
        ? "remove" as const
        : "replace" as const;
    return { path, diff: chunk, action };
  });
};

const protectedPathsFor = (targetPaths: TargetPaths) => [...new Set([
  targetPaths.instructionsPath,
  targetPaths.instructionsOverridePath,
  targetPaths.configPath,
  targetPaths.mcpConfigPath,
  ...(targetPaths.skillLocations ?? []).map((location) => location.path)
].filter((path): path is string => Boolean(path)))];

export const createEvaluationWorkspace = (
  options: EvaluationWorkspaceOptions
): EvaluationWorkspace => {
  const platform = options.platform ?? process.platform;

  const inspectProject = async (inputPath: string): Promise<EvaluationProjectSnapshot> => {
    const selectedPath = await realpath(inputPath).catch((error) => {
      if (isMissingFileError(error)) throw new Error("Selected project folder no longer exists");
      throw error;
    });
    const rootResult = await options.git.run(["-C", selectedPath, "rev-parse", "--show-toplevel"])
      .catch(() => {
        throw new Error("Select a local Git project with at least one commit");
      });
    const projectPath = await realpath(trimGitOutput(rootResult.stdout));
    const revisionResult = await options.git.run(["-C", projectPath, "rev-parse", "--verify", "HEAD"])
      .catch(() => {
        throw new Error("The selected Git project has no commit yet");
      });
    const statusResult = await options.git.run([
      "-C",
      projectPath,
      "status",
      "--porcelain=v1",
      "--untracked-files=all"
    ]);
    const status = statusResult.stdout;
    return {
      projectPath,
      revision: trimGitOutput(revisionResult.stdout),
      status,
      worktreeFingerprint: await fingerprintWorktree(projectPath, status, options.git),
      hasUncommittedChanges: status.length > 0
    };
  };

  const prepare: EvaluationWorkspace["prepare"] = async (input) => {
    if (input.signal?.aborted) throw new Error("Evaluation was cancelled");
    await mkdir(options.cacheRoot, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(join(options.cacheRoot, "run-"));
    if (platform !== "win32") await chmod(root, 0o700);
    const home = join(root, "home");
    const project = join(root, "project");
    const temp = join(root, "tmp");
    await Promise.all([
      mkdir(home, { recursive: true, mode: 0o700 }),
      mkdir(temp, { recursive: true, mode: 0o700 })
    ]);

    try {
      await options.git.run([
        "clone",
        "--no-hardlinks",
        "--no-checkout",
        "--",
        input.project.projectPath,
        project
      ], {
        env: { GIT_LFS_SKIP_SMUDGE: "1" },
        signal: input.signal,
        timeoutMs: 5 * 60 * 1_000,
        maxOutputBytes: 4 * 1024 * 1024
      });
      await options.git.run([
        "-C",
        project,
        "checkout",
        "--detach",
        input.project.revision
      ], {
        env: { GIT_LFS_SKIP_SMUDGE: "1" },
        signal: input.signal,
        timeoutMs: 5 * 60 * 1_000
      });
      if (input.signal?.aborted) throw new Error("Evaluation was cancelled");

      const targetPaths = input.adapter.createTargetPaths({
        homeDir: home,
        fakeHomeRoot: join(home, ".agentenv-fake-home"),
        platform,
        environment: {
          HOME: home,
          USERPROFILE: home
        }
      });
      const warnings: string[] = [];
      const skillContentHashes: Record<string, string> = {};
      const instructionsMode = profileResourceMode(
        input.profile.resources,
        input.adapter.descriptor.id,
        "instructions"
      );
      const skillsMode = profileResourceMode(
        input.profile.resources,
        input.adapter.descriptor.id,
        "skills"
      );

      let includedInstructions = 0;
      if (instructionsMode === "manage" && input.profile.instructions) {
        await writeAtomic(targetPaths.instructionsPath, input.profile.instructions, {
          mode: 0o600,
          platform
        });
        includedInstructions = 1;
      } else if (instructionsMode === "ignore") {
        const sourceHash = await hashPathEntry(input.sourceTargetPaths.instructionsPath);
        if (sourceHash) {
          const sourceContent = await readFile(input.sourceTargetPaths.instructionsPath, "utf8");
          await writeAtomic(targetPaths.instructionsPath, sourceContent, {
            mode: 0o600,
            platform
          });
          if (await hashPathEntry(input.sourceTargetPaths.instructionsPath) !== sourceHash) {
            throw new Error("Agent Instructions changed while the evaluation snapshot was created");
          }
          includedInstructions = 1;
        }
      }

      let includedSkills = 0;
      let omittedSkills = 0;
      if (skillsMode === "manage") {
        const libraryById = new Map(input.librarySkills.map((skill) => [skill.id, skill]));
        for (const reference of input.profile.resources.skills) {
          if (input.signal?.aborted) throw new Error("Evaluation was cancelled");
          const skill = libraryById.get(reference.libraryId);
          if (!reference.enabled || !skill?.globallyEnabled) {
            omittedSkills += 1;
            continue;
          }
          const destinationRoot = targetPaths.skillsDir;
          if (!destinationRoot) {
            warnings.push(`${input.adapter.descriptor.name} has no isolated Skills location`);
            omittedSkills += 1;
            continue;
          }
          const destination = join(destinationRoot, reference.targetName);
          skillContentHashes[reference.libraryId] = await copySkillSnapshot(
            skill.path,
            destination,
            platform
          );
          includedSkills += 1;
        }
      } else if (skillsMode === "ignore") {
        const snapshot = await input.adapter.skills.inspectRuntime(input.sourceTargetPaths);
        warnings.push(...snapshot.issues
          .filter((issue) => issue.severity !== "info")
          .map((issue) => issue.message));
        const copiedDestinations = new Set<string>();
        for (const observation of snapshot.observations) {
          if (input.signal?.aborted) throw new Error("Evaluation was cancelled");
          if (observation.availability !== "enabled") continue;
          const destinationLocation = destinationLocationFor(
            input.sourceTargetPaths,
            targetPaths,
            observation.locationPath
          );
          if (!destinationLocation) {
            warnings.push(`Current Skill ${observation.runtimeName} could not be mapped into the isolated Agent`);
            omittedSkills += 1;
            continue;
          }
          const relativePath = portableRelativePath(observation.locationPath, observation.path);
          const destination = join(destinationLocation.path, relativePath);
          if (copiedDestinations.has(resolve(destination))) continue;
          const hash = await copySkillSnapshot(observation.path, destination, platform);
          copiedDestinations.add(resolve(destination));
          skillContentHashes[`current:${observation.targetId}:${relativePath}`] = hash;
          includedSkills += 1;
        }
      } else {
        omittedSkills = input.profile.resources.skills.length;
      }

      const protectedPaths = await Promise.all(
        protectedPathsFor(input.sourceTargetPaths).map(async (path) => ({
          path,
          hash: await hashPathEntry(path)
        }))
      );
      const maskedProjectResources = await maskProjectResources(
        root,
        project,
        input.adapter.evaluations?.projectResourcePaths ?? []
      );
      if (input.signal?.aborted) throw new Error("Evaluation was cancelled");
      return {
        root,
        home,
        project,
        temp,
        projectSnapshot: input.project,
        protectedPaths,
        maskedProjectResources,
        resources: {
          targetPaths,
          skillContentHashes,
          scopes: {
            instructions: {
              mode: instructionsMode,
              includedCount: includedInstructions
            },
            skills: {
              mode: skillsMode,
              includedCount: includedSkills,
              omittedCount: omittedSkills
            }
          },
          warnings: [...new Set(warnings)]
        }
      };
    } catch (error) {
      await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
      throw error;
    }
  };

  const readChanges: EvaluationWorkspace["readChanges"] = async (workspace) => {
    await restoreProjectResources(workspace);
    await options.git.run(["-C", workspace.project, "add", "-N", "--all"]);
    const [diffResult, namesResult] = await Promise.all([
      options.git.run([
        "-C",
        workspace.project,
        "diff",
        "--binary",
        "--no-ext-diff",
        workspace.projectSnapshot.revision,
        "--"
      ], { maxOutputBytes: 8 * 1024 * 1024 }),
      options.git.run([
        "-C",
        workspace.project,
        "diff",
        "--name-only",
        "--no-ext-diff",
        workspace.projectSnapshot.revision,
        "--"
      ], { maxOutputBytes: 1024 * 1024 })
    ]);
    const diff = diffResult.stdout;
    return {
      diff,
      fileDiffs: splitFileDiffs(diff),
      changedFiles: namesResult.stdout.split(/\r?\n/).filter(Boolean)
    };
  };

  const verifyOriginals: EvaluationWorkspace["verifyOriginals"] = async (workspace) => {
    const [projectAfter, ...pathHashes] = await Promise.all([
      inspectProject(workspace.projectSnapshot.projectPath),
      ...workspace.protectedPaths.map((entry) => hashPathEntry(entry.path))
    ]);
    if (
      projectAfter.revision !== workspace.projectSnapshot.revision ||
      projectAfter.worktreeFingerprint !== workspace.projectSnapshot.worktreeFingerprint
    ) {
      throw new Error("The original project changed during evaluation; no result was accepted");
    }
    workspace.protectedPaths.forEach((entry, index) => {
      if (pathHashes[index] !== entry.hash) {
        throw new Error(`The real Agent changed during evaluation: ${entry.path}`);
      }
    });
  };

  const cleanup: EvaluationWorkspace["cleanup"] = async (workspace) => {
    await rm(workspace.root, {
      recursive: true,
      force: true,
      maxRetries: platform === "win32" ? 8 : 4,
      retryDelay: 80
    });
  };

  const cleanupStale: EvaluationWorkspace["cleanupStale"] = async () => {
    await mkdir(options.cacheRoot, { recursive: true, mode: 0o700 });
    const entries = await readdir(options.cacheRoot, { withFileTypes: true });
    await Promise.all(entries
      .filter((entry) => /^run-[A-Za-z0-9_-]+$/.test(entry.name))
      .map((entry) => rm(join(options.cacheRoot, entry.name), {
        recursive: true,
        force: true,
        maxRetries: platform === "win32" ? 8 : 4,
        retryDelay: 80
      })));
  };

  return { cleanupStale, inspectProject, prepare, readChanges, verifyOriginals, cleanup };
};
