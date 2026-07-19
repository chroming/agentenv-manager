import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
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

await execFileAsync("npm", ["run", "dist:mac"], {
  cwd: process.cwd(),
  env: process.env,
  maxBuffer: 20 * 1024 * 1024
});

const releaseDir = join(process.cwd(), "release");
const releaseEntries = await readdir(releaseDir, { withFileTypes: true });
const appDirectory = releaseEntries.find(
  (entry) => entry.isDirectory() && entry.name.startsWith("mac")
);
if (!appDirectory) {
  throw new Error("Signed application directory was not produced");
}
const appPath = join(releaseDir, appDirectory.name, "AgentEnv Manager.app");
await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
await execFileAsync("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]);

const dmg = releaseEntries.find((entry) => entry.isFile() && entry.name.endsWith(".dmg"));
if (!dmg) {
  throw new Error("Signed DMG was not produced");
}
await execFileAsync("/usr/bin/xcrun", ["stapler", "validate", join(releaseDir, dmg.name)]);
process.stdout.write(`Signed and notarized release verified: ${dmg.name}\n`);
