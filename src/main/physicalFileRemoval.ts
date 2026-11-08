import * as fs from "node:fs/promises";
import { createRequire } from "node:module";

// Electron's patched fs treats *.asar as virtual directories, including during
// recursive removal. Delete physical entries without changing ASAR reads globally.
const physicalFs: typeof fs = process.versions.electron
  ? createRequire(import.meta.url)("original-fs").promises
  : fs;

export const removePhysicalPath: typeof fs.rm = (path, options) => physicalFs.rm(path, options);

// Only for uniquely owned scratch data that is no longer needed by a transaction.
export const discardPrivateScratchDirectory = (path: string) => {
  void removePhysicalPath(path, { recursive: true, force: true }).catch((error) => {
    console.warn("[AgentEnv] Could not clean temporary operation data", error);
  });
};
