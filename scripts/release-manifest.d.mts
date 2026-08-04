export interface ReleaseManifestAsset {
  name: string;
  platform: "mac" | "windows" | "linux";
  arch: "arm64" | "x64";
  channel: "direct" | "homebrew";
  size: number;
  sha256: string;
  url: string;
}

export interface ReleaseManifest {
  schemaVersion: 1;
  repository: string;
  tag: string;
  version: string;
  buildFingerprint: string;
  generatedAt: string;
  assets: ReleaseManifestAsset[];
}

export function validateReleaseVersion(tag: string, version: string): void;
export function createReleaseManifest(input: {
  releaseDir: string;
  repository: string;
  tag: string;
  version: string;
  buildFingerprint: string;
  assetNames: string[];
}): Promise<ReleaseManifest>;
