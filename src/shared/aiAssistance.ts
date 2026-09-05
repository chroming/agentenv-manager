export const aiFeatures = ["summaries", "tags", "comparison", "duplicates", "profile"] as const;
export type AIFeature = typeof aiFeatures[number];
export type AIAnalysisKind = "comparison" | "duplicates" | "profile";
export interface AIPreferences { enabled: boolean; features: Record<AIFeature, boolean> }
export const defaultAIPreferences = (): AIPreferences => ({ enabled: true,
  features: { summaries: true, tags: true, comparison: true, duplicates: true, profile: true } });
export interface AIAnalysisDocument { id: string; label: string; content: string }
export type AIAnalysisSubject =
  | { kind: "profile"; profileId: string; targetId: string }
  | { kind: "comparison"; runId: string }
  | { kind: "duplicates"; documents: AIAnalysisDocument[] };
export interface AIAnalysisRecord {
  schemaVersion: 1; key: string; kind: AIAnalysisKind; locale: string;
  generatedAt: string; endpoint: string; model: string; overview: string;
  findings: Array<{ category: "observation" | "suggestion" | "risk"; detail: string; suggestion: string; evidence: string[] }>;
  limitations: string[]; documents: AIAnalysisDocument[]; partial: boolean;
}
export interface AIAnalysisPreview {
  key: string; documents: AIAnalysisDocument[]; partial: boolean; warnings: string[];
  cached?: AIAnalysisRecord;
}
export interface AIAnalysisGenerateInput {
  subject: AIAnalysisSubject; locale: string; expectedKey: string; requestId: string;
  confirmed: true; expectedEndpoint: string; expectedModel: string; regenerate?: boolean;
}
