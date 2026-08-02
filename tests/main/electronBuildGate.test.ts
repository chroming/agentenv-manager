import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron E2E build gate", () => {
  it("requires every Electron-launching E2E file to verify the current build", async () => {
    const e2eRoot = join(process.cwd(), "tests", "e2e");
    const testFiles = (await readdir(e2eRoot))
      .filter((file) => file.endsWith(".e2e.test.ts"))
      .sort();
    const unguarded = [];

    for (const file of testFiles) {
      const content = await readFile(join(e2eRoot, file), "utf8");
      if (
        (content.includes("_electron as electron") ||
          content.includes("electron.launch(")) &&
        (!content.includes("requireCurrentElectronBuild") ||
          !content.includes("requireCurrentElectronBuild();"))
      ) {
        unguarded.push(file);
      }
    }

    expect(unguarded).toEqual([]);
  });
});
