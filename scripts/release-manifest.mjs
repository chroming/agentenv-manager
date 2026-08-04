import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ASSET_PATTERN = /^AgentEnv-Manager-(\d+\.\d+\.\d+)-(mac|windows|linux)-(arm64|x64)(-homebrew)?\.(dmg|zip|exe|AppImage|deb)$/;

export const validateReleaseVersion = (tag, packageVersion) => {
  const match = TAG_PATTERN.exec(tag);
  if (!match) throw new Error("Release tags must use vMAJOR.MINOR.PATCH");
  if (tag.slice(1) !== packageVersion) {
    throw new Error(`Release tag ${tag} does not match package version ${packageVersion}`);
  }
  return packageVersion;
};

const sha256File = async (path) =>
  createHash("sha256").update(await readFile(path)).digest("hex");

const identityForAsset = (name, version) => {
  const match = ASSET_PATTERN.exec(name);
  if (!match || match[1] !== version) {
    throw new Error(`Release asset name is invalid for ${version}: ${name}`);
  }
  if (match[4] && (match[2] !== "mac" || match[5] !== "dmg")) {
    throw new Error(`Homebrew release assets must be macOS DMGs: ${name}`);
  }
  return {
    platform: match[2],
    arch: match[3],
    channel: match[4] ? "homebrew" : "direct"
  };
};

export const createReleaseManifest = async ({
  releaseDir,
  repository,
  tag,
  version,
  buildFingerprint,
  assetNames,
  now = () => new Date()
}) => {
  validateReleaseVersion(tag, version);
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) {
    throw new Error("Release repository must use owner/name");
  }
  if (!buildFingerprint) throw new Error("Release build fingerprint is required");
  const root = resolve(releaseDir);
  const assets = [];
  for (const requestedName of [...new Set(assetNames)].sort()) {
    if (basename(requestedName) !== requestedName) {
      throw new Error(`Release asset must be a file name: ${requestedName}`);
    }
    const identity = identityForAsset(requestedName, version);
    const path = join(root, requestedName);
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error(`Release asset is missing or empty: ${requestedName}`);
    }
    assets.push({
      name: requestedName,
      ...identity,
      size: metadata.size,
      sha256: await sha256File(path),
      url: `https://github.com/${repository}/releases/download/${tag}/${requestedName}`
    });
  }
  if (assets.length === 0) throw new Error("Release manifest requires at least one asset");
  return {
    schemaVersion: 1,
    repository,
    tag,
    version,
    buildFingerprint,
    generatedAt: now().toISOString(),
    assets
  };
};

const parseArgs = (argv) => {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Release manifest arguments must use --name value pairs");
    }
    values.set(key.slice(2), value);
  }
  return values;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const releaseDir = args.get("release-dir") ?? "release";
  const packagePath = args.get("package") ?? "package.json";
  const packageData = JSON.parse(await readFile(packagePath, "utf8"));
  const fingerprintPath = args.get("fingerprint") ?? "out/.agentenv-build.json";
  const fingerprint = JSON.parse(await readFile(fingerprintPath, "utf8"));
  const assetNames = (args.get("assets") ?? "").split(",").filter(Boolean);
  const manifest = await createReleaseManifest({
    releaseDir,
    repository: args.get("repository") ?? "chroming/agentenv-manager",
    tag: args.get("tag") ?? "",
    version: packageData.version,
    buildFingerprint: fingerprint.source?.sha256,
    assetNames
  });
  const output = args.get("output") ?? join(releaseDir, "release-manifest.json");
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${output}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
