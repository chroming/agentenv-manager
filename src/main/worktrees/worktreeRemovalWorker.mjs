import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";

const fs = process.versions.electron
  ? createRequire(import.meta.url)("original-fs").promises
  : await import("node:fs/promises");
const reply = (value) => process.parentPort
  ? process.parentPort.postMessage(value)
  : process.send(value);

const remove = async (request) => {
  try {
    reply({ stage: "validating" });
    if (!request || typeof request.path !== "string" || !isAbsolute(request.path) || resolve(request.path) !== request.path) {
      throw new Error("Invalid Worktree removal path");
    }
    const info = await fs.lstat(request.path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || String(info.dev) !== request.device || String(info.ino) !== request.inode) {
      throw new Error("Worktree Trash directory identity changed");
    }
    // The owner retries the whole verified slot. Per-directory retries multiply
    // recursively and can turn a persistent ENOTEMPTY into hours of waiting.
    reply({ stage: "removing" });
    await fs.rm(request.path, { recursive: true, force: true, maxRetries: 0 });
    reply({ ok: true });
  } catch (error) {
    reply({ ok: false, error: { message: error instanceof Error ? error.message : String(error), code: error?.code } });
  }
};

let started = false;
const receive = (request) => { if (!started) { started = true; void remove(request); } };
if (process.parentPort) process.parentPort.on("message", ({ data }) => receive(data));
else {
  process.on("message", receive);
  process.once("disconnect", () => process.exit(1));
}
reply({ stage: "ready" });
