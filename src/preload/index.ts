import { contextBridge, ipcRenderer } from "electron";
import type { AgentEnvApi } from "../shared/types";

const api: AgentEnvApi = {
  listTargets: () => ipcRenderer.invoke("targets:list"),
  listSkillLibrary: () => ipcRenderer.invoke("skills:list-library"),
  scanSkillInventory: () => ipcRenderer.invoke("skills:scan-inventory"),
  listMcpLibrary: () => ipcRenderer.invoke("mcp:list-library"),
  saveMcpServer: (input) => ipcRenderer.invoke("mcp:save-library", input),
  removeMcpServer: (id) => ipcRenderer.invoke("mcp:remove-library", id),
  scanUnmanagedSkills: () => ipcRenderer.invoke("skills:scan-unmanaged"),
  importSkillToLibrary: (sourcePath) => ipcRenderer.invoke("skills:import-library", sourcePath),
  importGitHubSkillToLibrary: (input) => ipcRenderer.invoke("skills:import-github", input),
  manageTargetSkill: (input) => ipcRenderer.invoke("skills:manage-target", input),
  checkSkillLibraryUpdates: () => ipcRenderer.invoke("skills:check-updates"),
  setSkillUpdateSource: (input) => ipcRenderer.invoke("skills:set-update-source", input),
  previewLibrarySkillUpdate: (id) => ipcRenderer.invoke("skills:preview-update", id),
  updateLibrarySkill: (id) => ipcRenderer.invoke("skills:update-library", id),
  readSettings: () => ipcRenderer.invoke("settings:read"),
  updateSettings: (input) => ipcRenderer.invoke("settings:update", input),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  readProfile: (id) => ipcRenderer.invoke("profiles:read", id),
  saveProfile: (input) => ipcRenderer.invoke("profiles:save", input),
  createProfile: (input) => ipcRenderer.invoke("profiles:create", input),
  duplicateProfile: (id) => ipcRenderer.invoke("profiles:duplicate", id),
  deleteProfile: (id) => ipcRenderer.invoke("profiles:delete", id),
  previewApply: (profileId) => ipcRenderer.invoke("activation:preview", profileId),
  applyProfile: (profileId, previewId) =>
    ipcRenderer.invoke("activation:apply", profileId, previewId),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  previewRollback: (backupId) => ipcRenderer.invoke("rollback:preview", backupId),
  rollback: (backupId) => ipcRenderer.invoke("rollback:apply", backupId)
};

contextBridge.exposeInMainWorld("agentEnv", api);
