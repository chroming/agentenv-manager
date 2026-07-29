import { resolve } from "node:path";
import { assertCurrentBuild } from "./build-fingerprint.mjs";

const projectRoot = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));
const stamp = await assertCurrentBuild(projectRoot);

process.stdout.write(
  `Electron build ${stamp.artifact.sha256.slice(0, 12)} matches current source.\n`
);
