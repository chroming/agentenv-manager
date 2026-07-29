import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const computeVerificationSourceFingerprint = async (projectRoot) => {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: projectRoot, maxBuffer: 40 * 1024 * 1024 }
  );
  const files = stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => file !== "docs/verification-snapshot.json")
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    try {
      hash.update(await readFile(join(projectRoot, file)));
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
      hash.update("<deleted>");
    }
    hash.update("\0");
  }
  return {
    sha256: hash.digest("hex"),
    files: files.length
  };
};
