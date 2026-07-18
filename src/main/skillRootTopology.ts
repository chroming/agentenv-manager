import { lstat, mkdir, readlink, realpath, stat } from "node:fs/promises";
import { isMissingFileError, replacePathAtomically } from "./fileUtils";

export interface SkillRootTransition {
  path: string;
  linkTarget: string;
  resolvedPath: string;
}

export type SkillRootInspection =
  | { kind: "missing" | "directory" }
  | { kind: "symlink"; transition: SkillRootTransition }
  | { kind: "invalid"; error: string };

const errorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;

export const inspectSkillRoot = async (
  path: string | undefined
): Promise<SkillRootInspection> => {
  if (!path) return { kind: "missing" };

  let entryStats;
  try {
    entryStats = await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) return { kind: "missing" };
    throw error;
  }

  if (!entryStats.isSymbolicLink()) {
    return entryStats.isDirectory()
      ? { kind: "directory" }
      : { kind: "invalid", error: `Skills root is not a directory: ${path}` };
  }

  const linkTarget = await readlink(path);
  try {
    const resolvedPath = await realpath(path);
    if (!(await stat(resolvedPath)).isDirectory()) {
      return {
        kind: "invalid",
        error: `Skills root link does not point to a directory: ${path} -> ${linkTarget}`
      };
    }
    return {
      kind: "symlink",
      transition: { path, linkTarget, resolvedPath }
    };
  } catch (error) {
    const code = errorCode(error);
    return {
      kind: "invalid",
      error:
        code === "ELOOP"
          ? `Skills root contains a symbolic link cycle: ${path} -> ${linkTarget}`
          : `Skills root link target is unavailable: ${path} -> ${linkTarget}`
    };
  }
};

export const isolateSkillRoot = async (expected: SkillRootTransition) => {
  const current = await inspectSkillRoot(expected.path);
  if (
    current.kind !== "symlink" ||
    current.transition.linkTarget !== expected.linkTarget ||
    current.transition.resolvedPath !== expected.resolvedPath
  ) {
    throw new Error(`Skills root changed after preview: ${expected.path}`);
  }

  await replacePathAtomically(expected.path, async (stagingPath) => {
    await mkdir(stagingPath, { recursive: true });
  });
};
