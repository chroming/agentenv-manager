import { contextBridge, ipcRenderer } from "electron";
import type { AgentEnvApi } from "../shared/types";

const api: AgentEnvApi = {
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  readProfile: (id) => ipcRenderer.invoke("profiles:read", id),
  saveProfile: (input) => ipcRenderer.invoke("profiles:save", input),
  previewApply: (profileId) => ipcRenderer.invoke("activation:preview", profileId),
  applyProfile: (profileId, previewId) =>
    ipcRenderer.invoke("activation:apply", profileId, previewId),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  previewRollback: (backupId) => ipcRenderer.invoke("rollback:preview", backupId),
  rollback: (backupId) => ipcRenderer.invoke("rollback:apply", backupId)
};

contextBridge.exposeInMainWorld("agentEnv", api);
