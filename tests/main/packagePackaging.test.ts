import { readFile, stat } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

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
    expect(packageJson.scripts?.["dist:mac:release"]).toContain(
      '--config.mac.identity="$AGENTENV_MACOS_SIGNING_IDENTITY"'
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
    expect(workflow).toContain('npm run dist:mac:release');
    expect(workflow).toContain('--certificate build/macos-signing-certificate.pem');
    expect(workflow).toContain('npm sbom --sbom-format cyclonedx');
    expect(workflow).toContain('SHA256SUMS');
    expect(normalizedWorkflow).toMatch(/publish:\n[\s\S]*?runs-on: macos-15/);
    expect(workflow).toContain('shasum -a 256 AgentEnv-Manager-* > SHA256SUMS');
    expect(workflow).toContain('shasum -a 256 --check SHA256SUMS');
    expect(workflow).not.toContain('sha256sum');
    expect(workflow).toContain('gh release create "$RELEASE_TAG" --draft');
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
    const [script, localBuildScript, trustScript, certificate] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "verify-macos-signature.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "build-macos-stable.mjs"), "utf8"),
      readFile(
        join(process.cwd(), "scripts", "trust-macos-signing-certificate.mjs"),
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
    expect(script).toContain('"--extract-certificates"');
    expect(script).toContain('requirementDetails.includes("cdhash")');
    expect(script).toContain('identifier "io.github.chroming.agentenvmanager"');
    expect(script).toContain("expectedIdentity.fingerprint");
    expect(script).toContain('"/usr/sbin/spctl"');
    expect(script).toContain('"--assess"');
    expect(script).toContain("Gatekeeper unexpectedly accepted");
    expect(localBuildScript).toContain("AGENTENV_MACOS_SIGNING_KEYCHAIN");
    expect(localBuildScript).toContain("agentenv-release-signing.keychain-db");
    expect(localBuildScript).toContain("agentenv-release-signing.password");
    expect(localBuildScript).toContain("dist:mac:release");
    expect(localBuildScript).toContain("--certificate");
    expect(localBuildScript).not.toContain("identity: null");
    expect(trustScript).toContain('"add-trusted-cert"');
    expect(trustScript).toContain('"codeSign"');
    expect(releaseCertificate.subject).toContain("AgentEnv Manager Release Signing");
    expect(releaseCertificate.issuer).toBe(releaseCertificate.subject);
    expect(releaseCertificate.ca).toBe(true);
    expect(releaseCertificate.keyUsage).toContain("1.3.6.1.5.5.7.3.3");

    const pairVerifier = await readFile(
      join(process.cwd(), "scripts", "verify-macos-release-identity.mjs"),
      "utf8"
    );
    expect(pairVerifier).toContain("arm64.cdHash === x64.cdHash");
    expect(pairVerifier).toContain("arm64.requirement !== x64.requirement");
    expect(pairVerifier).toContain('arm64.requirement.includes("cdhash")');
  });

  it("bounds filesystem-heavy test concurrency on high-core hosts", async () => {
    const [productGate, groupedTests] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "verify-product.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "run-vitest-groups.mjs"), "utf8")
    ]);

    expect(productGate).toContain('"--maxWorkers=4"');
    expect(groupedTests).toContain('"--maxWorkers=4"');
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
