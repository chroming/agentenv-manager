import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import {
  APP_UPDATE_MENU_ITEM_ID,
  appUpdateMenuPresentation,
  createApplicationMenuTemplate
} from "../../src/main/applicationMenu";

const allItems = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? allItems(item.submenu) : [])
  ]);

describe("application menu", () => {
  it("keeps reload out of production while retaining diagnostic developer tools", () => {
    const openSettings = vi.fn();
    const exportDiagnostics = vi.fn();
    const items = allItems(createApplicationMenuTemplate({
      isDevelopment: false,
      platform: "darwin",
      openSettings,
      exportDiagnostics
    }));

    expect(items.map((item) => item.role)).not.toContain("reload");
    expect(items.map((item) => item.role)).not.toContain("forceReload");
    expect(items.find((item) => item.role === "toggleDevTools")?.accelerator)
      .toBe("Alt+Command+I");

    const settings = items.find((item) => item.accelerator === "CmdOrCtrl+,");
    expect(settings?.label).toBe("Settings…");
    settings?.click?.({} as never, undefined, {} as never);
    expect(openSettings).toHaveBeenCalledTimes(1);

    const diagnostics = items.find((item) => item.label === "Export Diagnostics…");
    diagnostics?.click?.({} as never, undefined, {} as never);
    expect(exportDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("adds one native macOS update action and forwards clicks to the update service", () => {
    const requestAppUpdate = vi.fn();
    const items = allItems(createApplicationMenuTemplate({
      isDevelopment: false,
      platform: "darwin",
      openSettings: vi.fn(),
      exportDiagnostics: vi.fn(),
      requestAppUpdate
    }));
    const update = items.find((item) => item.id === APP_UPDATE_MENU_ITEM_ID);

    expect(update).toMatchObject({ label: "Check for Updates…", enabled: false });
    update?.click?.({} as never, undefined, {} as never);
    expect(requestAppUpdate).toHaveBeenCalledTimes(1);
  });

  it("uses one stable menu item for every update phase", () => {
    const base = {
      currentVersion: "0.1.0",
      installChannel: "homebrew" as const,
      automaticInstallSupported: true,
      release: {
        version: "0.2.0",
        tag: "v0.2.0",
        releaseUrl: "https://example.test/releases/v0.2.0",
        publishedAt: "2026-08-17T00:00:00Z"
      }
    };

    expect(appUpdateMenuPresentation({ ...base, phase: "checking" }))
      .toEqual({ label: "Checking for Updates…", enabled: false });
    expect(appUpdateMenuPresentation({ ...base, phase: "downloading" }))
      .toEqual({ label: "Preparing 0.2.0…", enabled: false });
    expect(appUpdateMenuPresentation({ ...base, phase: "ready" }))
      .toEqual({ label: "Restart to Update to 0.2.0…", enabled: true });
    expect(appUpdateMenuPresentation({ ...base, phase: "installing" }))
      .toEqual({ label: "Installing 0.2.0…", enabled: false });
  });

  it("retains reload and developer tools for the development server", () => {
    const items = allItems(createApplicationMenuTemplate({
      isDevelopment: true,
      platform: "darwin",
      openSettings: vi.fn(),
      exportDiagnostics: vi.fn()
    }));
    expect(items.map((item) => item.role)).toEqual(expect.arrayContaining([
      "reload",
      "forceReload",
      "toggleDevTools"
    ]));
  });

  it("uses conventional File and Help placement outside macOS", () => {
    const template = createApplicationMenuTemplate({
      isDevelopment: false,
      platform: "win32",
      openSettings: vi.fn(),
      exportDiagnostics: vi.fn()
    });
    const items = allItems(template);

    expect(template[0]?.label).toBe("File");
    expect(template[0]?.role).not.toBe("appMenu");
    expect(items.map((item) => item.role)).toContain("about");
    expect(items.find((item) => item.accelerator === "CmdOrCtrl+,")?.label)
      .toBe("Settings…");
    expect(items.find((item) => item.role === "toggleDevTools")?.accelerator)
      .toBe("Ctrl+Shift+I");
  });
});
