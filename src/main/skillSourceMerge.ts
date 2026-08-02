import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { SkillSourceGroupView } from "../shared/types";
import { parseRepositoryLocation } from "./skillSources/repositoryLocation";

const normalizedDirectory = (value: string) => {
  if (/\\|[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Source directory contains invalid characters");
  }
  const segments = value.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Source directory must not contain traversal segments");
  }
  return segments.join("/");
};

export const commonSkillSourceDirectory = (directories: readonly string[]) => {
  if (directories.length < 2) throw new Error("Select at least two sources to merge");
  const paths = directories.map((directory) => normalizedDirectory(directory).split("/").filter(Boolean));
  const common: string[] = [];
  for (let index = 0; index < Math.min(...paths.map((path) => path.length)); index += 1) {
    const segment = paths[0]![index];
    if (!paths.every((path) => path[index] === segment)) break;
    common.push(segment!);
  }
  return common.join("/");
};

export const validateSkillSourceMerge = (
  sources: readonly SkillSourceGroupView[],
  requestedDirectory?: string,
  requestedRootPath?: string
) => {
  if (sources.length < 2) throw new Error("Select at least two sources to merge");
  const sourceKind = sources[0]!.sourceKind ?? sources[0]!.kind ?? "repository";
  if (sources.some((source) => (source.sourceKind ?? source.kind ?? "repository") !== sourceKind)) {
    throw new Error("Local folders and repositories cannot be merged into one source");
  }
  if (sourceKind === "local") {
    const roots = sources.map((source) => resolve(source.repository));
    const commonSegments = roots.map((root) => root.split(sep).filter(Boolean));
    const common: string[] = [];
    for (let index = 0; index < Math.min(...commonSegments.map((segments) => segments.length)); index += 1) {
      const segment = commonSegments[0]![index];
      if (!commonSegments.every((segments) => segments[index] === segment)) break;
      common.push(segment!);
    }
    const computedRoot = `${sep}${common.join(sep)}`;
    const rootPath = requestedRootPath?.trim() ? resolve(requestedRootPath.trim()) : computedRoot;
    if (!isAbsolute(rootPath)) throw new Error("Merged local source must use an absolute folder path");
    const outside = roots.find((root) => {
      const path = relative(rootPath, root);
      return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
    });
    if (outside) throw new Error(`Merged folder does not contain selected source: ${outside}`);
    return {
      kind: "local" as const,
      repository: rootPath,
      ref: "",
      directory: "",
      computedDirectory: computedRoot
    };
  }
  const firstLocation = parseRepositoryLocation(sources[0]!.repository, { allowLocal: true });
  if (sources.some((source) =>
    parseRepositoryLocation(source.repository, { allowLocal: true }).cacheKeyLocator !==
      firstLocation.cacheKeyLocator)) {
    throw new Error("Selected sources must belong to the same repository");
  }
  if (sources.some((source) => source.ref !== sources[0]!.ref)) {
    throw new Error("Selected sources must use the same revision");
  }
  const computedDirectory = commonSkillSourceDirectory(sources.map((source) => source.directory));
  const directory = typeof requestedDirectory === "string"
    ? normalizedDirectory(requestedDirectory)
    : computedDirectory;
  const outsideSource = sources.find((source) => {
    const sourceDirectory = normalizedDirectory(source.directory);
    return Boolean(directory) &&
      directory !== sourceDirectory &&
      !sourceDirectory.startsWith(`${directory}/`);
  });
  if (outsideSource) {
    throw new Error(
      `Merged directory /${directory || "."} does not contain selected source /${normalizedDirectory(outsideSource.directory) || "."}`
    );
  }
  return {
    kind: "repository" as const,
    repository: sources[0]!.repository,
    ref: sources[0]!.ref,
    directory: posix.normalize(directory || ".") === "." ? "" : directory,
    computedDirectory
  };
};
