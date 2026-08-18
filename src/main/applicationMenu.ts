import type { AppUpdateStatus } from "../shared/appUpdates";
import type { AppLocale } from "../shared/types";
import type { BrowserWindow, Menu, MenuItemConstructorOptions } from "electron";

export const APP_UPDATE_MENU_ITEM_ID = "app.check-for-updates";

export interface ApplicationMenuDependencies {
  isDevelopment: boolean;
  locale?: ApplicationMenuLocale;
  platform?: NodeJS.Platform;
  openSettings(): void;
  exportDiagnostics(): void;
  requestAppUpdate?(): void;
}

export interface AppUpdateMenuPresentation {
  enabled: boolean;
  label: string;
}

export type ApplicationMenuLocale = Exclude<AppLocale, "system">;

const MENU_COPY = {
  en: {
    checkUpdates: "Check for Updates…",
    checkingUpdates: "Checking for Updates…",
    preparingUpdate: "Preparing Update…",
    preparingVersion: (version: string) => `Preparing ${version}…`,
    installingUpdate: "Installing Update…",
    installingVersion: (version: string) => `Installing ${version}…`,
    update: "Update…",
    updateVersion: (version: string) => `Update to ${version}…`,
    viewRelease: "View Release…",
    viewVersion: (version: string) => `View ${version} Release…`,
    restartUpdate: "Restart to Update…",
    restartVersion: (version: string) => `Restart to Update to ${version}…`,
    settings: "Settings…",
    exportDiagnostics: "Export Diagnostics…",
    file: "File",
    help: "Help"
  },
  zh_CN: {
    checkUpdates: "检查更新…",
    checkingUpdates: "正在检查更新…",
    preparingUpdate: "正在准备更新…",
    preparingVersion: (version: string) => `正在准备 ${version}…`,
    installingUpdate: "正在安装更新…",
    installingVersion: (version: string) => `正在安装 ${version}…`,
    update: "更新…",
    updateVersion: (version: string) => `更新到 ${version}…`,
    viewRelease: "查看新版本…",
    viewVersion: (version: string) => `查看 ${version}…`,
    restartUpdate: "重新启动并更新…",
    restartVersion: (version: string) => `重新启动并更新到 ${version}…`,
    settings: "设置…",
    exportDiagnostics: "导出诊断信息…",
    file: "文件",
    help: "帮助"
  },
  zh_TW: {
    checkUpdates: "檢查更新…",
    checkingUpdates: "正在檢查更新…",
    preparingUpdate: "正在準備更新…",
    preparingVersion: (version: string) => `正在準備 ${version}…`,
    installingUpdate: "正在安裝更新…",
    installingVersion: (version: string) => `正在安裝 ${version}…`,
    update: "更新…",
    updateVersion: (version: string) => `更新至 ${version}…`,
    viewRelease: "檢視新版本…",
    viewVersion: (version: string) => `檢視 ${version}…`,
    restartUpdate: "重新啟動並更新…",
    restartVersion: (version: string) => `重新啟動並更新至 ${version}…`,
    settings: "設定…",
    exportDiagnostics: "匯出診斷資訊…",
    file: "檔案",
    help: "說明"
  }
} as const;

export const resolveApplicationMenuLocale = (
  preference: AppLocale = "system",
  systemLocale = "en"
): ApplicationMenuLocale => {
  if (preference !== "system") return preference;
  const locale = systemLocale.replace("_", "-").toLowerCase();
  if (!locale.startsWith("zh")) return "en";
  return /(?:hant|tw|hk|mo)(?:-|$)/i.test(locale) ? "zh_TW" : "zh_CN";
};

export const appUpdateMenuPresentation = (
  status?: AppUpdateStatus,
  locale: ApplicationMenuLocale = "en"
): AppUpdateMenuPresentation => {
  const copy = MENU_COPY[locale];
  if (!status) return { label: copy.checkUpdates, enabled: false };
  const version = status.release?.version;
  switch (status.phase) {
    case "checking":
      return { label: copy.checkingUpdates, enabled: false };
    case "downloading":
      return {
        label: version ? copy.preparingVersion(version) : copy.preparingUpdate,
        enabled: false
      };
    case "installing":
      return {
        label: version ? copy.installingVersion(version) : copy.installingUpdate,
        enabled: false
      };
    case "available":
      return status.automaticInstallSupported
        ? { label: version ? copy.updateVersion(version) : copy.update, enabled: true }
        : { label: version ? copy.viewVersion(version) : copy.viewRelease, enabled: true };
    case "ready":
      return {
        label: version ? copy.restartVersion(version) : copy.restartUpdate,
        enabled: status.automaticInstallSupported
      };
    default:
      return { label: copy.checkUpdates, enabled: true };
  }
};

export const updateApplicationMenuForAppUpdate = (
  menu: Menu | null,
  status?: AppUpdateStatus,
  locale: ApplicationMenuLocale = "en"
) => {
  const item = menu?.getMenuItemById(APP_UPDATE_MENU_ITEM_ID);
  if (!item) return;
  const presentation = appUpdateMenuPresentation(status, locale);
  item.label = presentation.label;
  item.enabled = presentation.enabled;
};

export const createApplicationMenuTemplate = ({
  isDevelopment,
  locale = "en",
  platform = process.platform,
  openSettings,
  exportDiagnostics,
  requestAppUpdate
}: ApplicationMenuDependencies): MenuItemConstructorOptions[] => {
  const copy = MENU_COPY[locale];
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
        label: copy.file,
        submenu: [
          {
            label: copy.settings,
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
        label: copy.help,
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: copy.exportDiagnostics,
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
          label: copy.checkUpdates,
          enabled: false,
          click: () => requestAppUpdate?.()
        } satisfies MenuItemConstructorOptions] : []),
        { type: "separator" },
        {
          label: copy.settings,
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
          label: copy.exportDiagnostics,
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
