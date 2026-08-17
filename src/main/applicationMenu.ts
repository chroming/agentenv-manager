import type { AppUpdateStatus } from "../shared/appUpdates";
import type { BrowserWindow, Menu, MenuItemConstructorOptions } from "electron";

export const APP_UPDATE_MENU_ITEM_ID = "app.check-for-updates";

export interface ApplicationMenuDependencies {
  isDevelopment: boolean;
  platform?: NodeJS.Platform;
  openSettings(): void;
  exportDiagnostics(): void;
  requestAppUpdate?(): void;
}

export interface AppUpdateMenuPresentation {
  enabled: boolean;
  label: string;
}

export const appUpdateMenuPresentation = (
  status?: AppUpdateStatus
): AppUpdateMenuPresentation => {
  if (!status) return { label: "Check for Updates…", enabled: false };
  const version = status.release?.version;
  switch (status.phase) {
    case "checking":
      return { label: "Checking for Updates…", enabled: false };
    case "downloading":
      return {
        label: version ? `Preparing ${version}…` : "Preparing Update…",
        enabled: false
      };
    case "installing":
      return {
        label: version ? `Installing ${version}…` : "Installing Update…",
        enabled: false
      };
    case "available":
      return status.automaticInstallSupported
        ? { label: version ? `Update to ${version}…` : "Update…", enabled: true }
        : { label: version ? `View ${version} Release…` : "View Release…", enabled: true };
    case "ready":
      return {
        label: version ? `Restart to Update to ${version}…` : "Restart to Update…",
        enabled: status.automaticInstallSupported
      };
    default:
      return { label: "Check for Updates…", enabled: true };
  }
};

export const updateApplicationMenuForAppUpdate = (
  menu: Menu | null,
  status?: AppUpdateStatus
) => {
  const item = menu?.getMenuItemById(APP_UPDATE_MENU_ITEM_ID);
  if (!item) return;
  const presentation = appUpdateMenuPresentation(status);
  item.label = presentation.label;
  item.enabled = presentation.enabled;
};

export const createApplicationMenuTemplate = ({
  isDevelopment,
  platform = process.platform,
  openSettings,
  exportDiagnostics,
  requestAppUpdate
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
        ...(!isDevelopment ? [{
          id: APP_UPDATE_MENU_ITEM_ID,
          label: "Check for Updates…",
          enabled: false,
          click: () => requestAppUpdate?.()
        } satisfies MenuItemConstructorOptions] : []),
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
