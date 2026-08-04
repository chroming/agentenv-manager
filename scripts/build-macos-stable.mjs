import { execFile, spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { homedir } from "node:os";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const identityName = "AgentEnv Manager Release Signing";
const signingRoot = resolve(
  process.env.AGENTENV_MACOS_SIGNING_HOME ??
    join(homedir(), ".config", "agentenv-manager", "release-signing")
);
const keychainPath = resolve(
  process.env.AGENTENV_MACOS_SIGNING_KEYCHAIN ??
    join(signingRoot, "agentenv-release-signing.keychain-db")
);
const passwordPath = resolve(
  process.env.AGENTENV_MACOS_SIGNING_PASSWORD_FILE ??
    join(signingRoot, "agentenv-release-signing.password")
);
const certificatePath = resolve("build", "macos-signing-certificate.pem");

const run = async (file, args, options = {}) => {
  try {
    return await execFileAsync(file, args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      ...options
    });
  } catch (error) {
    const details = [error?.stdout, error?.stderr]
      .filter((value) => typeof value === "string" && value.trim())
      .join("\n")
      .trim();
    throw new Error(`${file.split("/").at(-1)} failed${details ? `:\n${details}` : ""}`);
  }
};

const runInteractive = (file, args, env) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${file} exited with ${signal ?? code}`));
    });
  });

const fingerprint = (certificate) =>
  new X509Certificate(certificate).fingerprint256.replaceAll(":", "").toUpperCase();

if (process.platform !== "darwin") {
  throw new Error("Stable macOS packaging can only run on macOS");
}

const [keychainStats, passwordStats, password, expectedCertificate] = await Promise.all([
  stat(keychainPath),
  stat(passwordPath),
  readFile(passwordPath, "utf8"),
  readFile(certificatePath)
]).catch((error) => {
  throw new Error(
    `The persistent signing identity is not installed in ${signingRoot}. ` +
      `Run the one-time local signing setup first.\n${error instanceof Error ? error.message : error}`
  );
});

if (!keychainStats.isFile() || !passwordStats.isFile()) {
  throw new Error(`Invalid persistent signing files in ${signingRoot}`);
}
if ((passwordStats.mode & 0o077) !== 0) {
  throw new Error(`${passwordPath} must only be readable by its owner (chmod 600)`);
}

const keychainPassword = password.trim();
if (!keychainPassword) throw new Error(`${passwordPath} is empty`);

const searchList = await run("/usr/bin/security", ["list-keychains", "-d", "user"]);
const originalKeychains = [...searchList.stdout.matchAll(/"([^"]+)"/g)].map(
  (match) => match[1]
);

try {
  await run("/usr/bin/security", [
    "unlock-keychain",
    "-p",
    keychainPassword,
    keychainPath
  ]);
  await run("/usr/bin/security", [
    "set-keychain-settings",
    "-lut",
    "21600",
    keychainPath
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
  await run("/usr/bin/security", [
    "list-keychains",
    "-d",
    "user",
    "-s",
    keychainPath,
    ...originalKeychains.filter((path) => path !== keychainPath)
  ]);

  const importedCertificate = await run("/usr/bin/security", [
    "find-certificate",
    "-c",
    identityName,
    "-p",
    keychainPath
  ]);
  const expectedFingerprint = fingerprint(expectedCertificate);
  const actualFingerprint = fingerprint(importedCertificate.stdout);
  if (actualFingerprint !== expectedFingerprint) {
    throw new Error(
      `Persistent signing certificate mismatch: ${actualFingerprint} != ${expectedFingerprint}`
    );
  }

  const identities = await run("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    keychainPath
  ]);
  if (!identities.stdout.includes(identityName)) {
    throw new Error(
      "The persistent signing certificate is not trusted for code signing. " +
        "Complete the one-time macOS trust prompt, then retry."
    );
  }

  process.stdout.write(`Using stable macOS identity: ${identityName}\n`);
  process.stdout.write(`certificate SHA-256: ${expectedFingerprint}\n`);
  await runInteractive("npm", ["run", "dist:mac:release"], {
    ...process.env,
    AGENTENV_MACOS_SIGNING_IDENTITY: identityName,
    AGENTENV_MACOS_SIGNING_KEYCHAIN: keychainPath,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    CSC_KEYCHAIN: keychainPath
  });
  await runInteractive(
    process.execPath,
    ["scripts/verify-macos-signature.mjs"],
    process.env
  );
  await runInteractive(
    process.execPath,
    [
      "scripts/verify-macos-signature.mjs",
      "--app",
      resolve(
        "release",
        "homebrew",
        process.arch === "arm64" ? "mac-arm64" : "mac",
        "AgentEnv Manager.app"
      ),
      "--certificate",
      certificatePath
    ],
    process.env
  );
} finally {
  await run("/usr/bin/security", [
    "list-keychains",
    "-d",
    "user",
    "-s",
    ...originalKeychains
  ]).catch(() => undefined);
}
