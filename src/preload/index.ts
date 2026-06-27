import { contextBridge, ipcRenderer } from "electron";
import type { AgentEnvApi } from "../shared/types";

const api: AgentEnvApi = {
  listProfiles: () => ipcRenderer.invoke("profiles:list")
};

contextBridge.exposeInMainWorld("agentEnv", api);
