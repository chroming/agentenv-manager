declare global {
  interface Window {
    agentEnv: import("../shared/types").AgentEnvApi;
  }
}

export {};
