export const AGENTENV_RUNTIME_VERSION = 6;

export const isAgentEnvRuntimeCompatible = (version: unknown) =>
  version === AGENTENV_RUNTIME_VERSION;
