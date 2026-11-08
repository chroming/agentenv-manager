export function startReleaseDownloads(options?: {
  fetchAsset?: typeof fetch;
  log?: Pick<Console, "warn" | "error">;
}): Promise<{ origin: string; close: () => Promise<void> }>;
