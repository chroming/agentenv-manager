import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { extractDesignatedRequirement } from "./macos-release-identity.mjs";

const execFileAsync = promisify(execFile);
const assetsRoot = resolve(process.argv[2] ?? "release-assets");
const certificatePath = resolve("build", "macos-signing-certificate.pem");

if (process.platform !== "darwin") {
  throw new Error("macOS Release identity comparison must run on macOS");
}

const files = await readdir(assetsRoot);
const diskImageFor = (arch) => {
  const matches = files.filter((name) => name.endsWith(`-mac-${arch}-homebrew.dmg`));
  if (matches.length !== 1) {
    throw new Error(
      `Expected one Homebrew macOS ${arch} DMG in ${assetsRoot}, found ${matches.length}`
    );
  }
  return join(assetsRoot, matches[0]);
};

const fingerprint = (certificate) =>
  new X509Certificate(certificate).fingerprint256.replaceAll(":", "").toUpperCase();

const inspectDiskImage = async (diskImagePath, mountPoint) => {
  await mkdir(mountPoint, { recursive: true });
  await execFileAsync("/usr/bin/hdiutil", [
    "attach",
    "-nobrowse",
    "-readonly",
    "-mountpoint",
    mountPoint,
    diskImagePath
  ]);
  try {
    const appPath = join(mountPoint, "AgentEnv Manager.app");
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
    const certificatePrefix = `${mountPoint}-certificate-`;
    await execFileAsync(
      "/usr/bin/codesign",
      ["--display", `--extract-certificates=${certificatePrefix}`, appPath],
      { encoding: "utf8" }
    );
    const signatureDetails = [signature.stdout, signature.stderr].filter(Boolean).join("\n");
    const cdHash = signatureDetails.match(/^CDHash=([0-9a-f]+)$/im)?.[1];
    if (!cdHash) throw new Error(`Could not read CDHash from ${diskImagePath}`);
    const requirementDetails = [requirement.stdout, requirement.stderr].filter(Boolean).join("\n");
    return {
      cdHash,
      certificateFingerprint: fingerprint(await readFile(`${certificatePrefix}0`)),
      requirement: extractDesignatedRequirement(requirementDetails, diskImagePath)
    };
  } finally {
    await execFileAsync("/usr/bin/hdiutil", ["detach", mountPoint]);
  }
};

const temporaryRoot = await mkdtemp(join(tmpdir(), "agentenv-release-identity-"));
try {
  const expectedCertificate = await readFile(certificatePath);
  const arm64 = await inspectDiskImage(
    diskImageFor("arm64"),
    join(temporaryRoot, "arm64")
  );
  const x64 = await inspectDiskImage(
    diskImageFor("x64"),
    join(temporaryRoot, "x64")
  );
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
