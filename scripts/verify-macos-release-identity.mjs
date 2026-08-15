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
const diskImageFor = (arch, channel) => {
  const suffix = channel === "homebrew"
    ? `-mac-${arch}-homebrew.dmg`
    : `-mac-${arch}.dmg`;
  const matches = files.filter((name) => name.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${channel} macOS ${arch} DMG in ${assetsRoot}, found ${matches.length}`
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
  const variants = {};
  for (const channel of ["direct", "homebrew"]) {
    for (const arch of ["arm64", "x64"]) {
      const key = `${channel}-${arch}`;
      variants[key] = await inspectDiskImage(
        diskImageFor(arch, channel),
        join(temporaryRoot, key)
      );
    }
  }
  const expectedFingerprint = fingerprint(expectedCertificate);
  for (const [variant, result] of Object.entries(variants)) {
    if (result.certificateFingerprint !== expectedFingerprint) {
      throw new Error(`${variant} Release signer does not match the pinned certificate`);
    }
    if (result.requirement.includes("cdhash")) {
      throw new Error(`${variant} Release identity is tied to one build: ${result.requirement}`);
    }
  }
  if (variants["direct-arm64"].cdHash === variants["direct-x64"].cdHash) {
    throw new Error("The architecture fixtures unexpectedly have the same CDHash");
  }
  const requirements = new Set(
    Object.values(variants).map((result) => result.requirement)
  );
  if (requirements.size !== 1) {
    const details = Object.entries(variants)
      .map(([variant, result]) => `${variant}: ${result.requirement}`)
      .join("\n");
    throw new Error(
      `macOS Release designated requirements differ by channel or architecture:\n${details}`
    );
  }
  const [stableRequirement] = requirements;

  process.stdout.write(`macOS Release signer: ${expectedFingerprint}\n`);
  process.stdout.write(`stable designated requirement: ${stableRequirement}\n`);
  for (const [variant, result] of Object.entries(variants)) {
    process.stdout.write(`${variant} CDHash: ${result.cdHash}\n`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
