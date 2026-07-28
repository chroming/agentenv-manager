import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  screen,
  shell
} from "electron";
import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, readFile, stat } from "node:fs/promises";
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
import { registerIpcHandlers } from "./ipc";
import { createPaths } from "./paths";
import { createProfileStore } from "./profileStore";
import { seedDefaultProfiles } from "./seedProfiles";
import { createSettingsStore } from "./settingsStore";
import { createSkillLibraryStore } from "./skillLibraryStore";
import { createTargetDiscoveryService } from "./targetDiscovery";
import { createTargetCaptureService } from "./targetCaptureService";
import {
  createConversationService,
  type ConversationService
} from "./conversations/conversationService";
import { createTargetRegistry } from "./targets/registry";
import { createFilesystemSkillDriver } from "./targets/shared/skillRuntime";
import { createTargetScope } from "./targets/targetScope";
import { findExecutable } from "./executableDiscovery";
import { createGitCliSkillSource } from "./skillSources/gitCliSource";
import { createGitCommandRunner, type GitCommandRunner } from "./skillSources/gitCommandRunner";
import { createGitRepositoryCache } from "./skillSources/gitRepositoryCache";
import type { GitCliSkillSource } from "./skillSources/contract";
import {
  preloadScriptName,
  windowBackgroundColor,
  windowChromeOptionsFor
} from "./windowConfig";
import { pathEntryExists, recoverPendingReplacementsInDirectory } from "./fileUtils";
import { createMutationCoordinator } from "./mutationCoordinator";
import { ensureAppDataFormat } from "./appDataFormat";
import { migrateAppDataToV2 } from "./appDataMigration";
import { migrateSkillContentHashes } from "./skillContentHashMigration";
import { createPortableWorkspaceCodec } from "./workspaceSync/portableWorkspaceCodec";
import { createWorkspaceSyncStateStore } from "./workspaceSync/syncStateStore";
import { createWorkspaceSyncTransaction } from "./workspaceSync/workspaceSyncTransaction";
import { createGitSyncTransport, type GitSyncTransport } from "./workspaceSync/gitSyncTransport";
import { createWorkspaceSyncService } from "./workspaceSync/workspaceSyncService";
import type { StartupStatus } from "../shared/types";
import { classifyStartupFailure, createStartupDiagnostics } from "./startupDiagnostics";
import { targetPathInputFor } from "./targets/pathInput";
import {
  createApplicationMenuTemplate,
  requestSettingsForWindow
} from "./applicationMenu";
import {
  constrainWindowState,
  readWindowState,
  writeWindowState,
  type PersistedWindowState
} from "./windowStateStore";

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
      const queryRef = parsed.searchParams.get("sha");
      if (queryRef && pathParts.length === 0) {
        const contentRoot = join(fixtureRoot, owner, repo, queryRef);
        try {
          await stat(contentRoot);
        } catch {
          return fileResponse("Not found", { status: 404, statusText: "Not Found" });
        }
        return fileResponse(JSON.stringify([
          { commit: { committer: { date: "2026-07-18T08:30:00Z" } } }
        ]), {
          headers: { "content-type": "application/json" }
        });
      }
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
    let entries;
    try {
      entries = await readdir(contentPath, { withFileTypes: true });
    } catch {
      return fileResponse("Not found", { status: 404, statusText: "Not Found" });
    }
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
    return fileResponse(JSON.stringify(body), {
      headers: { "content-type": "application/json" }
    });
  };
};

const approvedWindowCloses = new WeakSet<BrowserWindow>();
const guardedWindowCloses = new WeakSet<BrowserWindow>();
let appQuitRequested = false;
let servicesInitialized = false;
let disposeServices: (() => void) | undefined;
let startupStatus: StartupStatus = { state: "initializing" };
let startupAttempt: Promise<void> | undefined;
let startupDataRoot: string | undefined;
let startupDiagnostics: ReturnType<typeof createStartupDiagnostics> | undefined;
let lastWindowState: PersistedWindowState | undefined;
let windowStateSaveTimer: ReturnType<typeof setTimeout> | undefined;

const broadcastStartupStatus = () => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send("startup:status-changed", startupStatus);
    }
  }
};

ipcMain.handle("startup:status", () => startupStatus);
ipcMain.handle("startup:open-data-folder", async () => {
  if (!startupDataRoot) return;
  const error = await shell.openPath(startupDataRoot);
  if (error) throw new Error(error);
});
ipcMain.handle("startup:export-diagnostics", async () => {
  if (!startupDiagnostics) return undefined;
  await startupDiagnostics.record("diagnostics-exported");
  const result = await dialog.showSaveDialog({
    title: "Export AgentEnv diagnostics",
    defaultPath: `agentenv-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
    filters: [{ name: "Log", extensions: ["log"] }]
  });
  if (result.canceled || !result.filePath) return undefined;
  await startupDiagnostics.exportTo(result.filePath);
  return result.filePath;
});
ipcMain.on("startup:quit", () => app.quit());

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

const windowStatePath = () =>
  startupDataRoot ? join(startupDataRoot, "window-state.json") : undefined;

const captureWindowState = (win: BrowserWindow): PersistedWindowState => ({
  ...win.getNormalBounds(),
  maximized: win.isMaximized()
});

const saveWindowState = (win: BrowserWindow) => {
  const path = windowStatePath();
  if (!path || win.isDestroyed()) return;
  lastWindowState = captureWindowState(win);
  try {
    writeWindowState(path, lastWindowState);
  } catch (error) {
    console.warn(
      `[AgentEnv] Window state could not be saved: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

const scheduleWindowStateSave = (win: BrowserWindow) => {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = undefined;
    saveWindowState(win);
  }, 250);
};

const createWindow = () => {
  const restoredState = lastWindowState
    ? constrainWindowState(
        lastWindowState,
        screen.getDisplayMatching(lastWindowState).workArea
      )
    : undefined;
  const win = new BrowserWindow({
    width: restoredState?.width ?? 1180,
    height: restoredState?.height ?? 760,
    ...(restoredState
      ? { x: restoredState.x, y: restoredState.y }
      : {}),
    minWidth: 920,
    minHeight: 620,
    ...windowChromeOptionsFor(process.platform),
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
    saveWindowState(win);
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
  win.on("move", () => scheduleWindowStateSave(win));
  win.on("resize", () => scheduleWindowStateSave(win));
  win.on("maximize", () => scheduleWindowStateSave(win));
  win.on("unmaximize", () => scheduleWindowStateSave(win));

  win.webContents.on("did-start-loading", () => {
    guardedWindowCloses.delete(win);
  });
  win.webContents.on("render-process-gone", () => {
    guardedWindowCloses.delete(win);
    void startupDiagnostics?.record("renderer-process-gone");
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  if (restoredState?.maximized) win.maximize();
  return win;
};

const resolveStartupDataRoot = () => {
  const homeDir = process.env.AGENTENV_HOME ?? app.getPath("home");
  return resolveAppDataRoot({ homeDir, userDataDir: app.getPath("userData") });
};

const createServices = async (
  reportPhase: (phase: Extract<StartupStatus, { state: "initializing" }>["phase"]) => void
) => {
  const homeDir = process.env.AGENTENV_HOME ?? app.getPath("home");
  const operatingSystemCacheRoot =
    process.platform === "darwin"
      ? join(homeDir, "Library", "Caches")
      : process.platform === "win32"
        ? process.env.LOCALAPPDATA ?? app.getPath("sessionData")
        : process.env.XDG_CACHE_HOME ?? join(homeDir, ".cache");
  const appDataRoot = startupDataRoot ?? resolveStartupDataRoot();
  const mutationCoordinator = createMutationCoordinator(appDataRoot);
  reportPhase("preparing-data");
  await mutationCoordinator.runExclusive("Initialize AgentEnv data", async () => {
    await recoverPendingReplacementsInDirectory(join(appDataRoot, ".."));
    if (!process.env.AGENTENV_DATA_ROOT) {
      await migrateLegacyAppDataRoot({
        legacyRoot: legacyElectronAppDataRoot(app.getPath("userData")),
        nextRoot: appDataRoot
      });
    }
    await mkdir(appDataRoot, { recursive: true, mode: 0o700 });
    await chmod(appDataRoot, 0o700);
  });
  const paths = createPaths({
    appDataRoot,
    repositoryCacheDir: join(
      process.env.AGENTENV_CACHE_ROOT ?? join(operatingSystemCacheRoot, "agentenv-manager"),
      "repositories"
    ),
    skillSourceObservationsDir: join(
      process.env.AGENTENV_CACHE_ROOT ?? join(operatingSystemCacheRoot, "agentenv-manager"),
      "skill-source-observations"
    ),
    homeDir,
    fakeHomeRoot: process.env.AGENTENV_FAKE_HOME ?? join(appDataRoot, "fake-home")
  });
  const targetRegistry = createTargetRegistry();
  reportPhase("migrating-data");
  await mutationCoordinator.runExclusive("Migrate AgentEnv data", async () => {
    await migrateAppDataToV2(paths, targetRegistry);
    await ensureAppDataFormat(paths);
  });
  const settingsStore = createSettingsStore(paths, {
    supportedTargetIds: targetRegistry.list().map((target) => target.id)
  });
  const settings = await mutationCoordinator.runExclusive("Initialize Settings", () =>
    settingsStore.readSettings()
  );
  reportPhase("upgrading-skills");
  await mutationCoordinator.runExclusive("Upgrade Skill content hashes", () =>
    migrateSkillContentHashes(paths, {
      onWarning: (message) => startupDiagnostics?.record("skill-content-hash-upgrade-warning", message)
    })
  );
  let gitRunner: GitCommandRunner | undefined;
  let repositorySourcePromise: Promise<GitCliSkillSource> | undefined;
  let repositoryServicesDisposed = false;
  const loadRepositorySource = () => {
    if (repositoryServicesDisposed) {
      return Promise.reject(new Error("Repository service is shutting down"));
    }
    repositorySourcePromise ??= findExecutable("git", { homeDir: paths.homeDir }).then(
      (executablePath) => {
        if (repositoryServicesDisposed) {
          throw new Error("Repository service is shutting down");
        }
        if (!executablePath) {
          throw new Error(
            "System Git is unavailable. Install Xcode Command Line Tools or Git, then retry."
          );
        }
        gitRunner = createGitCommandRunner({ executablePath });
        const cache = createGitRepositoryCache({
          cacheRoot: paths.repositoryCacheDir,
          runner: gitRunner
        });
        return createGitCliSkillSource({ cache, runner: gitRunner });
      }
    );
    return repositorySourcePromise;
  };
  const repositorySource: GitCliSkillSource = {
    resolve: async (input, signal) => (await loadRepositorySource()).resolve(input, signal),
    scan: async (input, signal) => (await loadRepositorySource()).scan(input, signal),
    materialize: async (input, destination, signal) =>
      (await loadRepositorySource()).materialize(input, destination, signal)
  };
  const replacementRoots = new Set([paths.profilesDir, paths.skillsLibraryDir]);
  for (const adapter of targetRegistry.listAdapters()) {
    const targetPaths = adapter.createTargetPaths(
      targetPathInputFor(paths, settings, adapter.descriptor.id)
    );
    if (targetPaths.skillsDir) replacementRoots.add(targetPaths.skillsDir);
    if (targetPaths.agentsDir) replacementRoots.add(targetPaths.agentsDir);
    for (const scanDir of targetPaths.skillScanDirs ?? []) replacementRoots.add(scanDir);
    for (const location of targetPaths.skillLocations ?? []) replacementRoots.add(location.path);
  }
  reportPhase("recovering-writes");
  await mutationCoordinator.runExclusive("Recover interrupted writes", async () => {
    for (const root of replacementRoots) {
      await recoverPendingReplacementsInDirectory(root);
    }
  });
  const targetScope = createTargetScope(targetRegistry, settingsStore);
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
  const workspaceSyncTransaction = createWorkspaceSyncTransaction({ paths, backupStore });
  reportPhase("recovering-sync");
  await mutationCoordinator.runExclusive("Recover Workspace Sync", async () => {
    try {
      await workspaceSyncTransaction.recover();
    } catch (error) {
      console.error("Workspace Sync recovery needs user attention", error);
    }
  });
  const skillLibraryStore = createSkillLibraryStore(
    paths,
    settingsStore,
    {
      profileStore,
      authTokenProvider: githubAuthService.readAccessToken,
      targetPathsProvider: async () => {
        const currentSettings = await settingsStore.readSettings();
        return targetRegistry.listAdapters().map((adapter) =>
          adapter.createTargetPaths(
            targetPathInputFor(paths, currentSettings, adapter.descriptor.id)
          )
        );
      },
      runtimeSnapshotProvider: (targetPaths) => {
        const adapter = targetRegistry.listAdapters().find(
          (candidate) => candidate.descriptor.id === targetPaths.targetId
        );
        return adapter
          ? adapter.skills.inspectRuntime(targetPaths)
          : createFilesystemSkillDriver({ targetId: targetPaths.targetId })
              .inspectRuntime(targetPaths);
      },
      repositorySource,
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
  const activationService = createActivationService({
    paths,
    profileStore,
    targetRegistry,
    targetScope,
    settingsStore,
    skillLibraryStore
  });
  const targetDiscoveryService = createTargetDiscoveryService({
    paths,
    targetRegistry,
    targetScope,
    settingsStore
  });
  const targetCaptureService = createTargetCaptureService({
    paths,
    targetRegistry,
    profileStore,
    skillLibraryStore,
    targetDiscoveryService,
    targetScope,
    settingsStore
  });
  let loadedConversationService: Promise<ConversationService> | undefined;
  let conversationServiceDisposed = false;
  const loadConversationService = () => {
    if (conversationServiceDisposed) {
      return Promise.reject(new Error("Conversation service is shutting down"));
    }
    loadedConversationService ??= createConversationService({
      paths,
      targetRegistry,
      targetDiscoveryService,
      settingsStore,
      clipboard
    });
    return loadedConversationService;
  };
  const conversationService: ConversationService = {
    list: (input) => loadConversationService().then((service) => service.list(input)),
    read: (id, input) =>
      loadConversationService().then((service) => service.read(id, input)),
    refresh: () => loadConversationService().then((service) => service.refresh()),
    openOriginal: (id) =>
      loadConversationService().then((service) => service.openOriginal(id)),
    previewContinuation: (input) =>
      loadConversationService().then((service) => service.previewContinuation(input)),
    continue: (previewId) =>
      loadConversationService().then((service) => service.continue(previewId)),
    dispose: () => {
      conversationServiceDisposed = true;
      void loadedConversationService
        ?.then((service) => service.dispose())
        .catch(() => undefined);
    }
  };
  let syncTransport: GitSyncTransport | undefined;
  let syncTransportDisposed = false;
  const loadSyncTransport = async () => {
    if (syncTransportDisposed) throw new Error("Workspace Sync is shutting down");
    if (syncTransport) return syncTransport;
    const executablePath = await findExecutable("git", { homeDir: paths.homeDir });
    if (!executablePath) {
      throw new Error("System Git is unavailable. Install Xcode Command Line Tools or Git, then retry.");
    }
    syncTransport = createGitSyncTransport(createGitCommandRunner({ executablePath }));
    return syncTransport;
  };
  const workspaceSyncService = createWorkspaceSyncService({
    paths,
    codec: createPortableWorkspaceCodec({ paths, profileStore, skillLibraryStore }),
    stateStore: createWorkspaceSyncStateStore(paths),
    transaction: workspaceSyncTransaction,
    loadTransport: loadSyncTransport,
    targetPathsProvider: async () => {
      const currentSettings = await settingsStore.readSettings();
      return (await targetScope.listEnabledAdapters()).map((adapter) =>
        adapter.createTargetPaths(
          targetPathInputFor(paths, currentSettings, adapter.descriptor.id)
        )
      );
    },
    findManagedInstallPaths: skillLibraryStore.findManagedInstallPaths
  });

  reportPhase("preparing-workspace");
  if (!(await pathEntryExists(paths.workspaceSyncJournalPath))) {
    await mutationCoordinator.runExclusive("Initialize Profiles", () =>
      seedDefaultProfiles(paths, targetRegistry)
    );
  }

  return {
    paths,
    profileStore,
    backupStore,
    backupMaintenanceService,
    githubAuthService,
    settingsStore,
    skillLibraryStore,
    activationService,
    targetCaptureService,
    targetRegistry,
    targetDiscoveryService,
    conversationService,
    mutationCoordinator,
    workspaceSyncService,
    cancelRepositoryOperations: () => gitRunner?.cancelActive(),
    dispose: () => {
      repositoryServicesDisposed = true;
      syncTransportDisposed = true;
      workspaceSyncService.dispose();
      conversationService.dispose();
      gitRunner?.dispose();
    }
  };
};

const initializeServices = () => {
  if (servicesInitialized) return Promise.resolve();
  if (startupAttempt) return startupAttempt;
  startupStatus = { state: "initializing" };
  broadcastStartupStatus();
  startupAttempt = (async () => {
    await startupDiagnostics?.record("startup-begin", { dataRoot: startupDataRoot });
    try {
      const services = await createServices((phase) => {
        startupStatus = { state: "initializing", phase };
        broadcastStartupStatus();
      });
      let removeWorkspaceSyncFocusListener: () => void = () => undefined;
      registerIpcHandlers(services);
      if (process.env.AGENTENV_AUTOMATION !== "1") {
        let lastWorkspaceCheckAt = 0;
        const runWorkspaceCheck = () => {
          const now = Date.now();
          if (now - lastWorkspaceCheckAt < 5 * 60 * 1000) return;
          lastWorkspaceCheckAt = now;
          void services.workspaceSyncService
            .check()
            .catch((error) => console.error("Workspace Sync check failed", error));
        };
        app.on("browser-window-focus", runWorkspaceCheck);
        removeWorkspaceSyncFocusListener = () => app.off("browser-window-focus", runWorkspaceCheck);
        runWorkspaceCheck();
        const runBackupCleanup = async () => {
          await services.mutationCoordinator.runExclusive("Clean up backups", async () => {
            const settings = await services.settingsStore.readSettings();
            if (settings.backupRetentionDays !== null) {
              await services.backupMaintenanceService.cleanup();
            }
          });
        };
        void runBackupCleanup().catch((error) => console.error("Automatic backup cleanup failed", error));
        const timer = setInterval(() => {
          void runBackupCleanup().catch((error) => console.error("Automatic backup cleanup failed", error));
        }, 24 * 60 * 60 * 1000);
        timer.unref();
      }
      disposeServices = () => {
        removeWorkspaceSyncFocusListener();
        services.dispose();
      };
      servicesInitialized = true;
      startupStatus = { state: "ready" };
      await startupDiagnostics?.record("startup-ready");
      broadcastStartupStatus();
    } catch (error) {
      startupStatus = classifyStartupFailure(error, startupDataRoot);
      await startupDiagnostics?.record("startup-failed", error);
      broadcastStartupStatus();
    } finally {
      startupAttempt = undefined;
    }
  })();
  return startupAttempt;
};

ipcMain.handle("startup:retry", () => initializeServices());

const ownsSingleInstance =
  process.env.AGENTENV_AUTOMATION === "1" || app.requestSingleInstanceLock();

if (!ownsSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}

if (ownsSingleInstance) void app.whenReady().then(() => {
  startupDataRoot = resolveStartupDataRoot();
  const savedWindowState = readWindowState(join(startupDataRoot, "window-state.json"));
  if (savedWindowState) {
    lastWindowState = constrainWindowState(
      savedWindowState,
      screen.getDisplayMatching(savedWindowState).workArea
    );
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate({
    isDevelopment: Boolean(process.env.ELECTRON_RENDERER_URL),
    openSettings: () => requestSettingsForWindow(
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    )
  })));
  startupDiagnostics = createStartupDiagnostics({
    directory: join(app.getPath("logs"), "diagnostics"),
    homeDir: app.getPath("home")
  });
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  void initializeServices();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  appQuitRequested = true;
  disposeServices?.();
  disposeServices = undefined;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
