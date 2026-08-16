import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMacApplicationDiscovery } from "../../../src/main/targets/macApplicationDiscovery";

let root = "";

afterEach(async () => {
  if (!root) return;
  await rm(root, { recursive: true, force: true });
  root = "";
});

describe("macOS application discovery", () => {
  it.skipIf(process.platform === "win32")(
    "accepts an executable runtime only after its bounded version probe succeeds",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-mac-runtime-"));
      const executablePath = join(root, "codex");
      await writeFile(executablePath, "#!/bin/sh\necho 'codex-cli fixture'\n", "utf8");
      await chmod(executablePath, 0o755);

      await expect(
        createMacApplicationDiscovery().probeExecutable(executablePath)
      ).resolves.toEqual({
        status: "found",
        version: "codex-cli fixture"
      });
    }
  );

  it("reports a missing bundled runtime without throwing", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mac-runtime-"));

    await expect(
      createMacApplicationDiscovery().probeExecutable(join(root, "missing-codex"))
    ).resolves.toEqual({ status: "missing" });
  });

  it.skipIf(process.platform !== "darwin")(
    "reads the bundle identity from an application plist",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-mac-bundle-"));
      const applicationPath = join(root, "ChatGPT.app");
      await mkdir(join(applicationPath, "Contents"), { recursive: true });
      await writeFile(join(applicationPath, "Contents", "Info.plist"), [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        '<key>CFBundleIdentifier</key><string>com.openai.codex</string>',
        '</dict></plist>',
        ''
      ].join("\n"), "utf8");

      await expect(
        createMacApplicationDiscovery().readBundleIdentifier(applicationPath)
      ).resolves.toBe("com.openai.codex");
    }
  );
});
