import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createReleaseManifest,
  validateReleaseVersion
} from "../../scripts/release-manifest.mjs";
import { renderHomebrewCask } from "../../scripts/render-homebrew-cask.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release packaging", () => {
  it("requires the release tag to match package.json exactly", () => {
    expect(() => validateReleaseVersion("v0.2.0", "0.2.0")).not.toThrow();
    expect(() => validateReleaseVersion("v0.2.1", "0.2.0")).toThrow(
      "Release tag v0.2.1 does not match package version 0.2.0"
    );
    expect(() => validateReleaseVersion("latest", "0.2.0")).toThrow(
      "Release tags must use vMAJOR.MINOR.PATCH"
    );
  });

  it("reserves the Homebrew channel suffix for macOS disk images", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentenv-release-channel-"));
    roots.push(root);
    const invalidName = "AgentEnv-Manager-0.2.0-linux-x64-homebrew.AppImage";
    await writeFile(join(root, invalidName), "invalid package", "utf8");

    await expect(createReleaseManifest({
      releaseDir: root,
      repository: "chroming/agentenv-manager",
      tag: "v0.2.0",
      version: "0.2.0",
      buildFingerprint: "build-123",
      assetNames: [invalidName]
    })).rejects.toThrow("Homebrew release assets must be macOS DMGs");
  });

  it("records immutable asset identity and content digests", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentenv-release-"));
    roots.push(root);
    const armName = "AgentEnv-Manager-0.2.0-mac-arm64.dmg";
    const intelName = "AgentEnv-Manager-0.2.0-mac-x64.dmg";
    const homebrewName = "AgentEnv-Manager-0.2.0-mac-arm64-homebrew.dmg";
    await writeFile(join(root, armName), "arm package", "utf8");
    await writeFile(join(root, intelName), "intel package", "utf8");
    await writeFile(join(root, homebrewName), "homebrew package", "utf8");

    const manifest = await createReleaseManifest({
      releaseDir: root,
      repository: "chroming/agentenv-manager",
      tag: "v0.2.0",
      version: "0.2.0",
      buildFingerprint: "build-123",
      assetNames: [armName, intelName, homebrewName]
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      repository: "chroming/agentenv-manager",
      tag: "v0.2.0",
      version: "0.2.0",
      buildFingerprint: "build-123"
    });
    expect(manifest.assets).toHaveLength(3);
    expect(manifest.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: armName,
        platform: "mac",
        arch: "arm64",
        channel: "direct",
        size: 11,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        url: `https://github.com/chroming/agentenv-manager/releases/download/v0.2.0/${armName}`
      }),
      expect.objectContaining({
        name: intelName,
        platform: "mac",
        arch: "x64",
        channel: "direct",
        size: 13,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      }),
      expect.objectContaining({
        name: homebrewName,
        platform: "mac",
        arch: "arm64",
        channel: "homebrew",
        size: 16,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    ]));
    expect(new Set(manifest.assets.map((asset) => asset.sha256)).size).toBe(3);
  });

  it("renders a checksum-bound Cask that clears quarantine after installation", async () => {
    const manifest = {
      schemaVersion: 1 as const,
      repository: "chroming/agentenv-manager",
      tag: "v0.2.0",
      version: "0.2.0",
      buildFingerprint: "build-123",
      generatedAt: "2026-08-03T00:00:00.000Z",
      assets: [
        {
          name: "AgentEnv-Manager-0.2.0-mac-arm64-homebrew.dmg",
          platform: "mac" as const,
          arch: "arm64" as const,
          channel: "homebrew" as const,
          size: 11,
          sha256: "a".repeat(64),
          url: "https://github.com/chroming/agentenv-manager/releases/download/v0.2.0/AgentEnv-Manager-0.2.0-mac-arm64-homebrew.dmg"
        },
        {
          name: "AgentEnv-Manager-0.2.0-mac-x64-homebrew.dmg",
          platform: "mac" as const,
          arch: "x64" as const,
          channel: "homebrew" as const,
          size: 13,
          sha256: "b".repeat(64),
          url: "https://github.com/chroming/agentenv-manager/releases/download/v0.2.0/AgentEnv-Manager-0.2.0-mac-x64-homebrew.dmg"
        }
      ]
    };

    const cask = renderHomebrewCask(manifest);

    expect(cask).toContain('cask "agentenv-manager" do');
    expect(cask).toContain('version "0.2.0"');
    expect(cask).toContain(`sha256 arm:   "${"a".repeat(64)}",`);
    expect(cask).toContain(`intel: "${"b".repeat(64)}"`);
    expect(cask).not.toContain("on_arm do");
    expect(cask).not.toContain("on_intel do");
    expect(cask).toContain("releases/download/v#{version}");
    expect(cask).toContain("mac-#{arch}-homebrew.dmg");
    expect(cask).toContain("depends_on macos: :monterey");
    expect(cask).toContain('app "AgentEnv Manager.app"');
    expect(cask).toContain('c.appdir/"AgentEnv Manager.app"');
    expect(cask).toContain('"com.apple.quarantine"');
    expect(cask).not.toContain("sha256 :no_check");
    expect(cask).not.toContain("version :latest");
  });

  it("writes generated release files without mutating the source template", async () => {
    const template = await readFile(
      join(process.cwd(), "packaging", "homebrew", "Casks", "agentenv-manager.rb.template"),
      "utf8"
    );
    expect(template).toContain("{{VERSION}}");
    expect(template).toContain("{{ARM64_SHA256}}");
    expect(template).toContain("{{X64_SHA256}}");
  });
});
