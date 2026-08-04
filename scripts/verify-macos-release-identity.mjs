import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const assetsRoot = resolve(process.argv[2] ?? "release-assets");
const certificatePath = resolve("build", "macos-signing-certificate.pem");

if (process.platform !== "darwin") {
  throw new Error("macOS Release identity comparison must run on macOS");
}

const files = await readdir(assetsRoot);
const archiveFor = (arch) => {
  const matches = files.filter((name) => name.endsWith(`-mac-${arch}.zip`));
  if (matches.length !== 1) {
    throw new Error(`Expected one macOS ${arch} ZIP in ${assetsRoot}, found ${matches.length}`);
  }
  return join(assetsRoot, matches[0]);
};

const fingerprint = (certificate) =>
  new X509Certificate(certificate).fingerprint256.replaceAll(":", "").toUpperCase();

const inspectArchive = async (archivePath, extractionRoot) => {
  await execFileAsync("/usr/bin/ditto", ["-x", "-k", archivePath, extractionRoot]);
  const appPath = join(extractionRoot, "AgentEnv Manager.app");
  const requirement = await execFileAsync(
    "/usr/bin/codesign",
    ["--display", "--requirements", "-", appPath],
    { encoding: "utf8" }
  );
  const signature = await execFileAsync(
    "/usr/bin/codesign",
    ["--display", "--verbose=4", appPath],
    { encoding: "utf8" }
  );
  const certificatePrefix = join(extractionRoot, "certificate-");
  await execFileAsync(
    "/usr/bin/codesign",
    ["--display", `--extract-certificates=${certificatePrefix}`, appPath],
    { encoding: "utf8" }
  );
  const signatureDetails = [signature.stdout, signature.stderr].filter(Boolean).join("\n");
  const cdHash = signatureDetails.match(/^CDHash=([0-9a-f]+)$/im)?.[1];
  if (!cdHash) throw new Error(`Could not read CDHash from ${archivePath}`);
  return {
    cdHash,
    certificateFingerprint: fingerprint(await readFile(`${certificatePrefix}0`)),
    requirement: [requirement.stdout, requirement.stderr].filter(Boolean).join("\n").trim()
  };
};

const temporaryRoot = await mkdtemp(join(tmpdir(), "agentenv-release-identity-"));
try {
  const [arm64, x64, expectedCertificate] = await Promise.all([
    inspectArchive(archiveFor("arm64"), join(temporaryRoot, "arm64")),
    inspectArchive(archiveFor("x64"), join(temporaryRoot, "x64")),
    readFile(certificatePath)
  ]);
  const expectedFingerprint = fingerprint(expectedCertificate);
  for (const [arch, result] of Object.entries({ arm64, x64 })) {
    if (result.certificateFingerprint !== expectedFingerprint) {
      throw new Error(`${arch} Release signer does not match the pinned certificate`);
    }
  }
  if (arm64.cdHash === x64.cdHash) {
    throw new Error("The architecture fixtures unexpectedly have the same CDHash");
  }
  if (arm64.requirement !== x64.requirement) {
    throw new Error(
      `macOS Release designated requirements differ by architecture:\n` +
        `arm64: ${arm64.requirement}\n` +
        `x64: ${x64.requirement}`
    );
  }
  if (arm64.requirement.includes("cdhash")) {
    throw new Error(`macOS Release identity is tied to one build: ${arm64.requirement}`);
  }

  process.stdout.write(`macOS Release signer: ${expectedFingerprint}\n`);
  process.stdout.write(`stable designated requirement: ${arm64.requirement}\n`);
  process.stdout.write(`distinct build CDHashes: ${arm64.cdHash} / ${x64.cdHash}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
