import type { BrowserWindow, MenuItemConstructorOptions } from "electron";

export interface ApplicationMenuDependencies {
  isDevelopment: boolean;
  openSettings(): void;
}

export const createApplicationMenuTemplate = ({
  isDevelopment,
  openSettings
}: ApplicationMenuDependencies): MenuItemConstructorOptions[] => {
  const viewSubmenu: MenuItemConstructorOptions[] = [];
  if (isDevelopment) {
    viewSubmenu.push(
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" }
    );
  }
  viewSubmenu.push({ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" });

  return [
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: openSettings
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      role: "fileMenu",
      submenu: [{ role: "close" }]
    },
    {
      role: "editMenu",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      role: "viewMenu",
      submenu: viewSubmenu
    },
    {
      role: "windowMenu",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    }
  ];
};

export const requestSettingsForWindow = (window: BrowserWindow | undefined) => {
  if (!window || window.webContents.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send("app:open-settings-requested");
};
