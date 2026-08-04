import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultAppPath = () =>
  resolve(
    process.cwd(),
    "release",
    process.arch === "arm64" ? "mac-arm64" : "mac",
    "AgentEnv Manager.app"
  );

const parseOptions = (argv) => {
  const options = { appPath: defaultAppPath(), certificatePath: undefined };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || (flag !== "--app" && flag !== "--certificate")) {
      throw new Error(
        "Usage: node scripts/verify-macos-signature.mjs " +
          "[--app <path>] [--certificate <path>]"
      );
    }
    if (flag === "--app") options.appPath = resolve(value);
    if (flag === "--certificate") options.certificatePath = resolve(value);
  }
  return options;
};

const outputFromError = (error) => {
  if (!(error instanceof Error)) return String(error);
  const commandError = error;
  const commandOutput = [commandError.stdout, commandError.stderr]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n")
    .trim();
  return commandOutput || commandError.message;
};

const requireGatekeeperRejection = async (appPath) => {
  try {
    const result = await execFileAsync(
      "/usr/sbin/spctl",
      ["--assess", "--type", "execute", "--verbose=4", appPath],
      { encoding: "utf8" }
    );
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `Gatekeeper unexpectedly accepted the non-notarized app.${output ? `\n${output}` : ""}`
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Gatekeeper unexpectedly accepted")) {
      throw error;
    }
    return outputFromError(error);
  }
};

const fingerprint = (certificate) =>
  new X509Certificate(certificate).fingerprint256.replaceAll(":", "").toUpperCase();

const verifyReleaseIdentity = async (appPath, certificatePath, signatureDetails) => {
  if (signatureDetails.includes("Signature=adhoc")) {
    throw new Error("The Release app unexpectedly fell back to an ad-hoc signature");
  }

  const extractionRoot = await mkdtemp(resolve(tmpdir(), "agentenv-signature-"));
  const certificatePrefix = resolve(extractionRoot, "certificate-");
  try {
    await execFileAsync(
      "/usr/bin/codesign",
      ["--display", "--extract-certificates", certificatePrefix, appPath],
      { encoding: "utf8" }
    );
    const [expectedCertificate, actualCertificate] = await Promise.all([
      readFile(certificatePath),
      readFile(`${certificatePrefix}0`)
    ]);
    const expectedIdentity = new X509Certificate(expectedCertificate);
    const expectedFingerprint = fingerprint(expectedCertificate);
    const actualFingerprint = fingerprint(actualCertificate);
    if (actualFingerprint !== expectedFingerprint) {
      throw new Error(
        `Release signer mismatch: ${actualFingerprint} != ${expectedFingerprint}`
      );
    }

    const requirement = await execFileAsync(
      "/usr/bin/codesign",
      ["--display", "--requirements", "-", appPath],
      { encoding: "utf8" }
    );
    const requirementDetails = [requirement.stdout, requirement.stderr]
      .filter(Boolean)
      .join("\n");
    if (requirementDetails.includes("cdhash")) {
      throw new Error(
        `Release identity is tied to one build instead of the stable certificate:\n${requirementDetails.trim()}`
      );
    }
    if (!requirementDetails.includes('identifier "io.github.chroming.agentenvmanager"')) {
      throw new Error(
        `Release designated requirement is missing the application identifier:\n${requirementDetails.trim()}`
      );
    }
    const expectedCertificateSha1 = expectedIdentity.fingerprint
      .replaceAll(":", "")
      .toUpperCase();
    const normalizedRequirement = requirementDetails.replaceAll(":", "").toUpperCase();
    if (!normalizedRequirement.includes(expectedCertificateSha1)) {
      throw new Error(
        `Release designated requirement is not anchored to the pinned certificate:\n${requirementDetails.trim()}`
      );
    }
    return expectedFingerprint;
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
};

export const verifyMacosSignature = async (appPath, certificatePath) => {
  if (process.platform !== "darwin") {
    throw new Error("macOS signature verification must run on macOS");
  }

  await stat(appPath);
  await execFileAsync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    { encoding: "utf8" }
  );
  const signature = await execFileAsync(
    "/usr/bin/codesign",
    ["--display", "--verbose=4", appPath],
    { encoding: "utf8" }
  );
  const signatureDetails = [signature.stdout, signature.stderr].filter(Boolean).join("\n");
  const releaseFingerprint = certificatePath
    ? await verifyReleaseIdentity(appPath, certificatePath, signatureDetails)
    : undefined;
  if (!certificatePath && !signatureDetails.includes("Signature=adhoc")) {
    throw new Error(
      `Expected an ad-hoc local signature, but codesign reported:\n${signatureDetails.trim()}`
    );
  }

  const gatekeeperDetails = await requireGatekeeperRejection(appPath);
  process.stdout.write(`codesign verification: valid on disk\n`);
  process.stdout.write(
    releaseFingerprint
      ? `signature: stable self-created identity (${releaseFingerprint})\n`
      : `signature: ad-hoc\n`
  );
  process.stdout.write(`Gatekeeper assessment: rejected (expected)\n`);
  if (gatekeeperDetails) process.stdout.write(`${gatekeeperDetails}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseOptions(process.argv.slice(2));
  await verifyMacosSignature(options.appPath, options.certificatePath);
}
