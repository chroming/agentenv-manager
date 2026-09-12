import { z } from "zod";

export const HistorySourceSchema = z.object({
  id: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128),
  agentId: z.string().min(1).max(80),
  root: z.string().min(1).max(4096),
  kind: z.enum(["default", "directory"])
}).strict();
export const HistorySearchConfigSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  paused: z.boolean(),
  sources: z.array(HistorySourceSchema).max(200)
}).strict();
export type HistorySource = z.infer<typeof HistorySourceSchema>;
export type HistorySearchConfig = z.infer<typeof HistorySearchConfigSchema>;
export interface HistoryOrigin {
  sourceKey: string;
  deviceId: string;
  deviceName: string;
  connection?: string;
  historyPath: string;
  runtimeHome?: string;
  parentSessionId?: string;
  readOnly?: boolean;
}
export interface HistorySourceProgress {
  sourceKey: string;
  phase: "pending" | "indexing" | "ready" | "partial" | "unavailable";
  discovered: number;
  indexed: number;
  failed: number;
  summaryOnly: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  issues: string[];
}
export interface HistorySearchStatus {
  config: HistorySearchConfig;
  needsConsent: boolean;
  settingsIssue?: string;
  running: boolean;
  sources: HistorySourceProgress[];
  availableSources: Array<HistorySource & { deviceName: string; agentName: string }>;
}
