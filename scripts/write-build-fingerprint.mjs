import { resolve } from "node:path";
import { writeBuildFingerprint } from "./build-fingerprint.mjs";

const projectRoot = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));
const stamp = await writeBuildFingerprint(projectRoot);

process.stdout.write(
  `Electron build identity ${stamp.artifact.sha256.slice(0, 12)} recorded for ${stamp.source.files} source files.\n`
);
