import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
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
import { createBackupMaintenanceService } from "./backupMaintenanceService";
import { createFileGitHubTokenStore, createGitHubAuthService } from "./githubAuthService";
import { createMcpLibraryStore } from "./mcpLibraryStore";
import { registerIpcHandlers } from "./ipc";
import { createPaths } from "./paths";
import { createProfileStore } from "./profileStore";
import { seedDefaultProfiles } from "./seedProfiles";
import { createSettingsStore } from "./settingsStore";
import { createSkillLibraryStore } from "./skillLibraryStore";
import { createTargetDiscoveryService } from "./targetDiscovery";
import { createTargetCaptureService } from "./targetCaptureService";
import { createTargetRegistry } from "./targets/registry";
import { preloadScriptName, windowBackgroundColor } from "./windowConfig";
import { recoverPendingReplacementsInDirectory } from "./fileUtils";

const createGitHubFixtureFetch = (fixtureRoot: string) => {
  const fixtureTrees = new Map<string, string>();
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

    if (parsed.hostname === "raw.githubusercontent.com") {
      const [owner, repo, encodedRef, ...pathParts] = parsed.pathname.split("/").filter(Boolean);
      if (!owner || !repo || !encodedRef) {
        return fileResponse("Not found", { status: 404, statusText: "Not Found" });
      }
      const filePath = join(
        fixtureRoot,
        owner,
        repo,
        decodeURIComponent(encodedRef),
        ...pathParts.map(decodeURIComponent)
      );
      try {
        return fileResponse(await readFile(filePath, "utf8"));
      } catch {
        return fileResponse("Not found", { status: 404, statusText: "Not Found" });
      }
    }

    if (parsed.hostname !== "api.github.com") {
      return fetch(url);
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const [repos, owner, repo, resource, ...pathParts] = parts;
    if (repos !== "repos" || !owner || !repo) {
      return fileResponse("Not found", { status: 404, statusText: "Not Found" });
    }

    if (!resource) {
      return fileResponse(JSON.stringify({ default_branch: "main" }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (resource === "commits") {
      const ref = decodeURIComponent(pathParts.join("/"));
      if (ref !== "main") {
        return fileResponse("Not found", { status: 404, statusText: "Not Found" });
      }
      const contentRoot = join(fixtureRoot, owner, repo, ref);
      try {
        await stat(contentRoot);
      } catch {
        return fileResponse("Not found", { status: 404, statusText: "Not Found" });
      }
      const treeSha = createHash("sha1").update(`${owner}/${repo}/${ref}`).digest("hex");
      fixtureTrees.set(treeSha, contentRoot);
      return fileResponse(JSON.stringify({ commit: { tree: { sha: treeSha } } }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (resource === "git" && pathParts[0] === "trees" && pathParts[1]) {
      const contentRoot = fixtureTrees.get(pathParts[1]);
      if (!contentRoot) {
        return fileResponse("Not found", { status: 404, statusText: "Not Found" });
      }
      const tree: Array<{ path: string; type: "blob" | "tree"; sha: string }> = [];
      const walk = async (directory: string, prefix = "") => {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          const child = join(directory, entry.name);
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            tree.push({
              path: relativePath,
              type: "tree",
              sha: createHash("sha1").update(`${relativePath}/`).digest("hex")
            });
            await walk(child, relativePath);
          } else if (entry.isFile()) {
            tree.push({ path: relativePath, type: "blob", sha: await shaFor(child) });
          }
        }
      };
      await walk(contentRoot);
      return fileResponse(JSON.stringify({ truncated: false, tree }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (resource !== "contents") {
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
const guardedWindowCloses = new WeakSet<BrowserWindow>();
let appQuitRequested = false;
let servicesInitialized = false;

ipcMain.on("window:set-close-guard", (event, enabled: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return;
  }
  if (enabled === true) {
    guardedWindowCloses.add(win);
  } else {
    guardedWindowCloses.delete(win);
  }
});

ipcMain.on("window:confirm-close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return;
  }
  approvedWindowCloses.add(win);
  if (appQuitRequested) {
    app.quit();
  } else {
    win.close();
  }
});

ipcMain.on("window:cancel-close", () => {
  appQuitRequested = false;
});

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: windowBackgroundColor,
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
      (process.env.AGENTENV_AUTOMATION === "1" &&
        process.env.AGENTENV_TEST_CLOSE_GUARD !== "1") ||
      !guardedWindowCloses.has(win) ||
      win.webContents.isDestroyed() ||
      win.webContents.isCrashed()
    ) {
      return;
    }
    event.preventDefault();
    win.webContents.send("window:close-requested");
  });

  win.webContents.on("did-start-loading", () => {
    guardedWindowCloses.delete(win);
  });
  win.webContents.on("render-process-gone", () => {
    guardedWindowCloses.delete(win);
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
  await recoverPendingReplacementsInDirectory(join(appDataRoot, ".."));
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
  const replacementRoots = new Set([paths.profilesDir, paths.skillsLibraryDir]);
  for (const adapter of targetRegistry.listAdapters()) {
    const targetPaths = adapter.createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    if (targetPaths.skillsDir) replacementRoots.add(targetPaths.skillsDir);
    if (targetPaths.agentsDir) replacementRoots.add(targetPaths.agentsDir);
    for (const scanDir of targetPaths.skillScanDirs ?? []) replacementRoots.add(scanDir);
    for (const location of targetPaths.skillLocations ?? []) replacementRoots.add(location.path);
  }
  for (const root of replacementRoots) {
    await recoverPendingReplacementsInDirectory(root);
  }
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
      profileStore,
      authTokenProvider: githubAuthService.readAccessToken,
      targetPathsProvider: () => targetRegistry.listAdapters().map((adapter) =>
        adapter.createTargetPaths({
          homeDir: paths.homeDir,
          fakeHomeRoot: paths.fakeHomeRoot
        })
      ),
      ...(process.env.AGENTENV_GITHUB_FIXTURE_ROOT
        ? { fetch: createGitHubFixtureFetch(process.env.AGENTENV_GITHUB_FIXTURE_ROOT) }
        : {})
    }
  );
  const backupMaintenanceService = createBackupMaintenanceService(
    paths,
    backupStore,
    skillLibraryStore,
    settingsStore
  );
  const mcpLibraryStore = createMcpLibraryStore(paths);
  const activationService = createActivationService({
    paths,
    profileStore,
    targetRegistry,
    settingsStore,
    mcpLibraryStore,
    skillLibraryStore
  });
  const targetDiscoveryService = createTargetDiscoveryService({
    paths,
    targetRegistry
  });
  const targetCaptureService = createTargetCaptureService({
    paths,
    targetRegistry,
    profileStore,
    skillLibraryStore,
    mcpLibraryStore,
    targetDiscoveryService
  });

  await seedDefaultProfiles(paths, targetRegistry);

  return {
    paths,
    profileStore,
    backupStore,
    backupMaintenanceService,
    githubAuthService,
    settingsStore,
    skillLibraryStore,
    mcpLibraryStore,
    activationService,
    targetCaptureService,
    targetRegistry,
    targetDiscoveryService
  };
};

void app.whenReady().then(() => {
  void createServices()
    .then((services) => {
      registerIpcHandlers(services);
      if (process.env.AGENTENV_AUTOMATION !== "1") {
        const runBackupCleanup = async () => {
          const settings = await services.settingsStore.readSettings();
          if (settings.backupRetentionDays !== null) {
            await services.backupMaintenanceService.cleanup();
          }
        };
        void runBackupCleanup().catch((error) => {
          console.error("Automatic backup cleanup failed", error);
        });
        const timer = setInterval(() => {
          void runBackupCleanup().catch((error) => {
            console.error("Automatic backup cleanup failed", error);
          });
        }, 24 * 60 * 60 * 1000);
        timer.unref();
      }
      servicesInitialized = true;
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    })
    .catch((error) => {
      dialog.showErrorBox(
        "AgentEnv Manager could not start",
        error instanceof Error ? error.message : String(error)
      );
      app.quit();
    });
});

app.on("activate", () => {
  if (servicesInitialized && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  appQuitRequested = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
