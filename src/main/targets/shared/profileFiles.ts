import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AssetPolicySchema, type AssetPolicy, type ProfileManifest } from "../../../shared/schemas";
import type { ProfileDetail } from "../../../shared/types";

interface ProfileFileDriverOptions {
  instructionsFile: string;
  configFile: string;
  readConfigText?: (profileDir: string) => Promise<string>;
  readAssetPolicy?: (profileDir: string) => Promise<AssetPolicy>;
}

export const createProfileFileDriver = ({
  instructionsFile,
  configFile,
  readConfigText = (profileDir) => readFile(join(profileDir, configFile), "utf8"),
  readAssetPolicy = async (profileDir) =>
    AssetPolicySchema.parse(
      JSON.parse(await readFile(join(profileDir, "assets.json"), "utf8"))
    )
}: ProfileFileDriverOptions) => ({
  readProfileFiles: async (
    profileDir: string,
    manifest: ProfileManifest
  ): Promise<ProfileDetail> => {
    const [instructions, configText, assetPolicy] = await Promise.all([
      readFile(join(profileDir, instructionsFile), "utf8"),
      readConfigText(profileDir),
      readAssetPolicy(profileDir)
    ]);
    return {
      id: manifest.id,
      profileDir,
      manifest,
      instructions,
      configText,
      assetPolicy
    };
  },
  writeProfileFiles: async (profileDir: string, profile: ProfileDetail): Promise<void> => {
    await mkdir(profileDir, { recursive: true });
    await Promise.all([
      writeFile(join(profileDir, instructionsFile), profile.instructions, "utf8"),
      writeFile(join(profileDir, configFile), profile.configText, "utf8"),
      writeFile(
        join(profileDir, "assets.json"),
        `${JSON.stringify(AssetPolicySchema.parse(profile.assetPolicy), null, 2)}\n`,
        "utf8"
      )
    ]);
  }
});
