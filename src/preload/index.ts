import { contextBridge, ipcRenderer } from "electron";
import type { AgentEnvApi } from "../shared/types";
import { AGENTENV_RUNTIME_VERSION } from "../shared/runtimeVersion";

const api: AgentEnvApi = {
  runtimeVersion: AGENTENV_RUNTIME_VERSION,
  platform: process.platform,
  readStartupStatus: () => ipcRenderer.invoke("startup:status"),
  onStartupStatusChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status);
    ipcRenderer.on("startup:status-changed", listener);
    return () => ipcRenderer.off("startup:status-changed", listener);
  },
  retryStartup: () => ipcRenderer.invoke("startup:retry"),
  openStartupDataFolder: () => ipcRenderer.invoke("startup:open-data-folder"),
  exportStartupDiagnostics: () => ipcRenderer.invoke("startup:export-diagnostics"),
  quitApp: () => ipcRenderer.send("startup:quit"),
  onWindowCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("window:close-requested", listener);
    return () => ipcRenderer.off("window:close-requested", listener);
  },
  setWindowCloseGuard: (enabled) => ipcRenderer.send("window:set-close-guard", enabled),
  confirmWindowClose: () => ipcRenderer.send("window:confirm-close"),
  cancelWindowClose: () => ipcRenderer.send("window:cancel-close"),
  openContextMenu: (items) => ipcRenderer.invoke("menu:open-context", items),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  selectSkillFolder: () => ipcRenderer.invoke("dialog:select-skill-folder"),
  selectLocalSkillSource: () => ipcRenderer.invoke("dialog:select-local-skill-source"),
  releaseSkillArchive: (token) => ipcRenderer.invoke("skills:release-archive", token),
  selectTargetConfigRoot: (targetId) => ipcRenderer.invoke("dialog:select-target-config-root", targetId),
  listSupportedTargets: () => ipcRenderer.invoke("targets:list-supported"),
  listTargets: (forceRefresh) => ipcRenderer.invoke("targets:list", forceRefresh),
  listTargetStates: () => ipcRenderer.invoke("targets:list-states"),
  listNativeMcpConnections: () =>
    ipcRenderer.invoke("targets:list-native-mcps"),
  listSkillLibrary: () => ipcRenderer.invoke("skills:list-library"),
  listSkillFiles: (id) => ipcRenderer.invoke("skills:list-files", id),
  readSkillFile: (input) => ipcRenderer.invoke("skills:read-file", input),
  scanSkillInventory: () => ipcRenderer.invoke("skills:scan-inventory"),
  listSkillCleanupBackups: () => ipcRenderer.invoke("skills:list-cleanup-backups"),
  setSkillPathPolicies: (input) => ipcRenderer.invoke("skills:set-path-policies", input),
  scanUnmanagedSkills: () => ipcRenderer.invoke("skills:scan-unmanaged"),
  scanLocalSkillSource: (rootPath) => ipcRenderer.invoke("skills:scan-local-source", rootPath),
  previewSkillImport: (input) => ipcRenderer.invoke("skills:preview-import", input),
  previewSkillMerge: (id) => ipcRenderer.invoke("skills:preview-merge", id),
  mergeLibrarySkills: (input) => ipcRenderer.invoke("skills:merge-library", input),
  importSkillToLibrary: (input) => ipcRenderer.invoke("skills:import-library", input),
  importGitHubSkillToLibrary: (input) => ipcRenderer.invoke("skills:import-github", input),
  scanGitHubSkills: (url) => ipcRenderer.invoke("skills:scan-github", url),
  importGitHubSkills: (inputs) => ipcRenderer.invoke("skills:import-github-batch", inputs),
  scanRepositorySkills: (input) => ipcRenderer.invoke("skills:scan-repository", input),
  importRepositorySkillToLibrary: (input) =>
    ipcRenderer.invoke("skills:import-repository", input),
  importRepositorySkills: (inputs) =>
    ipcRenderer.invoke("skills:import-repository-batch", inputs),
  listSkillSourceGroups: () => ipcRenderer.invoke("skills:list-source-groups"),
  checkSkillSourceGroup: (sourceId) =>
    ipcRenderer.invoke("skills:check-source-group", sourceId),
  checkMonitoredSkillSourceGroups: () => ipcRenderer.invoke("skills:check-monitored-source-groups"),
  setSkillSourceName: (input) => ipcRenderer.invoke("skills:set-source-name", input),
  setSkillSourceMonitored: (input) =>
    ipcRenderer.invoke("skills:set-source-monitored", input),
  previewSkillSourceMerge: (input) => ipcRenderer.invoke("skills:preview-source-merge", input),
  mergeSkillSources: (previewId) => ipcRenderer.invoke("skills:merge-sources", previewId),
  cancelRepositoryOperations: () => ipcRenderer.invoke("skills:cancel-repository"),
  removeSkillFromLibrary: (id) => ipcRenderer.invoke("skills:remove-library", id),
  manageTargetSkill: (input) => ipcRenderer.invoke("skills:manage-target", input),
  consolidateSkillGroup: (input) => ipcRenderer.invoke("skills:consolidate-group", input),
  setSharedSkillRetention: (input) => ipcRenderer.invoke("skills:set-shared-retention", input),
  retireSharedSkill: (input) => ipcRenderer.invoke("skills:retire-shared", input),
  rollbackSkillCleanup: (backupId) => ipcRenderer.invoke("skills:rollback-cleanup", backupId),
  checkSkillLibraryUpdates: (ids) => ipcRenderer.invoke("skills:check-updates", ids),
  setSkillUpdateSettings: (input) => ipcRenderer.invoke("skills:set-update-settings", input),
  setSkillAvailability: (input) => ipcRenderer.invoke("skills:set-availability", input),
  setSkillIcon: (input) => ipcRenderer.invoke("skills:set-icon", input),
  previewLibrarySkillUpdate: (id) => ipcRenderer.invoke("skills:preview-update", id),
  previewLibrarySkillUpdates: (ids) => ipcRenderer.invoke("skills:preview-updates", ids),
  updateLibrarySkill: (input) => ipcRenderer.invoke("skills:update-library", input),
  readSettings: () => ipcRenderer.invoke("settings:read"),
  updateSettings: (input) => ipcRenderer.invoke("settings:update", input),
  readWorkspaceSyncStatus: () => ipcRenderer.invoke("workspace-sync:status"),
  connectWorkspaceSync: (input) => ipcRenderer.invoke("workspace-sync:connect", input),
  checkWorkspaceSync: () => ipcRenderer.invoke("workspace-sync:check"),
  reviewWorkspaceSync: () => ipcRenderer.invoke("workspace-sync:review"),
  updateWorkspaceFromSync: (input) => ipcRenderer.invoke("workspace-sync:update", input),
  publishWorkspaceSync: () => ipcRenderer.invoke("workspace-sync:publish"),
  recoverWorkspaceSync: () => ipcRenderer.invoke("workspace-sync:recover"),
  disconnectWorkspaceSync: () => ipcRenderer.invoke("workspace-sync:disconnect"),
  readGitHubAuthStatus: () => ipcRenderer.invoke("github:status"),
  startGitHubDeviceLogin: () => ipcRenderer.invoke("github:start-device-login"),
  pollGitHubDeviceLogin: (id) => ipcRenderer.invoke("github:poll-device-login", id),
  signOutGitHub: () => ipcRenderer.invoke("github:sign-out"),
  openGitHubDevicePage: (url) => ipcRenderer.invoke("github:open-device-page", url),
  openExternalUrl: (url) => ipcRenderer.invoke("external:open-url", url),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  readProfile: (id) => ipcRenderer.invoke("profiles:read", id),
  saveProfile: (input) => ipcRenderer.invoke("profiles:save", input),
  updateProfileSkills: (input) => ipcRenderer.invoke("profiles:update-skills", input),
  forkProfileSkills: (input) => ipcRenderer.invoke("profiles:fork-skills", input),
  updateProfileMetadata: (input) => ipcRenderer.invoke("profiles:update-metadata", input),
  createProfile: (input) => ipcRenderer.invoke("profiles:create", input),
  previewCreateProfileFromTarget: (targetId, scope) =>
    ipcRenderer.invoke("profiles:preview-create-from-target", targetId, scope),
  createProfileFromTarget: (input) =>
    ipcRenderer.invoke("profiles:create-from-target", input),
  duplicateProfile: (id) => ipcRenderer.invoke("profiles:duplicate", id),
  deleteProfile: (id) => ipcRenderer.invoke("profiles:delete", id),
  previewApply: (profileId, targetId) =>
    ipcRenderer.invoke("activation:preview", profileId, targetId),
  applyProfile: (profileId, previewId) =>
    ipcRenderer.invoke("activation:apply", profileId, previewId),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  listManagedBackups: () => ipcRenderer.invoke("backups:list-managed"),
  deleteManagedBackup: (input) => ipcRenderer.invoke("backups:delete-managed", input),
  cleanupManagedBackups: () => ipcRenderer.invoke("backups:cleanup-managed"),
  previewRollback: (backupId) => ipcRenderer.invoke("rollback:preview", backupId),
  rollback: (backupId) => ipcRenderer.invoke("rollback:apply", backupId),
  previewStopManaging: (targetId, mode) =>
    ipcRenderer.invoke("targets:preview-stop-managing", targetId, mode),
  stopManaging: (previewId) => ipcRenderer.invoke("targets:stop-managing", previewId),
  createDataBackup: () => ipcRenderer.invoke("data:create-backup"),
  readDataRoot: () => ipcRenderer.invoke("data:root"),
  openDataFolder: () => ipcRenderer.invoke("data:open-folder"),
  selectDataRestore: () => ipcRenderer.invoke("data:select-restore"),
  restoreDataBackup: (path) => ipcRenderer.invoke("data:restore", path),
  adoptTargetChanges: (profileId, targetId) =>
    ipcRenderer.invoke("targets:adopt-changes", profileId, targetId)
};

contextBridge.exposeInMainWorld("agentEnv", api);
