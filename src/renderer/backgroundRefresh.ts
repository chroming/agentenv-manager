// Use only for readback after the authoritative operation has finished.
export const refreshInBackground = (
  refresh: () => unknown | Promise<unknown>,
  onError: (error: unknown) => void = (error) => console.warn("[AgentEnv] View refresh failed", error)
) => {
  void Promise.resolve().then(refresh).catch(onError);
};
