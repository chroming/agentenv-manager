import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TEMPLATE_PATH = resolve(
  import.meta.dirname,
  "..",
  "packaging",
  "homebrew",
  "Casks",
  "agentenv-manager.rb.template"
);

const requireMacDmg = (manifest, arch) => {
  const asset = manifest.assets.find(
    (candidate) => candidate.platform === "mac" && candidate.arch === arch && candidate.name.endsWith(".dmg")
  );
  if (!asset) throw new Error(`Release manifest is missing the mac ${arch} DMG`);
  const expectedPrefix = `https://github.com/${manifest.repository}/releases/download/${manifest.tag}/`;
  if (!asset.url.startsWith(expectedPrefix)) {
    throw new Error(`mac ${arch} DMG does not use the official exact-tag URL`);
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error(`mac ${arch} DMG SHA-256 is invalid`);
  }
  return asset;
};

export const renderHomebrewCask = (manifest, template) => {
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported release manifest schema");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.tag !== `v${manifest.version}`) {
    throw new Error("Release manifest version and tag do not match");
  }
  const arm64 = requireMacDmg(manifest, "arm64");
  const x64 = requireMacDmg(manifest, "x64");
  const source = template ?? `cask "agentenv-manager" do
  arch arm: "arm64", intel: "x64"

  version "{{VERSION}}"
  sha256 arm:   "{{ARM64_SHA256}}",
         intel: "{{X64_SHA256}}"

  url "https://github.com/{{REPOSITORY}}/releases/download/v#{version}/AgentEnv-Manager-#{version}-mac-#{arch}.dmg"
  name "AgentEnv Manager"
  desc "Manage reusable local AI Agent environments"
  homepage "https://github.com/{{REPOSITORY}}"

  depends_on macos: :monterey

  app "AgentEnv Manager.app"

  postflight do |c|
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", c.appdir/"AgentEnv Manager.app"]
  end
end
`;
  return source
    .replaceAll("{{VERSION}}", manifest.version)
    .replaceAll("{{REPOSITORY}}", manifest.repository)
    .replaceAll("{{ARM64_SHA256}}", arm64.sha256)
    .replaceAll("{{X64_SHA256}}", x64.sha256);
};

const parseArgs = (argv) => {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Cask renderer arguments must use --name value pairs");
    }
    values.set(key.slice(2), value);
  }
  return values;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(args.get("manifest"), "utf8"));
  const template = await readFile(args.get("template") ?? TEMPLATE_PATH, "utf8");
  const output = args.get("output");
  if (!output) throw new Error("Cask output path is required");
  await writeFile(output, renderHomebrewCask(manifest, template), "utf8");
  process.stdout.write(`${output}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
