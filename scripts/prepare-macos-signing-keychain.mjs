import { execFile } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const identityName = "AgentEnv Manager Release Signing";
const certificatePath = resolve("build", "macos-signing-certificate.pem");

const requireEnvironment = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the macOS Release build`);
  return value;
};

const run = async (file, args) => {
  try {
    return await execFileAsync(file, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new Error(`${file.split("/").at(-1)} failed${stderr ? `: ${stderr}` : ""}`);
  }
};

const certificateFingerprint = (input) =>
  new X509Certificate(input).fingerprint256.replaceAll(":", "").toUpperCase();

const appendEnvironment = async (values) => {
  const githubEnvironment = requireEnvironment("GITHUB_ENV");
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  await writeFile(githubEnvironment, `${lines}\n`, { flag: "a" });
};

if (process.platform !== "darwin") {
  throw new Error("The macOS signing identity can only be prepared on macOS");
}

const runnerTemp = requireEnvironment("RUNNER_TEMP");
const p12Base64 = requireEnvironment("MACOS_SIGNING_P12_BASE64");
const p12Password = requireEnvironment("MACOS_SIGNING_P12_PASSWORD");
const keychainPath = join(runnerTemp, "agentenv-release-signing.keychain-db");
const p12Path = join(runnerTemp, "agentenv-release-signing.p12");
const exportedCertificatePath = join(runnerTemp, "agentenv-release-signing.pem");
const keychainPassword = randomBytes(32).toString("base64url");

await mkdir(runnerTemp, { recursive: true });
await Promise.all([
  rm(keychainPath, { force: true }),
  rm(p12Path, { force: true }),
  rm(exportedCertificatePath, { force: true })
]);
await writeFile(p12Path, Buffer.from(p12Base64, "base64"), { mode: 0o600 });

await run("/usr/bin/security", ["create-keychain", "-p", keychainPassword, keychainPath]);
await run("/usr/bin/security", ["set-keychain-settings", "-lut", "21600", keychainPath]);
await run("/usr/bin/security", ["unlock-keychain", "-p", keychainPassword, keychainPath]);
await run("/usr/bin/security", [
  "import",
  p12Path,
  "-k",
  keychainPath,
  "-P",
  p12Password,
  "-T",
  "/usr/bin/codesign"
]);
await run("/usr/bin/security", [
  "set-key-partition-list",
  "-S",
  "apple-tool:,apple:,codesign:",
  "-s",
  "-k",
  keychainPassword,
  keychainPath
]);

const searchList = await run("/usr/bin/security", ["list-keychains", "-d", "user"]);
const existingKeychains = [...searchList.stdout.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
await run("/usr/bin/security", [
  "list-keychains",
  "-d",
  "user",
  "-s",
  keychainPath,
  ...existingKeychains.filter((path) => path !== keychainPath)
]);

const importedCertificate = await run("/usr/bin/security", [
  "find-certificate",
  "-c",
  identityName,
  "-p",
  keychainPath
]);
await writeFile(exportedCertificatePath, importedCertificate.stdout, { mode: 0o644 });

const [expectedCertificate, actualCertificate] = await Promise.all([
  readFile(certificatePath),
  readFile(exportedCertificatePath)
]);
const expectedFingerprint = certificateFingerprint(expectedCertificate);
const actualFingerprint = certificateFingerprint(actualCertificate);
if (actualFingerprint !== expectedFingerprint) {
  throw new Error(
    `The imported signing identity does not match ${certificatePath}: ` +
      `${actualFingerprint} != ${expectedFingerprint}`
  );
}

// codesign only treats a self-created identity as valid after the build host trusts its root.
// GitHub's hosted macOS runners allow this non-interactively and are discarded after the job.
await run("/usr/bin/sudo", [
  "-n",
  "/usr/bin/security",
  "add-trusted-cert",
  "-d",
  "-r",
  "trustRoot",
  "-p",
  "codeSign",
  "-k",
  "/Library/Keychains/System.keychain",
  exportedCertificatePath
]);

const identities = await run("/usr/bin/security", [
  "find-identity",
  "-v",
  "-p",
  "codesigning",
  keychainPath
]);
if (!identities.stdout.includes(identityName)) {
  throw new Error(`The Release signing identity is not valid:\n${identities.stdout.trim()}`);
}

await appendEnvironment({
  AGENTENV_MACOS_SIGNING_CERTIFICATE: certificatePath,
  AGENTENV_MACOS_SIGNING_IDENTITY: identityName,
  AGENTENV_MACOS_SIGNING_KEYCHAIN: keychainPath
});

process.stdout.write(`macOS Release signing identity: ${identityName}\n`);
process.stdout.write(`certificate SHA-256: ${expectedFingerprint}\n`);
