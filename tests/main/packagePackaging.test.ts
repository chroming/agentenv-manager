import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  it("exposes Electron packaging entrypoints", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
      build?: {
        appId?: string;
        productName?: string;
        directories?: { output?: string };
        mac?: { icon?: string; target?: string[] };
      };
    };

    expect(packageJson.devDependencies).toHaveProperty("electron-builder");
    expect(packageJson.scripts?.pack).toBe(
      "npm run build && electron-builder --dir"
    );
    expect(packageJson.scripts?.dist).toBe("npm run build && electron-builder");
    expect(packageJson.scripts?.["dist:mac"]).toBe(
      "npm run build && electron-builder --mac"
    );
    expect(packageJson.build).toMatchObject({
      appId: "com.agentenv.manager",
      productName: "AgentEnv Manager",
      directories: { output: "release" },
      mac: { icon: "build/icon.icns", target: ["dmg", "zip"] }
    });
    await expect(stat(join(process.cwd(), "build", "icon.icns"))).resolves.toMatchObject({
      size: expect.any(Number)
    });
    await expect(
      stat(join(process.cwd(), "src", "renderer", "assets", "app-icon.png"))
    ).resolves.toMatchObject({
      size: expect.any(Number)
    });
  });
});
