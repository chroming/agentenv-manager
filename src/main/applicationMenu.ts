import type { BrowserWindow, MenuItemConstructorOptions } from "electron";

export interface ApplicationMenuDependencies {
  isDevelopment: boolean;
  platform?: NodeJS.Platform;
  openSettings(): void;
  exportDiagnostics(): void;
}

export const createApplicationMenuTemplate = ({
  isDevelopment,
  platform = process.platform,
  openSettings,
  exportDiagnostics
}: ApplicationMenuDependencies): MenuItemConstructorOptions[] => {
  const viewSubmenu: MenuItemConstructorOptions[] = [];
  if (isDevelopment) {
    viewSubmenu.push(
      { role: "reload" },
      { role: "forceReload" }
    );
  }
  viewSubmenu.push(
    {
      role: "toggleDevTools",
      accelerator: platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I"
    },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" }
  );

  const editMenu: MenuItemConstructorOptions = {
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
  };
  const viewMenu: MenuItemConstructorOptions = {
    role: "viewMenu",
    submenu: viewSubmenu
  };
  if (platform !== "darwin") {
    return [
      {
        label: "File",
        submenu: [
          {
            label: "Settings…",
            accelerator: "CmdOrCtrl+,",
            click: openSettings
          },
          { type: "separator" },
          { role: "close" },
          { role: "quit" }
        ]
      },
      editMenu,
      viewMenu,
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Export Diagnostics…",
            click: exportDiagnostics
          }
        ]
      }
    ];
  }

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
    editMenu,
    viewMenu,
    {
      role: "windowMenu",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    },
    {
      role: "help",
      submenu: [
        {
          label: "Export Diagnostics…",
          click: exportDiagnostics
        }
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
