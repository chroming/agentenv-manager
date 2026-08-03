export type AppInstallChannel =
  | "homebrew"
  | "direct"
  | "development"
  | "unsupported";

export type AppUpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "failed";

export interface AppUpdateRelease {
  version: string;
  tag: string;
  releaseUrl: string;
  publishedAt: string;
  notes?: string;
}

export interface AppUpdateStatus {
  phase: AppUpdatePhase;
  currentVersion: string;
  installChannel: AppInstallChannel;
  automaticInstallSupported: boolean;
  checkedAt?: string;
  release?: AppUpdateRelease;
  failureCode?: string;
  message?: string;
}
