import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertCurrentBuild } from "./build-fingerprint.mjs";
import { computeVerificationSourceFingerprint } from "./verification-fingerprint.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const snapshotPath = join(projectRoot, "docs", "verification-snapshot.json");
const [build, source, snapshot] = await Promise.all([
  assertCurrentBuild(projectRoot),
  computeVerificationSourceFingerprint(projectRoot),
  readFile(snapshotPath, "utf8").then(JSON.parse)
]);

if (
  snapshot.source?.fingerprint !== source.sha256 ||
  snapshot.source?.files !== source.files
) {
  throw new Error(
    "Product verification is stale: source changed after the verification snapshot. Run npm run verify:product."
  );
}
if (
  snapshot.build?.sourceFingerprint !== build.source.sha256 ||
  snapshot.build?.artifactFingerprint !== build.artifact.sha256
) {
  throw new Error(
    "Product verification used a different Electron build. Run npm run verify:product."
  );
}
if (snapshot.captures?.artifactFingerprint !== build.artifact.sha256) {
  throw new Error(
    "UI captures are not bound to the current Electron build. Run npm run verify:product."
  );
}

process.stdout.write(
  `Product verification matches source and Electron build ${build.artifact.sha256.slice(0, 12)}.\n`
);
