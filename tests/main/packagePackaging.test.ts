import { readFile, readdir, stat } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractDesignatedRequirement } from "../../scripts/macos-release-identity.mjs";

const readPngRgba = async (path: string) => {
  const file = await readFile(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  let idat = Buffer.alloc(0);

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const chunk = file.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      expect(chunk[8]).toBe(8);
      expect(chunk[9]).toBe(6);
    }
    if (type === "IDAT") {
      idat = Buffer.concat([idat, chunk]);
    }
    if (type === "IEND") {
      break;
    }
  }

  const raw = inflateSync(idat);
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const rows: Buffer[] = [];
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const scanline = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const row = Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      const paeth = left + up - upperLeft;
      const pa = Math.abs(paeth - left);
      const pb = Math.abs(paeth - up);
      const pc = Math.abs(paeth - upperLeft);
      const paethPredictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      const prior =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : filter === 4
                ? paethPredictor
                : 0;
      row[x] = (scanline[x] + prior) & 0xff;
    }

    rows.push(row);
    previous = row;
  }

  return {
    height,
    pixel: (x: number, y: number) => {
      const index = x * bytesPerPixel;
      const row = rows[y];
      return [row[index], row[index + 1], row[index + 2], row[index + 3]];
    },
    width
  };
};

describe("package metadata", () => {
  it("publishes AgentEnv Manager under GPL-3.0-only consistently", async () => {
    const [packageSource, lockSource, license, readme, readmeEnglish, contributing, notices] =
      await Promise.all([
        readFile(join(process.cwd(), "package.json"), "utf8"),
        readFile(join(process.cwd(), "package-lock.json"), "utf8"),
        readFile(join(process.cwd(), "LICENSE"), "utf8"),
        readFile(join(process.cwd(), "README.md"), "utf8"),
        readFile(join(process.cwd(), "README.en.md"), "utf8"),
        readFile(join(process.cwd(), "CONTRIBUTING.md"), "utf8"),
        readFile(join(process.cwd(), "THIRD_PARTY_NOTICES.md"), "utf8")
      ]);
    const packageJson = JSON.parse(packageSource) as { license?: string };
    const packageLock = JSON.parse(lockSource) as {
      packages?: Record<string, { license?: string }>;
    };

    expect(packageJson.license).toBe("GPL-3.0-only");
    expect(packageLock.packages?.[""]?.license).toBe("GPL-3.0-only");
    expect(license).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(license).toContain("Version 3, 29 June 2007");
    expect(readme).toContain("[GNU General Public License v3.0](LICENSE)");
    expect(readmeEnglish).toContain("[GNU General Public License v3.0](LICENSE)");
    expect(contributing).toContain("GPL-3.0-only");
    expect(notices).toContain("AgentEnv Manager's GPL-3.0-only license");
  });

  it("uses the product name Trae CLI without versioned branding in documentation", async () => {
    const documentation = await Promise.all(
      ["README.md", "README.en.md", "docs/product-contracts.md", "docs/testing-strategy.md"]
        .map((path) => readFile(join(process.cwd(), path), "utf8"))
    );
    const versionedTraeName =
      /Trae CLI[^\n.]{0,100}(?:2\.0|V2|v1\/v2|V2-first|Legacy layout)|Trae V2/iu;

    for (const content of documentation) {
      expect(content).not.toMatch(versionedTraeName);
    }
  });

  it("provides a painted renderer state before React mounts", async () => {
    const rendererHtml = await readFile(
      join(process.cwd(), "src", "renderer", "index.html"),
      "utf8"
    );

    expect(rendererHtml).toContain("data-agentenv-boot");
    expect(rendererHtml).toContain("background: #f6f8fc");
    expect(rendererHtml).toContain("prefers-reduced-motion: reduce");
  });

  it("exposes Electron packaging entrypoints", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as {
      author?: { name?: string; email?: string };
      homepage?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
      build?: {
        appId?: string;
        productName?: string;
        directories?: { output?: string };
        mac?: {
          icon?: string;
          target?: string[];
          identity?: string;
          hardenedRuntime?: boolean;
          notarize?: boolean;
          artifactName?: string;
        };
        win?: { icon?: string; target?: string[]; artifactName?: string };
        nsis?: {
          oneClick?: boolean;
          perMachine?: boolean;
          allowToChangeInstallationDirectory?: boolean;
        };
        linux?: {
          icon?: string;
          target?: string[];
          executableName?: string;
          artifactName?: string;
        };
      };
    };

    expect(packageJson.devDependencies).toHaveProperty("electron-builder");
    expect(packageJson.author).toMatchObject({
      name: "AgentEnv Manager Contributors",
      email: expect.stringMatching(/@/)
    });
    expect(packageJson.homepage).toMatch(/^https:\/\//);
    expect(packageJson.scripts?.["icons:mac"]).toBe(
      "swift scripts/generate-mac-icon.swift"
    );
    expect(packageJson.scripts?.pack).toBe("npm run build && electron-builder --dir");
    expect(packageJson.scripts?.dist).toBe(
      "npm run build && electron-builder --publish never"
    );
    expect(packageJson.scripts?.["dist:mac"]).toBe(
      "npm run icons:mac && npm run build && electron-builder --mac --publish never"
    );
    expect(packageJson.scripts?.["dist:mac:release"]).toBe(
      "node scripts/build-macos-release-assets.mjs"
    );
    expect(packageJson.scripts?.["dist:mac:stable"]).toBe(
      "node scripts/build-macos-stable.mjs"
    );
    expect(packageJson.scripts?.["signing:mac:trust"]).toBe(
      "node scripts/trust-macos-signing-certificate.mjs"
    );
    expect(packageJson.scripts?.["verify:mac-signature"]).toBe(
      "node scripts/verify-macos-signature.mjs"
    );
    expect(packageJson.scripts?.["dist:win"]).toContain("electron-builder --win nsis");
    expect(packageJson.scripts?.["dist:linux"]).toContain(
      "electron-builder --linux AppImage deb"
    );
    for (const script of ["pack", "dist", "dist:mac", "dist:win", "dist:linux"]) {
      expect(packageJson.scripts?.[script]).not.toContain("electronDist");
    }
    for (const script of ["dist", "dist:mac", "dist:win", "dist:linux"]) {
      expect(packageJson.scripts?.[script]).toContain("--publish never");
    }
    expect(packageJson.scripts?.["test:e2e:packaged"]).toBe(
      "npm run pack && node scripts/test-packaged-app.mjs"
    );
    expect(packageJson.build).toMatchObject({
      appId: "io.github.chroming.agentenvmanager",
      productName: "AgentEnv Manager",
      directories: { output: "release" },
      mac: {
        icon: "build/icon.icns",
        identity: "-",
        hardenedRuntime: false,
        notarize: false,
        target: ["dmg", "zip"],
        artifactName: "AgentEnv-Manager-${version}-mac-${arch}.${ext}"
      },
      win: {
        icon: "build/icon.png",
        target: ["nsis"],
        artifactName: "AgentEnv-Manager-${version}-windows-${arch}.${ext}"
      },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true
      },
      linux: {
        icon: "build/icon.png",
        target: ["AppImage", "deb"],
        executableName: "agentenv-manager",
        syncDesktopName: true,
        artifactName: "AgentEnv-Manager-${version}-linux-x64.${ext}"
      }
    });
    expect(packageJson.build?.mac?.identity).toBe("-");
    expect(packageJson.build?.mac?.hardenedRuntime).toBe(false);
    expect(packageJson.build?.mac?.notarize).toBe(false);
    await expect(stat(join(process.cwd(), "build", "icon.icns"))).resolves.toMatchObject({
      size: expect.any(Number)
    });
    await expect(
      stat(join(process.cwd(), "src", "renderer", "assets", "app-icon.png"))
    ).resolves.toMatchObject({
      size: expect.any(Number)
    });
  });

  it("publishes a complete stable-identity release before updating the official Tap", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "release.yml"),
      "utf8"
    );
    const normalizedWorkflow = workflow.replaceAll("\r\n", "\n");

    expect(workflow).toContain('tags:');
    expect(workflow).toContain('macos-15-intel');
    expect(workflow).toContain('macos-15');
    expect(workflow).toContain('windows-2025');
    expect(workflow).toContain('ubuntu-24.04');
    expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    expect(workflow).toContain('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c');
    expect(workflow).toContain('node scripts/release-manifest.mjs');
    expect(workflow).toContain('node scripts/render-homebrew-cask.mjs');
    expect(workflow).toContain('node scripts/verify-macos-signature.mjs');
    expect(workflow).toContain('node scripts/prepare-macos-signing-keychain.mjs');
    expect(workflow).toContain('node scripts/cleanup-macos-signing-keychain.mjs');
    expect(workflow).toContain('node scripts/verify-macos-release-identity.mjs release-assets');
    expect(workflow).toContain('MACOS_SIGNING_P12_BASE64');
    expect(workflow).toContain('MACOS_SIGNING_P12_PASSWORD');
    expect(workflow).toContain('AGENTENV_POSTHOG_HOST');
    expect(workflow).toContain('AGENTENV_POSTHOG_PROJECT_TOKEN');
    expect(workflow).not.toContain('AGENTENV_TELEMETRY_ENDPOINT');
    expect(workflow).toContain('npm run dist:mac:release');
    expect(workflow).toContain('Verify direct-download ad-hoc signature');
    expect(workflow).toContain('AgentEnv-Manager-${version}-mac-arm64-homebrew.dmg');
    expect(workflow).toContain('AgentEnv-Manager-${version}-mac-x64-homebrew.dmg');
    expect(workflow).toContain('--certificate build/macos-signing-certificate.pem');
    expect(workflow).toContain('npm sbom --sbom-format cyclonedx');
    expect(workflow).toContain('SHA256SUMS');
    expect(normalizedWorkflow).toMatch(/publish:\n[\s\S]*?runs-on: macos-15/);
    expect(workflow).toContain('shasum -a 256 AgentEnv-Manager-* > SHA256SUMS');
    expect(workflow).toContain('shasum -a 256 --check SHA256SUMS');
    expect(workflow).not.toContain('sha256sum');
    expect(workflow).toContain('gh release create "$RELEASE_TAG" --draft');
    expect(workflow).toContain('docs/releases/${RELEASE_TAG}.md');
    expect(workflow).toContain('--notes-file "docs/releases/${RELEASE_TAG}.md"');
    expect(workflow).not.toContain('--generate-notes');
    expect(workflow).toContain('gh release edit "$RELEASE_TAG" --draft=false');
    expect(workflow).toContain('HOMEBREW_TAP_DEPLOY_KEY');
    expect(workflow).toContain('brew tap-new --no-git agentenv-ci/release');
    expect(workflow).toContain('brew style --cask agentenv-ci/release/agentenv-manager');
    expect(workflow).not.toContain('HOMEBREW_TAP_TOKEN');
    expect(workflow).toContain('github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl');
    expect(workflow).toContain('StrictHostKeyChecking=yes');
    expect(workflow).toContain('git@github.com:chroming/homebrew-tap.git');
    expect(workflow).toContain('chroming/homebrew-tap');
    expect(workflow).not.toContain('Developer ID');
    expect(workflow).not.toContain('notar');
    expect(workflow).not.toContain('Developer ID Application');
  });

  it("pins the macOS Release signer while requiring Gatekeeper rejection", async () => {
    const [script, releaseBuildScript, localBuildScript, trustScript, cleanupScript, certificate] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "verify-macos-signature.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "build-macos-release-assets.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "build-macos-stable.mjs"), "utf8"),
      readFile(
        join(process.cwd(), "scripts", "trust-macos-signing-certificate.mjs"),
        "utf8"
      ),
      readFile(
        join(process.cwd(), "scripts", "cleanup-macos-signing-keychain.mjs"),
        "utf8"
      ),
      readFile(join(process.cwd(), "build", "macos-signing-certificate.pem"))
    ]);
    const releaseCertificate = new X509Certificate(certificate);

    expect(script).toContain('"/usr/bin/codesign"');
    expect(script).toContain('"--verify"');
    expect(script).toContain('"--deep"');
    expect(script).toContain('"--strict"');
    expect(script).toContain("Signature=adhoc");
    expect(script).toContain('`--extract-certificates=${certificatePrefix}`');
    expect(script).toContain('requirementDetails.includes("cdhash")');
    expect(script).toContain('identifier "io.github.chroming.agentenvmanager"');
    expect(script).toContain("expectedIdentity.fingerprint");
    expect(script).toContain('"/usr/sbin/spctl"');
    expect(script).toContain('"--assess"');
    expect(script).toContain("Gatekeeper unexpectedly accepted");
    expect(releaseBuildScript).toContain('"--config.mac.identity=-"');
    expect(releaseBuildScript).toContain("-homebrew.${ext}");
    expect(releaseBuildScript).toContain("AGENTENV_MACOS_SIGNING_IDENTITY");
    expect(localBuildScript).toContain("AGENTENV_MACOS_SIGNING_KEYCHAIN");
    expect(localBuildScript).toContain("agentenv-release-signing.keychain-db");
    expect(localBuildScript).toContain("agentenv-release-signing.password");
    expect(localBuildScript).toContain("dist:mac:release");
    expect(localBuildScript).toContain("--certificate");
    expect(localBuildScript).not.toContain("identity: null");
    expect(trustScript).toContain('"add-trusted-cert"');
    expect(trustScript).toContain('"codeSign"');
    expect(cleanupScript).toContain('"delete-keychain"');
    expect(cleanupScript).not.toContain("remove-trusted-cert");
    expect(releaseCertificate.subject).toContain("AgentEnv Manager Release Signing");
    expect(releaseCertificate.issuer).toBe(releaseCertificate.subject);
    expect(releaseCertificate.ca).toBe(true);
    expect(releaseCertificate.keyUsage).toContain("1.3.6.1.5.5.7.3.3");

    const pairVerifier = await readFile(
      join(process.cwd(), "scripts", "verify-macos-release-identity.mjs"),
      "utf8"
    );
    expect(pairVerifier).toContain("arm64.cdHash === x64.cdHash");
    expect(pairVerifier).toContain('`--extract-certificates=${certificatePrefix}`');
    expect(pairVerifier).toContain("arm64.requirement !== x64.requirement");
    expect(pairVerifier).toContain('arm64.requirement.includes("cdhash")');
  });

  it("compares macOS designated requirements without architecture-specific paths", () => {
    const requirement =
      'designated => identifier "io.github.chroming.agentenvmanager" and certificate root = H"abc123"';

    expect(extractDesignatedRequirement(
      `Executable=/tmp/release/arm64/AgentEnv Manager.app/Contents/MacOS/AgentEnv Manager\n${requirement}\n`,
      "arm64.zip"
    )).toBe(requirement);
    expect(extractDesignatedRequirement(
      `Executable=/tmp/release/x64/AgentEnv Manager.app/Contents/MacOS/AgentEnv Manager\n${requirement}\n`,
      "x64.zip"
    )).toBe(requirement);
    expect(() => extractDesignatedRequirement("Executable=/tmp/app", "broken.zip"))
      .toThrowError(/could not read designated requirement from broken\.zip/i);
  });

  it("bounds filesystem-heavy test concurrency on high-core hosts", async () => {
    const [packageJsonSource, productGate, groupedTests, scheduler] = await Promise.all([
      readFile(join(process.cwd(), "package.json"), "utf8"),
      readFile(join(process.cwd(), "scripts", "verify-product.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "run-vitest-groups.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "electron-test-scheduler.mjs"), "utf8")
    ]);

    expect(productGate).toContain("scripts/run-vitest-groups.mjs");
    expect(groupedTests).toContain('"--maxWorkers=4"');
    expect(scheduler).toContain("AGENTENV_ELECTRON_WORKERS");
    expect(scheduler).toContain("assertExactTestCoverage");
    for (const script of ["test:quick", "test:feature", "test:full", "verify:commit"]) {
      expect(packageJsonSource).toContain(`"${script}"`);
    }
  });

  it("schedules every Electron E2E outside the parallel test pool", async () => {
    const e2eRoot = join(process.cwd(), "tests", "e2e");
    const schedulerConfig = await readFile(
      join(process.cwd(), "scripts", "vitest-groups.mjs"),
      "utf8"
    );
    const configuredElectronTests = [...new Set(
      [...schedulerConfig.matchAll(/"(tests\/e2e\/[^\"]+\.e2e\.test\.ts)"/g)]
        .map((match) => match[1])
    )];
    const electronTests: string[] = [];
    for (const file of await readdir(e2eRoot)) {
      if (!file.endsWith(".e2e.test.ts")) continue;
      const source = await readFile(join(e2eRoot, file), "utf8");
      if (source.includes('from "electron"') || source.includes("_electron as electron")) {
        electronTests.push(`tests/e2e/${file}`);
      }
    }

    expect(configuredElectronTests.sort()).toEqual(electronTests.sort());
  });

  it("bounds and identifies packaged desktop workflow stages", async () => {
    const script = await readFile(
      join(process.cwd(), "scripts", "test-packaged-app.mjs"),
      "utf8"
    );

    expect(script).toContain("const packagedStepTimeoutMs = 90_000");
    expect(script).toContain("[packaged-e2e] START");
    expect(script).toContain("[packaged-e2e] PASS");
    expect(script).toContain("[packaged-e2e] FAIL");
    expect(script).toContain("workflow exceeded 240000 ms");
    expect(script).toContain('process.platform === "win32"');
    expect(script).toContain("process.exit(0)");
    expect(script).toContain("page.setDefaultTimeout(30_000)");
    expect(script).toContain('process.platform !== "win32"');
    expect(script).toContain('"open Skills workspace"');
    expect(script).toContain("enabledTargetIds: packagedTargets.map");
    expect(script).toContain('"scan repository Skill through packaged preload"');
    expect(script).toContain('"import repository Skill through packaged preload"');
    expect(script).toContain("apply ${target.name}");
  });

  it("scans complete public history for secrets", async () => {
    const workflow = await readFile(
      join(process.cwd(), ".github", "workflows", "ci.yml"),
      "utf8"
    );

    expect(workflow).toContain("secret-scan:");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("--config=/repo/.gitleaks.toml");
    expect(workflow).toContain("--log-opts=--all");
  });

  it("keeps strict local pixels while bounding hosted macOS drift", async () => {
    const [workflow, contract, comparator] = await Promise.all([
      readFile(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8"),
      readFile(join(process.cwd(), "tests", "visual", "critical-captures.json"), "utf8"),
      readFile(join(process.cwd(), "scripts", "compare-ui-captures.swift"), "utf8")
    ]);

    expect(workflow).toContain('AGENTENV_VISUAL_HOST_DRIFT_LIMIT: "0.05"');
    expect(JSON.parse(contract)).toMatchObject({ maxChangedPixelRatio: 0.012 });
    expect(comparator).toContain('(0...0.05).contains(parsed)');
  });

  it("keeps the macOS icon corners transparent", async () => {
    const icon = await readPngRgba(join(process.cwd(), "build", "icon.png"));
    const cornerPixels = [
      icon.pixel(0, 0),
      icon.pixel(icon.width - 1, 0),
      icon.pixel(0, icon.height - 1),
      icon.pixel(icon.width - 1, icon.height - 1)
    ];

    for (const [, , , alpha] of cornerPixels) {
      expect(alpha).toBe(0);
    }
    expect(icon.pixel(Math.floor(icon.width / 2), Math.floor(icon.height / 2))[3]).toBe(255);
  });
});
