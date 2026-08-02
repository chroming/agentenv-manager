import { execFile } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

if (process.platform !== "darwin") {
  throw new Error("Signed macOS distribution must run on macOS");
}

const { stdout: identities } = await execFileAsync("/usr/bin/security", [
  "find-identity",
  "-v",
  "-p",
  "codesigning"
]);
if (!identities.includes("Developer ID Application")) {
  throw new Error("Install a Developer ID Application certificate in Keychain before release");
}

const hasApiKey = Boolean(
  process.env.APPLE_API_KEY &&
  process.env.APPLE_API_KEY_ID &&
  process.env.APPLE_API_ISSUER
);
const hasAppleId = Boolean(
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
);
const hasKeychainProfile = Boolean(
  process.env.APPLE_KEYCHAIN && process.env.APPLE_KEYCHAIN_PROFILE
);
if (!hasApiKey && !hasAppleId && !hasKeychainProfile) {
  throw new Error(
    "Configure Apple notarization credentials with an API key, Apple ID, or Keychain profile"
  );
}

const releaseDir = join(process.cwd(), "release");
await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });
const releaseStartedAt = Date.now();

await execFileAsync("npm", ["run", "dist:mac"], {
  cwd: process.cwd(),
  env: process.env,
  maxBuffer: 20 * 1024 * 1024
});

const releaseEntries = await readdir(releaseDir, { withFileTypes: true });
const expectedAppDirectory = process.arch === "arm64" ? "mac-arm64" : "mac";
const appDirectory = releaseEntries.find(
  (entry) => entry.isDirectory() && entry.name === expectedAppDirectory
);
if (!appDirectory) {
  throw new Error("Signed application directory was not produced");
}
const appPath = join(releaseDir, appDirectory.name, "AgentEnv Manager.app");
if ((await stat(appPath)).mtimeMs < releaseStartedAt) {
  throw new Error("Signed application is not from the current release run");
}
await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
await execFileAsync("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]);

const dmgs = releaseEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".dmg"));
const zips = releaseEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".zip"));
if (dmgs.length !== 1 || zips.length !== 1) {
  throw new Error("Signed release must produce exactly one DMG and one ZIP");
}
const dmgPath = join(releaseDir, dmgs[0].name);
const zipPath = join(releaseDir, zips[0].name);
for (const artifactPath of [dmgPath, zipPath]) {
  if ((await stat(artifactPath)).mtimeMs < releaseStartedAt) {
    throw new Error("Signed release contains a stale artifact");
  }
}
await execFileAsync("/usr/bin/xcrun", ["stapler", "validate", dmgPath]);
process.stdout.write(`Signed and notarized release verified: ${dmgs[0].name}\n`);
