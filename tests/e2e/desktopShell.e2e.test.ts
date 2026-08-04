import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  constrainWindowState,
  readWindowState
} from "../../src/main/windowStateStore";
import { requireCurrentElectronBuild } from "./currentBuild";

let root = "";
let app: ElectronApplication | undefined;

requireCurrentElectronBuild();

const launch = async () => electron.launch({
  executablePath: electronPath as unknown as string,
  args: [`--user-data-dir=${join(root, "electron-user-data")}`, "."],
  cwd: process.cwd(),
  env: {
    ...process.env,
    AGENTENV_AUTOMATION: "1",
    AGENTENV_AUTOMATION_TARGET_PATH: join(root, "agent-bin"),
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
  it("keeps macOS window chrome quiet when entering full screen", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-desktop-shell-fullscreen-"));
    app = await launch();
    const page = await app.firstWindow();
    const titlebar = page.locator(".shell-titlebar");
    await page.getByRole("heading", { name: "Agents" }).waitFor({ state: "visible" });
    await titlebar.getByRole("button", { name: "Collapse sidebar" }).waitFor({ state: "visible" });

    await app.browserWindow(page).then((handle) => handle.evaluate((window) => {
      window.setFullScreen(true);
    }));
    await page.locator(".app-shell--full-screen").waitFor({ state: "visible" });

    const geometry = await page.evaluate(() => {
      const titlebar = document.querySelector<HTMLElement>(".shell-titlebar")!;
      const toggle = titlebar.querySelector<HTMLElement>(".shell-sidebar-toggle")!;
      const titlebarBox = titlebar.getBoundingClientRect();
      const toggleBox = toggle.getBoundingClientRect();
      return {
        height: Math.round(titlebarBox.height),
        pageActions: titlebar.querySelectorAll(".ui-page-header__actions").length,
        pageHeadings: titlebar.querySelectorAll("h1, h2, h3").length,
        separatorHeight: getComputedStyle(titlebar, "::after").height,
        titlebarLeft: Math.round(titlebarBox.left),
        titlebarRight: Math.round(titlebarBox.right),
        toggleLeft: Math.round(toggleBox.left),
        toggleContained:
          toggleBox.top >= titlebarBox.top && toggleBox.bottom <= titlebarBox.bottom,
        viewportWidth: document.documentElement.clientWidth
      };
    });
    expect(geometry).toMatchObject({
      height: 36,
      pageActions: 0,
      pageHeadings: 0,
      separatorHeight: "1px",
      titlebarLeft: 0,
      toggleLeft: 12,
      toggleContained: true
    });
    expect(geometry.titlebarRight).toBe(geometry.viewportWidth);
    expect(await titlebar.getByRole("button", { name: "Refresh" }).count()).toBe(0);
    await page.getByRole("button", { name: "Refresh" }).waitFor({ state: "visible" });
  }, 30_000);

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

    const persisted = readWindowState(join(root, "data", "window-state.json"));
    expect(persisted).toBeDefined();

    app = await launch();
    const restoredPage = await app.firstWindow();
    const restored = await app.browserWindow(restoredPage).then((handle) =>
      handle.evaluate((window) => window.getNormalBounds())
    );
    const workArea = await app.evaluate(
      ({ screen }, bounds) => screen.getDisplayMatching(bounds).workArea,
      restored
    );
    const expected = constrainWindowState(persisted!, workArea);
    expect(restored).toEqual({
      x: expected.x,
      y: expected.y,
      width: expected.width,
      height: expected.height
    });
  }, 30_000);
});
