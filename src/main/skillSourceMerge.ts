import { posix } from "node:path";
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
  requestedDirectory?: string
) => {
  if (sources.length < 2) throw new Error("Select at least two sources to merge");
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
    repository: sources[0]!.repository,
    ref: sources[0]!.ref,
    directory: posix.normalize(directory || ".") === "." ? "" : directory,
    computedDirectory
  };
};
