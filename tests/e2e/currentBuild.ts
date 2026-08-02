import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { beforeAll } from "vitest";

const execFileAsync = promisify(execFile);

export const requireCurrentElectronBuild = () => {
  beforeAll(async () => {
    try {
      await execFileAsync(
        process.execPath,
        [resolve(process.cwd(), "scripts", "assert-current-build.mjs")],
        {
          cwd: process.cwd(),
          maxBuffer: 1024 * 1024
        }
      );
    } catch (error) {
      const details = error && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : error instanceof Error
          ? error.message
          : String(error);
      throw new Error(details.trim());
    }
  }, 30_000);
};
