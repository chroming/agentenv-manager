import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { createActivationService } from "./activationService";
import { createBackupStore } from "./backupStore";
import { registerIpcHandlers } from "./ipc";
import { createPaths } from "./paths";
import { createProfileStore } from "./profileStore";

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: "AgentEnv Manager",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
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

const createServices = () => {
  const appDataRoot =
    process.env.AGENTENV_DATA_ROOT ?? join(app.getPath("userData"), "data");
  const fakeHomeRoot =
    process.env.AGENTENV_FAKE_HOME ?? join(appDataRoot, "fake-home");
  const paths = createPaths({
    appDataRoot,
    codexHome: join(fakeHomeRoot, ".codex"),
    userSkillsDir: join(fakeHomeRoot, ".agents", "skills")
  });
  const profileStore = createProfileStore({
    appDataRoot: paths.appDataRoot,
    codexHome: paths.codexHome,
    userSkillsDir: paths.userSkillsDir
  });
  const backupStore = createBackupStore(paths);
  const activationService = createActivationService({ paths, profileStore });

  return { profileStore, backupStore, activationService };
};

void app.whenReady().then(() => {
  registerIpcHandlers(createServices());
  createWindow();
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
