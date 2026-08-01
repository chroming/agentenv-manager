import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  OneShotEvaluationFileDiff,
  OneShotEvaluationResourceScope,
  OneShotEvaluationWorkspaceInput,
  OneShotEvaluationWorkspaceSummary
} from "../../shared/evaluations";
import { profileResourceMode } from "../../shared/profileResources";
import type {
  ProfileDetail,
  SkillLibraryEntry,
  TargetPaths,
  TargetSkillLocation
} from "../../shared/types";
import { createUnifiedDiff } from "../diff";
import { hashPathEntry } from "../filesystemIntegrity";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import type { GitCommandRunner } from "../skillSources/gitCommandRunner";
import type { AgentTargetAdapter } from "../targets/types";

const MAX_WORKSPACE_FILES = 50_000;
const MAX_WORKSPACE_BYTES = 1024 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 128 * 1024 * 1024;
const MAX_TEXT_DIFF_BYTES = 2 * 1024 * 1024;
const GENERATED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "dist",
  "node_modules"
]);
const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  "auth.json",
  "credentials.json",
  "id_ed25519",
  "id_rsa"
]);

type WorkspaceEntryKind = "directory" | "file" | "symlink";

interface WorkspaceEntry {
  path: string;
  kind: WorkspaceEntryKind;
  size: number;
  hash: string;
  sourceLinkTarget?: string;
  snapshotLinkTarget?: string;
}

export interface EvaluationWorkspaceSnapshot {
  input: OneShotEvaluationWorkspaceInput;
  summary: OneShotEvaluationWorkspaceSummary;
  entries: WorkspaceEntry[];
  warnings: string[];
}

export interface EvaluationMaterializedResources {
  targetPaths: TargetPaths;
  environmentContentHash: string;
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
  baseline: string;
  project: string;
  temp: string;
  workspaceSnapshot: EvaluationWorkspaceSnapshot;
  protectedPaths: ProtectedPathSnapshot[];
  maskedProjectResources: MaskedProjectResource[];
  resources: EvaluationMaterializedResources;
}

export interface EvaluationWorkspaceChanges {
  diff: string;
  fileDiffs: OneShotEvaluationFileDiff[];
  changedFiles: string[];
}

export interface EvaluationWorkspace {
  cleanupStale(): Promise<void>;
  inspectWorkspace(input: OneShotEvaluationWorkspaceInput): Promise<EvaluationWorkspaceSnapshot>;
  prepare(input: {
    adapter: AgentTargetAdapter;
    profile: ProfileDetail;
    librarySkills: SkillLibraryEntry[];
    workspace: EvaluationWorkspaceSnapshot;
    sourceTargetPaths: TargetPaths;
    platform?: NodeJS.Platform;
    signal?: AbortSignal;
  }): Promise<PreparedEvaluationWorkspace>;
  readChanges(workspace: PreparedEvaluationWorkspace): Promise<EvaluationWorkspaceChanges>;
  compareOutputs(
    current: PreparedEvaluationWorkspace,
    proposed: PreparedEvaluationWorkspace
  ): Promise<EvaluationWorkspaceChanges>;
  verifyOriginals(workspace: PreparedEvaluationWorkspace): Promise<void>;
  cleanup(workspace: Pick<PreparedEvaluationWorkspace, "root">): Promise<void>;
}

export interface EvaluationWorkspaceOptions {
  cacheRoot: string;
  git?: GitCommandRunner;
  loadGitRunner?: () => Promise<GitCommandRunner | undefined>;
  platform?: NodeJS.Platform;
}

const portablePath = (value: string) => value.split(sep).join("/");

const isWithin = (root: string, candidate: string) => {
  const relation = relative(root, candidate);
  return relation === "" || (
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
};

const readAndHashRegularFile = async (
  path: string,
  destinationPath?: string,
  signal?: AbortSignal
) => {
  const source = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let destination: Awaited<ReturnType<typeof open>> | undefined;
  const hash = createHash("sha256");
  let size = 0;
  try {
    const stats = await source.stat();
    if (!stats.isFile()) throw new Error(`Comparison source is not a regular file: ${path}`);
    if (destinationPath) {
      destination = await open(
        destinationPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600
      );
    }
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      if (signal?.aborted) throw new Error("Comparison was cancelled");
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (destination) {
        let written = 0;
        while (written < bytesRead) {
          const result = await destination.write(chunk, written, bytesRead - written, position + written);
          if (result.bytesWritten === 0) throw new Error(`Unable to copy comparison file: ${path}`);
          written += result.bytesWritten;
        }
      }
      position += bytesRead;
    }
    size = position;
    if (size !== stats.size) throw new Error(`Comparison file changed while it was read: ${path}`);
    if (destination) await destination.sync();
  } finally {
    await Promise.allSettled([source.close(), destination?.close()]);
  }
  return { hash: hash.digest("hex"), size };
};

const hashFile = async (path: string) => (await readAndHashRegularFile(path)).hash;

const hashEntryList = (entries: WorkspaceEntry[]) => createHash("sha256")
  .update(JSON.stringify(entries.map(({ sourceLinkTarget: _source, ...entry }) => entry)))
  .digest("hex");

const isSensitiveFile = (path: string) => {
  const name = basename(path).toLowerCase();
  if (SENSITIVE_FILE_NAMES.has(name)) return true;
  if (name.startsWith(".env.") && !name.endsWith(".example") && !name.endsWith(".sample")) {
    return true;
  }
  return name.endsWith(".pem") || name.endsWith(".key") || name.endsWith(".p12");
};

const scanDirectory = async (
  sourceRoot: string,
  options: { enforceLimits: boolean; omitSensitive: boolean }
): Promise<{ entries: WorkspaceEntry[]; warnings: string[]; omittedCount: number }> => {
  const canonicalRoot = await realpath(sourceRoot);
  const entries: WorkspaceEntry[] = [];
  const warnings: string[] = [];
  let omittedCount = 0;
  let totalBytes = 0;

  const walk = async (absolutePath: string, relativePath: string): Promise<void> => {
    const stats = await lstat(absolutePath);
    const normalizedPath = portablePath(relativePath);
    if (stats.isDirectory()) {
      const canonicalPath = await realpath(absolutePath);
      if (!isWithin(canonicalRoot, canonicalPath)) {
        throw new Error(`${normalizedPath || "Workspace"} resolved outside its snapshot root`);
      }
      if (relativePath && GENERATED_DIRECTORY_NAMES.has(basename(relativePath))) {
        omittedCount += 1;
        return;
      }
      if (relativePath) {
        entries.push({ path: normalizedPath, kind: "directory", size: 0, hash: "directory" });
      }
      const children = await readdir(absolutePath);
      children.sort((left, right) => left.localeCompare(right));
      for (const child of children) {
        await walk(join(absolutePath, child), relativePath ? join(relativePath, child) : child);
      }
      return;
    }
    if (stats.isSymbolicLink()) {
      const sourceLinkTarget = await readlink(absolutePath);
      const resolvedTarget = resolve(dirname(absolutePath), sourceLinkTarget);
      const canonicalTarget = await realpath(absolutePath).catch(() => undefined);
      if (!isWithin(sourceRoot, resolvedTarget) || (canonicalTarget && !isWithin(canonicalRoot, canonicalTarget))) {
        omittedCount += 1;
        warnings.push(`${normalizedPath} points outside the selected folder and was excluded`);
        return;
      }
      const targetRelation = portablePath(relative(sourceRoot, resolvedTarget));
      entries.push({
        path: normalizedPath,
        kind: "symlink",
        size: 0,
        hash: createHash("sha256").update(targetRelation).digest("hex"),
        sourceLinkTarget,
        snapshotLinkTarget: targetRelation
      });
      return;
    }
    if (!stats.isFile()) {
      omittedCount += 1;
      warnings.push(`${normalizedPath} is not a regular file and was excluded`);
      return;
    }
    if (options.omitSensitive && isSensitiveFile(normalizedPath)) {
      omittedCount += 1;
      warnings.push(`${normalizedPath} may contain credentials and was excluded`);
      return;
    }
    const canonicalPath = await realpath(absolutePath);
    if (!isWithin(canonicalRoot, canonicalPath)) {
      throw new Error(`${normalizedPath} resolved outside its snapshot root`);
    }
    if (options.enforceLimits && stats.size > MAX_SINGLE_FILE_BYTES) {
      throw new Error(`${normalizedPath} is too large for an isolated Workspace snapshot`);
    }
    totalBytes += stats.size;
    if (options.enforceLimits && totalBytes > MAX_WORKSPACE_BYTES) {
      throw new Error("The selected folder is too large for an isolated Workspace snapshot");
    }
    entries.push({
      path: normalizedPath,
      kind: "file",
      size: stats.size,
      hash: await hashFile(absolutePath)
    });
    if (options.enforceLimits && entries.length > MAX_WORKSPACE_FILES) {
      throw new Error("The selected folder contains too many files for an isolated Workspace snapshot");
    }
  };

  await walk(sourceRoot, "");
  return { entries, warnings: [...new Set(warnings)], omittedCount };
};

const gitMetadata = async (
  folder: string,
  runner: GitCommandRunner | undefined
): Promise<OneShotEvaluationWorkspaceSummary["git"]> => {
  if (!runner) return undefined;
  try {
    const [revision, branch, status] = await Promise.all([
      runner.run(["-C", folder, "rev-parse", "--verify", "HEAD"]),
      runner.run(["-C", folder, "branch", "--show-current"]),
      runner.run(["-C", folder, "status", "--porcelain=v1", "--untracked-files=all"])
    ]);
    return {
      revision: revision.stdout.trim(),
      ...(branch.stdout.trim() ? { branch: branch.stdout.trim() } : {}),
      hasUncommittedChanges: Boolean(status.stdout.trim())
    };
  } catch {
    return undefined;
  }
};

const copySnapshot = async (
  snapshot: EvaluationWorkspaceSnapshot,
  destinationRoot: string,
  platform: NodeJS.Platform,
  signal?: AbortSignal
) => {
  if (signal?.aborted) throw new Error("Comparison was cancelled");
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  if (snapshot.input.kind === "empty") return;
  const sourceRoot = snapshot.summary.path!;
  for (const entry of snapshot.entries.filter((candidate) => candidate.kind === "directory")) {
    if (signal?.aborted) throw new Error("Comparison was cancelled");
    await mkdir(join(destinationRoot, entry.path), { recursive: true, mode: 0o700 });
  }
  for (const entry of snapshot.entries.filter((candidate) => candidate.kind === "file")) {
    if (signal?.aborted) throw new Error("Comparison was cancelled");
    const source = join(sourceRoot, entry.path);
    const destination = join(destinationRoot, entry.path);
    const canonicalSource = await realpath(source);
    if (!isWithin(sourceRoot, canonicalSource)) {
      throw new Error(`Workspace file resolved outside its snapshot root: ${entry.path}`);
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const copied = await readAndHashRegularFile(source, destination, signal);
    const [sourceAfter, destinationHash] = await Promise.all([
      hashFile(source),
      hashFile(destination)
    ]);
    if (copied.size !== entry.size || copied.hash !== entry.hash || sourceAfter !== entry.hash) {
      throw new Error(`Workspace file changed while its snapshot was created: ${entry.path}`);
    }
    if (destinationHash !== entry.hash) {
      throw new Error(`Workspace snapshot does not match its source: ${entry.path}`);
    }
    if (platform !== "win32") await chmod(destination, 0o600);
  }
  for (const entry of snapshot.entries.filter((candidate) => candidate.kind === "symlink")) {
    if (signal?.aborted) throw new Error("Comparison was cancelled");
    const destination = join(destinationRoot, entry.path);
    const destinationTarget = join(destinationRoot, entry.snapshotLinkTarget!);
    const target = relative(dirname(destination), destinationTarget) || ".";
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await symlink(target, destination);
  }
};

const portableRelativePath = (root: string, path: string) => {
  const result = relative(root, path);
  if (!result || result === ".") return basename(path);
  if (result === ".." || result.startsWith(`..${sep}`) || isAbsolute(result)) {
    throw new Error(`Comparison resource is outside its declared location: ${path}`);
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
      throw new Error(`Comparison Workspace resource is outside the Workspace: ${path}`);
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

const restoreProjectResources = async (workspace: PreparedEvaluationWorkspace) => {
  if (workspace.maskedProjectResources.length === 0) return;
  const masked = workspace.maskedProjectResources.splice(0);
  for (const resource of masked) {
    const destination = join(workspace.project, resource.path);
    await rm(destination, { recursive: true, force: true });
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await rename(resource.storedPath, destination);
  }
  await rm(join(workspace.root, "project-agent-resources"), { recursive: true, force: true });
};

const copySkillSnapshot = async (
  sourcePath: string,
  destinationPath: string,
  platform: NodeJS.Platform,
  signal?: AbortSignal,
  options: { allowRootSymlink?: boolean } = {}
) => {
  const rootStats = await lstat(sourcePath);
  if (rootStats.isSymbolicLink() && !options.allowRootSymlink) {
    throw new Error(`Library Skill must be a regular directory: ${sourcePath}`);
  }
  const resolvedSourcePath = await realpath(sourcePath);
  const confirmedRootStats = await lstat(sourcePath);
  if (
    confirmedRootStats.dev !== rootStats.dev ||
    confirmedRootStats.ino !== rootStats.ino ||
    confirmedRootStats.isSymbolicLink() !== rootStats.isSymbolicLink() ||
    confirmedRootStats.isDirectory() !== rootStats.isDirectory()
  ) {
    throw new Error(`Skill source changed while its comparison snapshot was created: ${sourcePath}`);
  }
  if (!rootStats.isSymbolicLink()) {
    const expectedRoot = join(await realpath(dirname(sourcePath)), basename(sourcePath));
    if (resolvedSourcePath !== expectedRoot) {
      throw new Error(`Library Skill resolved outside its declared directory: ${sourcePath}`);
    }
  }
  const resolvedStats = rootStats.isSymbolicLink() ? await lstat(resolvedSourcePath) : rootStats;
  if (!resolvedStats.isDirectory()) {
    throw new Error(`Skill source must be a regular directory: ${sourcePath}`);
  }
  const rootWarnings = rootStats.isSymbolicLink()
    ? [`${sourcePath} is a symbolic link; its resolved Skill content was frozen`]
    : [];
  const scanned = await scanDirectory(resolvedSourcePath, { enforceLimits: true, omitSensitive: true });
  const snapshot: EvaluationWorkspaceSnapshot = {
    input: { kind: "folder", path: resolvedSourcePath },
    entries: scanned.entries,
    warnings: scanned.warnings,
    summary: {
      kind: "folder",
      path: resolvedSourcePath,
      name: basename(resolvedSourcePath),
      contentHash: hashEntryList(scanned.entries),
      fileCount: scanned.entries.filter((entry) => entry.kind === "file").length,
      totalBytes: scanned.entries.reduce(
        (total, entry) => total + (entry.kind === "file" ? entry.size : 0),
        0
      ),
      omittedCount: scanned.omittedCount
    }
  };
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
  await copySnapshot(snapshot, destinationPath, platform, signal);
  if (platform !== "win32") await chmod(destinationPath, 0o700);
  const sourceAfter = await scanDirectory(resolvedSourcePath, { enforceLimits: true, omitSensitive: true });
  if (hashEntryList(sourceAfter.entries) !== snapshot.summary.contentHash) {
    throw new Error(`Skill changed while its comparison snapshot was created: ${sourcePath}`);
  }
  return {
    contentHash: snapshot.summary.contentHash,
    warnings: [...rootWarnings, ...scanned.warnings],
    omittedCount: scanned.omittedCount
  };
};

const locationIndex = (paths: TargetPaths, locationPath: string) =>
  (paths.skillLocations ?? []).findIndex(
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

const protectedPathsFor = (targetPaths: TargetPaths) => [...new Set([
  targetPaths.instructionsPath,
  targetPaths.instructionsOverridePath,
  targetPaths.configPath,
  targetPaths.mcpConfigPath,
  ...(targetPaths.skillLocations ?? []).map((location) => location.path)
].filter((path): path is string => Boolean(path)))];

const readMaybeText = async (path: string, size: number) => {
  if (size > MAX_TEXT_DIFF_BYTES) return undefined;
  const content = await readFile(path);
  return content.includes(0) ? undefined : content.toString("utf8");
};

const diffDirectories = async (beforeRoot: string, afterRoot: string): Promise<EvaluationWorkspaceChanges> => {
  const [before, after] = await Promise.all([
    scanDirectory(beforeRoot, { enforceLimits: false, omitSensitive: false }),
    scanDirectory(afterRoot, { enforceLimits: false, omitSensitive: false })
  ]);
  const beforeByPath = new Map(before.entries.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.entries.map((entry) => [entry.path, entry]));
  const changedPaths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
    .filter((path) => {
      const left = beforeByPath.get(path);
      const right = afterByPath.get(path);
      return left?.kind !== right?.kind || left?.hash !== right?.hash;
    })
    .filter((path) => beforeByPath.get(path)?.kind !== "directory" || afterByPath.get(path)?.kind !== "directory")
    .sort((left, right) => left.localeCompare(right));
  const fileDiffs: OneShotEvaluationFileDiff[] = [];
  for (const path of changedPaths) {
    const left = beforeByPath.get(path);
    const right = afterByPath.get(path);
    const action = !left ? "add" as const : !right ? "remove" as const : "replace" as const;
    const beforeText = left?.kind === "file"
      ? await readMaybeText(join(beforeRoot, path), left.size)
      : left?.kind === "symlink" ? `symlink -> ${left.snapshotLinkTarget ?? ""}\n` : "";
    const afterText = right?.kind === "file"
      ? await readMaybeText(join(afterRoot, path), right.size)
      : right?.kind === "symlink" ? `symlink -> ${right.snapshotLinkTarget ?? ""}\n` : "";
    const diff = beforeText !== undefined && afterText !== undefined
      ? createUnifiedDiff(path, beforeText, afterText)
      : `diff --git a/${path} b/${path}\nBinary or oversized file ${action}d\n`;
    fileDiffs.push({ path, action, diff });
  }
  return {
    diff: fileDiffs.map((entry) => entry.diff).join("\n"),
    fileDiffs,
    changedFiles: changedPaths
  };
};

const environmentContentHash = (
  instructionsHash: string | undefined,
  skills: Record<string, string>
) => createHash("sha256").update(JSON.stringify({
  instructions: instructionsHash ?? null,
  skills: Object.entries(skills).sort(([left], [right]) => left.localeCompare(right))
})).digest("hex");

export const createEvaluationWorkspace = (
  options: EvaluationWorkspaceOptions
): EvaluationWorkspace => {
  const platform = options.platform ?? process.platform;
  let loadedGit: GitCommandRunner | undefined = options.git;
  let gitAttempted = Boolean(options.git);

  const optionalGit = async () => {
    if (loadedGit || gitAttempted || !options.loadGitRunner) return loadedGit;
    gitAttempted = true;
    loadedGit = await options.loadGitRunner().catch(() => undefined);
    return loadedGit;
  };

  const inspectWorkspace = async (
    input: OneShotEvaluationWorkspaceInput
  ): Promise<EvaluationWorkspaceSnapshot> => {
    if (input.kind === "empty") {
      const contentHash = createHash("sha256").update("agentenv-empty-workspace-v1").digest("hex");
      return {
        input,
        entries: [],
        warnings: [],
        summary: {
          kind: "empty",
          name: "Empty workspace",
          contentHash,
          fileCount: 0,
          totalBytes: 0,
          omittedCount: 0
        }
      };
    }
    const path = await realpath(input.path).catch((error) => {
      if (isMissingFileError(error)) throw new Error("Selected Workspace folder no longer exists");
      throw error;
    });
    const stats = await lstat(path);
    if (!stats.isDirectory()) throw new Error("Select a local Workspace folder");
    const scanned = await scanDirectory(path, { enforceLimits: true, omitSensitive: true });
    const files = scanned.entries.filter((entry) => entry.kind === "file");
    return {
      input: { kind: "folder", path },
      entries: scanned.entries,
      warnings: scanned.warnings,
      summary: {
        kind: "folder",
        path,
        name: basename(path) || path,
        contentHash: hashEntryList(scanned.entries),
        fileCount: files.length,
        totalBytes: files.reduce((total, entry) => total + entry.size, 0),
        git: await gitMetadata(path, await optionalGit()),
        omittedCount: scanned.omittedCount
      }
    };
  };

  const prepare: EvaluationWorkspace["prepare"] = async (input) => {
    if (input.signal?.aborted) throw new Error("Comparison was cancelled");
    await mkdir(options.cacheRoot, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(join(options.cacheRoot, "run-"));
    if (platform !== "win32") await chmod(root, 0o700);
    const home = join(root, "home");
    const baseline = join(root, "baseline");
    const project = join(root, "workspace");
    const temp = join(root, "tmp");
    try {
      await Promise.all([
        mkdir(home, { recursive: true, mode: 0o700 }),
        mkdir(temp, { recursive: true, mode: 0o700 }),
        copySnapshot(input.workspace, baseline, platform, input.signal)
      ]);
      await copySnapshot(input.workspace, project, platform, input.signal);
      if (input.signal?.aborted) throw new Error("Comparison was cancelled");

      const targetPaths = input.adapter.createTargetPaths({
        homeDir: home,
        fakeHomeRoot: join(home, ".agentenv-fake-home"),
        platform,
        environment: { HOME: home, USERPROFILE: home }
      });
      const warnings = [...input.workspace.warnings];
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
          await writeAtomic(targetPaths.instructionsPath, sourceContent, { mode: 0o600, platform });
          if (await hashPathEntry(input.sourceTargetPaths.instructionsPath) !== sourceHash) {
            throw new Error("Agent Instructions changed while the comparison snapshot was created");
          }
          includedInstructions = 1;
        }
      }

      let includedSkills = 0;
      let omittedSkills = 0;
      if (skillsMode === "manage") {
        const libraryById = new Map(input.librarySkills.map((skill) => [skill.id, skill]));
        for (const reference of input.profile.resources.skills) {
          if (input.signal?.aborted) throw new Error("Comparison was cancelled");
          const skill = libraryById.get(reference.libraryId);
          if (!reference.enabled || !skill?.globallyEnabled) {
            omittedSkills += 1;
            continue;
          }
          if (!targetPaths.skillsDir) {
            warnings.push(`${input.adapter.descriptor.name} has no isolated Skills location`);
            omittedSkills += 1;
            continue;
          }
          const destination = join(targetPaths.skillsDir, reference.targetName);
          const copied = await copySkillSnapshot(
            skill.path,
            destination,
            platform,
            input.signal
          );
          skillContentHashes[reference.targetName] = copied.contentHash;
          warnings.push(...copied.warnings.map((warning) => `${reference.targetName}: ${warning}`));
          includedSkills += 1;
        }
      } else if (skillsMode === "ignore") {
        const snapshot = await input.adapter.skills.inspectRuntime(input.sourceTargetPaths);
        warnings.push(...snapshot.issues
          .filter((issue) => issue.severity !== "info")
          .map((issue) => issue.message));
        const copiedDestinations = new Set<string>();
        for (const observation of snapshot.observations) {
          if (input.signal?.aborted) throw new Error("Comparison was cancelled");
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
          const copied = await copySkillSnapshot(
            observation.path,
            destination,
            platform,
            input.signal,
            { allowRootSymlink: true }
          );
          skillContentHashes[observation.runtimeName] = copied.contentHash;
          warnings.push(...copied.warnings.map((warning) => `${observation.runtimeName}: ${warning}`));
          copiedDestinations.add(resolve(destination));
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
      const instructionsHash = await hashPathEntry(targetPaths.instructionsPath);
      return {
        root,
        home,
        baseline,
        project,
        temp,
        workspaceSnapshot: input.workspace,
        protectedPaths,
        maskedProjectResources,
        resources: {
          targetPaths,
          environmentContentHash: environmentContentHash(instructionsHash, skillContentHashes),
          skillContentHashes,
          scopes: {
            instructions: { mode: instructionsMode, includedCount: includedInstructions },
            skills: { mode: skillsMode, includedCount: includedSkills, omittedCount: omittedSkills }
          },
          warnings: [...new Set(warnings)]
        }
      };
    } catch (error) {
      await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
      throw error;
    }
  };

  const readChanges = async (workspace: PreparedEvaluationWorkspace) => {
    await restoreProjectResources(workspace);
    return diffDirectories(workspace.baseline, workspace.project);
  };

  const compareOutputs = async (
    current: PreparedEvaluationWorkspace,
    proposed: PreparedEvaluationWorkspace
  ) => {
    await Promise.all([restoreProjectResources(current), restoreProjectResources(proposed)]);
    return diffDirectories(current.project, proposed.project);
  };

  const verifyOriginals = async (workspace: PreparedEvaluationWorkspace) => {
    const [sourceAfter, ...pathHashes] = await Promise.all([
      inspectWorkspace(workspace.workspaceSnapshot.input),
      ...workspace.protectedPaths.map((entry) => hashPathEntry(entry.path))
    ]);
    if (sourceAfter.summary.contentHash !== workspace.workspaceSnapshot.summary.contentHash) {
      throw new Error("The original Workspace changed during comparison; no result was accepted");
    }
    workspace.protectedPaths.forEach((entry, index) => {
      if (pathHashes[index] !== entry.hash) {
        throw new Error(`The real Agent changed during comparison: ${entry.path}`);
      }
    });
  };

  const cleanup = async (workspace: Pick<PreparedEvaluationWorkspace, "root">) => {
    await rm(workspace.root, {
      recursive: true,
      force: true,
      maxRetries: platform === "win32" ? 8 : 4,
      retryDelay: 80
    });
  };

  const cleanupStale = async () => {
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

  return {
    cleanupStale,
    inspectWorkspace,
    prepare,
    readChanges,
    compareOutputs,
    verifyOriginals,
    cleanup
  };
};
