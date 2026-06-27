import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

export const readTextIfExists = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return "";
    }
    throw error;
  }
};

export const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

export const writeAtomic = async (targetPath: string, content: string) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.agentenv-tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, targetPath);
};
