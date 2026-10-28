export const aiResponseIssues = ["unclassified", "invalid-items", "truncated"] as const;
export type AIResponseIssue = typeof aiResponseIssues[number];
export interface AIResultQuality {
  responseIssues?: AIResponseIssue[];
  unparsedOutput?: string;
  savePending?: boolean;
}
export type AIRequestPhase = "preparing" | "waiting" | "receiving" | "parsing" | "saving";
export interface AIRequestProgress { requestId: string; phase: AIRequestPhase }
