import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { createActivationService } from "./activationService";
import { createBackupStore } from "./backupStore";
import { registerIpcHandlers } from "./ipc";
import { createPaths } from "./paths";
import { createProfileStore } from "./profileStore";
import { seedDefaultProfiles } from "./seedProfiles";
import { createSettingsStore } from "./settingsStore";
import { createSkillLibraryStore } from "./skillLibraryStore";
import { createTargetDiscoveryService } from "./targetDiscovery";
import { createTargetRegistry } from "./targets/registry";
import { preloadScriptName } from "./windowConfig";

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: "AgentEnv Manager",
    webPreferences: {
      preload: join(__dirname, "../preload", preloadScriptName),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

const createServices = async () => {
  const appDataRoot =
    process.env.AGENTENV_DATA_ROOT ?? join(app.getPath("userData"), "data");
  const paths = createPaths({
    appDataRoot,
    homeDir: process.env.AGENTENV_HOME,
    fakeHomeRoot: process.env.AGENTENV_FAKE_HOME ?? join(appDataRoot, "fake-home")
  });
  const targetRegistry = createTargetRegistry();
  const settingsStore = createSettingsStore(paths);
  const profileStore = createProfileStore({
    appDataRoot: paths.appDataRoot,
    fakeHomeRoot: paths.fakeHomeRoot
  }, targetRegistry);
  const backupStore = createBackupStore(paths);
  const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
  const activationService = createActivationService({
    paths,
    profileStore,
    targetRegistry,
    settingsStore
  });
  const targetDiscoveryService = createTargetDiscoveryService({
    paths,
    targetRegistry
  });

  await seedDefaultProfiles(paths, targetRegistry);

  return {
    profileStore,
    backupStore,
    settingsStore,
    skillLibraryStore,
    activationService,
    targetRegistry,
    targetDiscoveryService
  };
};

void app.whenReady().then(() => {
  void createServices().then((services) => {
    registerIpcHandlers(services);
    createWindow();
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
