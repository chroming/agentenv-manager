import { spawn } from "node:child_process";
import { resolve } from "node:path";

const run = (file, args, env = process.env) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(file, args, { env, stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${file} exited with ${signal ?? code}`));
    });
  });

if (process.platform !== "darwin") {
  throw new Error("macOS Release assets can only be built on macOS");
}

const stableIdentity = process.env.AGENTENV_MACOS_SIGNING_IDENTITY?.trim();
if (!stableIdentity) {
  throw new Error("AGENTENV_MACOS_SIGNING_IDENTITY is required for macOS Release assets");
}

const builder = resolve("node_modules", ".bin", "electron-builder");
await run("npm", ["run", "icons:mac"]);
await run("npm", ["run", "build"]);

// Every distributed App uses the same pinned identity so macOS can preserve
// Keychain and privacy grants across reinstallations. Direct downloads still
// retain quarantine and remain non-notarized; identity stability does not
// bypass Gatekeeper.
await run(builder, [
  "--mac",
  "dmg",
  "zip",
  "--publish",
  "never",
  `--config.mac.identity=${stableIdentity}`
]);

// Homebrew removes quarantine only after checksum verification. Its separately
// named DMG contains the same signed App as the direct-download channel.
await run(builder, [
  "--mac",
  "dmg",
  "--publish",
  "never",
  "--config.directories.output=release/homebrew",
  `--config.mac.identity=${stableIdentity}`,
  "--config.mac.artifactName=AgentEnv-Manager-${version}-mac-${arch}-homebrew.${ext}"
]);
