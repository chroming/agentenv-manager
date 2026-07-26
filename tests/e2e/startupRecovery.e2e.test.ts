import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectInViewport,
  expectNoHorizontalOverflow,
  findVisibleTextLayoutDefects
} from "./layoutAssertions";

let root = "";
let app: ElectronApplication | undefined;

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("startup recovery desktop flow", () => {
  it("keeps a newer data format untouched and offers recovery actions", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-startup-recovery-"));
    const dataRoot = join(root, "data");
    await mkdir(dataRoot, { recursive: true });
    await writeFile(join(dataRoot, "agentenv-data.json"), '{"formatVersion":99}\n');
    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [`--user-data-dir=${join(root, "electron-user-data")}`, "."],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTENV_AUTOMATION: "1",
        AGENTENV_DATA_ROOT: dataRoot,
        AGENTENV_HOME: join(root, "home")
      }
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 920, height: 620 });

    const heading = page.getByRole("heading", {
      name: "This data needs a newer AgentEnv Manager"
    });
    await heading.waitFor({ state: "visible", timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => window.agentEnv.readStartupStatus()))
      .toMatchObject({ state: "failed", kind: "newer-data-format" });
    await expect(page.getByRole("button", { name: "Retry" }).isEnabled()).resolves.toBe(true);
    await expect(page.getByRole("button", { name: "Open data folder" }).count()).resolves.toBe(1);
    await expect(page.getByRole("button", { name: "Export diagnostics" }).count()).resolves.toBe(1);
    await expect(writeFile(join(dataRoot, "probe"), "still writable")).resolves.toBeUndefined();
    await expectInViewport(page, heading);
    await expectNoHorizontalOverflow(page);
    expect(await findVisibleTextLayoutDefects(page)).toEqual([]);
  }, 20_000);
});
