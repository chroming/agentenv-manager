import { contextBridge, ipcRenderer } from "electron";
import type { AgentEnvApi } from "../shared/types";

const api: AgentEnvApi = {
  listTargets: () => ipcRenderer.invoke("targets:list"),
  listSkillLibrary: () => ipcRenderer.invoke("skills:list-library"),
  scanUnmanagedSkills: () => ipcRenderer.invoke("skills:scan-unmanaged"),
  importSkillToLibrary: (sourcePath) => ipcRenderer.invoke("skills:import-library", sourcePath),
  updateLibrarySkill: (id) => ipcRenderer.invoke("skills:update-library", id),
  readSettings: () => ipcRenderer.invoke("settings:read"),
  updateSettings: (input) => ipcRenderer.invoke("settings:update", input),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  readProfile: (id) => ipcRenderer.invoke("profiles:read", id),
  saveProfile: (input) => ipcRenderer.invoke("profiles:save", input),
  createProfile: (targetId) => ipcRenderer.invoke("profiles:create", targetId),
  previewApply: (profileId) => ipcRenderer.invoke("activation:preview", profileId),
  applyProfile: (profileId, previewId) =>
    ipcRenderer.invoke("activation:apply", profileId, previewId),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  previewRollback: (backupId) => ipcRenderer.invoke("rollback:preview", backupId),
  rollback: (backupId) => ipcRenderer.invoke("rollback:apply", backupId)
};

contextBridge.exposeInMainWorld("agentEnv", api);
