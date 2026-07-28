import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";

let root = "";
let app: ElectronApplication | undefined;

const launch = async () => electron.launch({
  executablePath: electronPath as unknown as string,
  args: [`--user-data-dir=${join(root, "electron-user-data")}`, "."],
  cwd: process.cwd(),
  env: {
    ...process.env,
    AGENTENV_AUTOMATION: "1",
    AGENTENV_DATA_ROOT: join(root, "data"),
    AGENTENV_HOME: join(root, "home")
  }
});

afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("desktop shell", () => {
  it("owns its production menu and restores device-local window bounds", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-desktop-shell-"));
    app = await launch();
    const page = await app.firstWindow();

    const menu = await app.evaluate(({ Menu }) => {
      const rootMenu = Menu.getApplicationMenu();
      const items: Array<{ label: string; role?: string; accelerator?: string }> = [];
      const visit = (menuItems: Electron.MenuItem[]) => {
        for (const item of menuItems) {
          items.push({
            label: item.label,
            role: item.role || undefined,
            accelerator: item.accelerator || undefined
          });
          if (item.submenu) visit(item.submenu.items);
        }
      };
      if (rootMenu) visit(rootMenu.items);
      return items;
    });
    expect(menu.some((item) =>
      item.label === "Settings…" && item.accelerator?.endsWith(",")
    )).toBe(true);
    expect(menu.map((item) => item.role)).not.toContain("reload");
    expect(menu.map((item) => item.role)).not.toContain("forceReload");
    expect(menu.map((item) => item.role)).not.toContain("toggleDevTools");

    await page.getByRole("complementary", { name: "Global navigation" }).waitFor({
      state: "visible",
      timeout: 15_000
    });
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const rootMenu = Menu.getApplicationMenu();
      const findSettings = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
        for (const item of items) {
          if (item.label === "Settings…") return item;
          const nested = item.submenu ? findSettings(item.submenu.items) : undefined;
          if (nested) return nested;
        }
        return undefined;
      };
      const settings = rootMenu ? findSettings(rootMenu.items) : undefined;
      const window = BrowserWindow.getAllWindows()[0];
      settings?.click?.(settings, window, {} as Electron.KeyboardEvent);
    });
    await page.getByRole("region", { name: "Settings", exact: true }).waitFor({
      state: "visible",
      timeout: 15_000
    });

    await app.browserWindow(page).then((handle) => handle.evaluate((window) => {
      window.setBounds({ x: 120, y: 90, width: 1_000, height: 680 });
    }));
    await page.waitForTimeout(350);
    await app.close();
    app = undefined;

    app = await launch();
    const restoredPage = await app.firstWindow();
    const restored = await app.browserWindow(restoredPage).then((handle) =>
      handle.evaluate((window) => window.getNormalBounds())
    );
    expect(restored.width).toBe(1_000);
    expect(restored.height).toBe(680);
    expect(Math.abs(restored.x - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - 90)).toBeLessThanOrEqual(1);
  }, 30_000);
});
