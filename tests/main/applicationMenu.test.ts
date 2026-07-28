import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { createApplicationMenuTemplate } from "../../src/main/applicationMenu";

const allItems = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? allItems(item.submenu) : [])
  ]);

describe("application menu", () => {
  it("keeps browser reload and developer tools out of production", () => {
    const openSettings = vi.fn();
    const exportDiagnostics = vi.fn();
    const items = allItems(createApplicationMenuTemplate({
      isDevelopment: false,
      openSettings,
      exportDiagnostics
    }));

    expect(items.map((item) => item.role)).not.toContain("reload");
    expect(items.map((item) => item.role)).not.toContain("forceReload");
    expect(items.map((item) => item.role)).not.toContain("toggleDevTools");

    const settings = items.find((item) => item.accelerator === "CmdOrCtrl+,");
    expect(settings?.label).toBe("Settings…");
    settings?.click?.({} as never, undefined, {} as never);
    expect(openSettings).toHaveBeenCalledTimes(1);

    const diagnostics = items.find((item) => item.label === "Export Diagnostics…");
    diagnostics?.click?.({} as never, undefined, {} as never);
    expect(exportDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("retains reload and developer tools only for the development server", () => {
    const items = allItems(createApplicationMenuTemplate({
      isDevelopment: true,
      openSettings: vi.fn(),
      exportDiagnostics: vi.fn()
    }));
    expect(items.map((item) => item.role)).toEqual(expect.arrayContaining([
      "reload",
      "forceReload",
      "toggleDevTools"
    ]));
  });
});
