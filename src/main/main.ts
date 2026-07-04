import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createActivationService } from "./activationService";
import {
  legacyElectronAppDataRoot,
  migrateLegacyAppDataRoot,
  resolveAppDataRoot
} from "./appDataRoot";
import { createBackupStore } from "./backupStore";
import { createFileGitHubTokenStore, createGitHubAuthService } from "./githubAuthService";
import { createMcpLibraryStore } from "./mcpLibraryStore";
import { registerIpcHandlers } from "./ipc";
import { createPaths } from "./paths";
import { createProfileStore } from "./profileStore";
import { seedDefaultProfiles } from "./seedProfiles";
import { createSettingsStore } from "./settingsStore";
import { createSkillLibraryStore } from "./skillLibraryStore";
import { createTargetDiscoveryService } from "./targetDiscovery";
import { createTargetRegistry } from "./targets/registry";
import { preloadScriptName } from "./windowConfig";

const createGitHubFixtureFetch = (fixtureRoot: string) => {
  const fileResponse = (content: string, init?: ResponseInit) =>
    new Response(content, {
      status: init?.status ?? 200,
      statusText: init?.statusText ?? "OK",
      headers: init?.headers
    });

  const shaFor = async (path: string) =>
    createHash("sha1").update(await readFile(path)).digest("hex");

  return async (url: string, _init?: RequestInit) => {
    const parsed = new URL(url);
    if (parsed.protocol === "agentenv-fixture:") {
      const fixturePath = decodeURIComponent(parsed.pathname.slice(1));
      return fileResponse(await readFile(fixturePath, "utf8"));
    }

    if (parsed.hostname !== "api.github.com") {
      return fetch(url);
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const [repos, owner, repo, contents, ...pathParts] = parts;
    if (repos !== "repos" || contents !== "contents" || !owner || !repo) {
      return fileResponse("Not found", { status: 404, statusText: "Not Found" });
    }

    const ref = parsed.searchParams.get("ref") ?? "main";
    const contentRoot = join(fixtureRoot, owner, repo, ref);
    const contentPath = join(contentRoot, ...pathParts.map(decodeURIComponent));
    const entries = await readdir(contentPath, { withFileTypes: true });
    const body = await Promise.all(
      entries.map(async (entry) => {
        const child = join(contentPath, entry.name);
        const relativePath = pathParts.concat(entry.name).join("/");
        return {
          type: entry.isDirectory() ? "dir" : "file",
          name: entry.name,
          path: relativePath,
          sha: entry.isDirectory()
            ? createHash("sha1").update(`${relativePath}/`).digest("hex")
            : await shaFor(child),
          download_url: entry.isDirectory()
            ? null
            : `agentenv-fixture:///${encodeURIComponent(child)}`
        };
      })
    );
    await stat(contentPath);
    return fileResponse(JSON.stringify(body), {
      headers: { "content-type": "application/json" }
    });
  };
};

const approvedWindowCloses = new WeakSet<BrowserWindow>();

ipcMain.on("window:confirm-close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return;
  }
  approvedWindowCloses.add(win);
  win.close();
});

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

  win.on("close", (event) => {
    if (
      approvedWindowCloses.has(win) ||
      process.env.AGENTENV_AUTOMATION === "1"
    ) {
      return;
    }
    event.preventDefault();
    win.webContents.send("window:close-requested");
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

const createServices = async () => {
  const appDataRoot = resolveAppDataRoot({
    homeDir: app.getPath("home"),
    userDataDir: app.getPath("userData")
  });
  if (!process.env.AGENTENV_DATA_ROOT) {
    await migrateLegacyAppDataRoot({
      legacyRoot: legacyElectronAppDataRoot(app.getPath("userData")),
      nextRoot: appDataRoot
    });
  }
  const paths = createPaths({
    appDataRoot,
    homeDir: process.env.AGENTENV_HOME,
    fakeHomeRoot: process.env.AGENTENV_FAKE_HOME ?? join(appDataRoot, "fake-home")
  });
  const targetRegistry = createTargetRegistry();
  const settingsStore = createSettingsStore(paths);
  const githubAuthService = createGitHubAuthService({
    tokenStore: createFileGitHubTokenStore(paths, {
      decryptString: (value) => safeStorage.decryptString(value),
      encryptString: (value) => safeStorage.encryptString(value),
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable()
    })
  });
  const profileStore = createProfileStore({
    appDataRoot: paths.appDataRoot,
    fakeHomeRoot: paths.fakeHomeRoot
  }, targetRegistry);
  const backupStore = createBackupStore(paths);
  const skillLibraryStore = createSkillLibraryStore(
    paths,
    settingsStore,
    {
      authTokenProvider: githubAuthService.readAccessToken,
      ...(process.env.AGENTENV_GITHUB_FIXTURE_ROOT
        ? { fetch: createGitHubFixtureFetch(process.env.AGENTENV_GITHUB_FIXTURE_ROOT) }
        : {})
    }
  );
  const mcpLibraryStore = createMcpLibraryStore(paths);
  const activationService = createActivationService({
    paths,
    profileStore,
    targetRegistry,
    settingsStore,
    mcpLibraryStore
  });
  const targetDiscoveryService = createTargetDiscoveryService({
    paths,
    targetRegistry
  });

  await seedDefaultProfiles(paths, targetRegistry);

  return {
    profileStore,
    backupStore,
    githubAuthService,
    settingsStore,
    skillLibraryStore,
    mcpLibraryStore,
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
