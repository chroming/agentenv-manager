import { contextBridge, ipcRenderer } from "electron";
import type { AgentEnvApi } from "../shared/types";

const api: AgentEnvApi = {
  onWindowCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("window:close-requested", listener);
    return () => ipcRenderer.off("window:close-requested", listener);
  },
  setWindowCloseGuard: (enabled) => ipcRenderer.send("window:set-close-guard", enabled),
  confirmWindowClose: () => ipcRenderer.send("window:confirm-close"),
  cancelWindowClose: () => ipcRenderer.send("window:cancel-close"),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  selectSkillFolder: () => ipcRenderer.invoke("dialog:select-skill-folder"),
  listTargets: () => ipcRenderer.invoke("targets:list"),
  listTargetStates: () => ipcRenderer.invoke("targets:list-states"),
  listSkillLibrary: () => ipcRenderer.invoke("skills:list-library"),
  scanSkillInventory: () => ipcRenderer.invoke("skills:scan-inventory"),
  listSkillCleanupBackups: () => ipcRenderer.invoke("skills:list-cleanup-backups"),
  ignoreSkillGroup: (skillKey) => ipcRenderer.invoke("skills:ignore-group", skillKey),
  unignoreSkillGroup: (skillKey) => ipcRenderer.invoke("skills:unignore-group", skillKey),
  listMcpLibrary: () => ipcRenderer.invoke("mcp:list-library"),
  saveMcpServer: (input) => ipcRenderer.invoke("mcp:save-library", input),
  removeMcpServer: (id) => ipcRenderer.invoke("mcp:remove-library", id),
  scanUnmanagedSkills: () => ipcRenderer.invoke("skills:scan-unmanaged"),
  importSkillToLibrary: (input) => ipcRenderer.invoke("skills:import-library", input),
  importGitHubSkillToLibrary: (input) => ipcRenderer.invoke("skills:import-github", input),
  scanGitHubSkills: (url) => ipcRenderer.invoke("skills:scan-github", url),
  importGitHubSkills: (inputs) => ipcRenderer.invoke("skills:import-github-batch", inputs),
  removeSkillFromLibrary: (id) => ipcRenderer.invoke("skills:remove-library", id),
  manageTargetSkill: (input) => ipcRenderer.invoke("skills:manage-target", input),
  consolidateSkillGroup: (input) => ipcRenderer.invoke("skills:consolidate-group", input),
  setSharedSkillRetention: (input) => ipcRenderer.invoke("skills:set-shared-retention", input),
  retireSharedSkill: (input) => ipcRenderer.invoke("skills:retire-shared", input),
  rollbackSkillCleanup: (backupId) => ipcRenderer.invoke("skills:rollback-cleanup", backupId),
  checkSkillLibraryUpdates: (ids) => ipcRenderer.invoke("skills:check-updates", ids),
  setSkillUpdateSource: (input) => ipcRenderer.invoke("skills:set-update-source", input),
  setSkillUpdatePolicy: (input) => ipcRenderer.invoke("skills:set-update-policy", input),
  setSkillAvailability: (input) => ipcRenderer.invoke("skills:set-availability", input),
  setSkillIcon: (input) => ipcRenderer.invoke("skills:set-icon", input),
  previewLibrarySkillUpdate: (id) => ipcRenderer.invoke("skills:preview-update", id),
  updateLibrarySkill: (id) => ipcRenderer.invoke("skills:update-library", id),
  readSettings: () => ipcRenderer.invoke("settings:read"),
  updateSettings: (input) => ipcRenderer.invoke("settings:update", input),
  readGitHubAuthStatus: () => ipcRenderer.invoke("github:status"),
  startGitHubDeviceLogin: () => ipcRenderer.invoke("github:start-device-login"),
  pollGitHubDeviceLogin: (id) => ipcRenderer.invoke("github:poll-device-login", id),
  signOutGitHub: () => ipcRenderer.invoke("github:sign-out"),
  openGitHubDevicePage: (url) => ipcRenderer.invoke("github:open-device-page", url),
  openExternalUrl: (url) => ipcRenderer.invoke("external:open-url", url),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  readProfile: (id) => ipcRenderer.invoke("profiles:read", id),
  saveProfile: (input) => ipcRenderer.invoke("profiles:save", input),
  createProfile: (input) => ipcRenderer.invoke("profiles:create", input),
  previewCreateProfileFromTarget: (targetId) =>
    ipcRenderer.invoke("profiles:preview-create-from-target", targetId),
  createProfileFromTarget: (input) =>
    ipcRenderer.invoke("profiles:create-from-target", input),
  duplicateProfile: (id) => ipcRenderer.invoke("profiles:duplicate", id),
  deleteProfile: (id) => ipcRenderer.invoke("profiles:delete", id),
  previewApply: (profileId, targetId) =>
    ipcRenderer.invoke("activation:preview", profileId, targetId),
  applyProfile: (profileId, previewId, options) =>
    ipcRenderer.invoke("activation:apply", profileId, previewId, options),
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
  openDataFolder: () => ipcRenderer.invoke("data:open-folder"),
  selectDataRestore: () => ipcRenderer.invoke("data:select-restore"),
  restoreDataBackup: (path) => ipcRenderer.invoke("data:restore", path),
  adoptTargetInstructions: (profileId, targetId) =>
    ipcRenderer.invoke("targets:adopt-instructions", profileId, targetId)
};

contextBridge.exposeInMainWorld("agentEnv", api);
