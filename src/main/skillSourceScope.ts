import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  RepositorySkillScanResult,
  RepositorySkillSourceInput,
  SkillSourceCollectionRef,
  SkillSourceScope
} from "../shared/types";
import { sourceSubpathFor } from "../shared/skillSourceGrouping";
import { parseRepositoryLocation } from "./skillSources/repositoryLocation";

const encodedPath = (value: string) =>
  value.split("/").filter(Boolean).map(encodeURIComponent).join("/");

const canonicalLinkFor = (
  input: RepositorySkillSourceInput,
  ref: string,
  directory: string
) => {
  const location = parseRepositoryLocation(input.repository, { allowLocal: true });
  if (
    location.webUrl &&
    location.inferredRef === ref &&
    (location.inferredDirectory ?? "") === directory
  ) {
    return location.webUrl.replace(/\/+$/, "");
  }
  if (location.kind === "https") {
    return [
      location.displayLocator.replace(/\/+$/, ""),
      "tree",
      encodedPath(ref),
      encodedPath(directory)
    ].filter(Boolean).join("/");
  }
  const query = new URLSearchParams({ ref });
  if (directory) query.set("directory", directory);
  return `${location.displayLocator}#${query.toString()}`;
};

export const createSkillSourceScope = (
  input: RepositorySkillSourceInput,
  result: Pick<RepositorySkillScanResult, "repository" | "ref" | "directory">
): SkillSourceScope => ({
  formatVersion: 1,
  kind: "repository",
  canonicalLink: canonicalLinkFor(input, result.ref, result.directory),
  repository: result.repository,
  ref: result.ref,
  directory: result.directory
});

export const createLocalSkillSourceScope = (rootPath: string): SkillSourceScope => {
  const root = resolve(rootPath);
  return {
    formatVersion: 1,
    kind: "local",
    canonicalLink: pathToFileURL(root).href,
    repository: root,
    ref: "",
    directory: ""
  };
};

export const createLocalSkillSourceCollection = (
  rootPath: string,
  skillPath: string
): SkillSourceCollectionRef => {
  const scope = createLocalSkillSourceScope(rootPath);
  const subpath = relative(scope.repository, resolve(skillPath)).split("\\").join("/");
  if (subpath === ".." || subpath.startsWith("../")) {
    throw new Error("Skill is outside the selected local source folder");
  }
  return { ...scope, sourceSubpath: subpath === "." ? "" : subpath };
};

export const validateLocalSkillSourceCollection = async (
  collection: SkillSourceCollectionRef | undefined,
  skillPath: string
): Promise<SkillSourceCollectionRef | undefined> => {
  if (!collection) return undefined;
  if (collection.kind !== "local") {
    throw new Error("Local Skill source collection is invalid");
  }
  const canonicalSkillPath = await realpath(skillPath);
  const expected = createLocalSkillSourceCollection(collection.repository, canonicalSkillPath);
  if (expected.canonicalLink !== collection.canonicalLink || expected.sourceSubpath !== collection.sourceSubpath) {
    throw new Error("Local Skill source changed after review");
  }
  return expected;
};

export const createSingleSkillSourceCollection = (
  input: RepositorySkillSourceInput,
  result: Pick<RepositorySkillScanResult, "repository" | "ref" | "directory">
): SkillSourceCollectionRef => ({
  ...createSkillSourceScope(input, result),
  sourceSubpath: ""
});

export const validateSkillSourceCollection = (
  collection: SkillSourceCollectionRef | undefined,
  candidate: { repository: string; ref: string; directory: string }
): SkillSourceCollectionRef | undefined => {
  if (!collection) return undefined;
  if (
    collection.formatVersion !== 1 ||
    !collection.canonicalLink ||
    collection.canonicalLink.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(collection.canonicalLink)
  ) {
    throw new Error("Skill source collection link is invalid");
  }
  const collectionRepository = parseRepositoryLocation(collection.repository, { allowLocal: true });
  const candidateRepository = parseRepositoryLocation(candidate.repository, { allowLocal: true });
  if (
    collectionRepository.cacheKeyLocator !== candidateRepository.cacheKeyLocator ||
    collection.ref !== candidate.ref
  ) {
    throw new Error("Skill source collection does not match the imported repository");
  }
  const sourceSubpath = sourceSubpathFor(collection.directory, candidate.directory);
  if (sourceSubpath !== collection.sourceSubpath) {
    throw new Error("Skill source collection path changed after review");
  }
  return { ...collection, sourceSubpath };
};
