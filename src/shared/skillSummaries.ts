export interface SkillSummaryConfig {
  endpoint: string;
  model: string;
  hasKey: boolean;
}

export interface SkillSummaryConfigInput {
  endpoint: string;
  model: string;
  apiKey?: string;
}

export type SkillSummaryCategory = "important" | "usage" | "security" | "other";

export interface SkillSummary {
  schemaVersion: 1;
  key: string;
  skillId: string;
  beforeHash: string;
  afterHash: string;
  generatedAt: string;
  model: string;
  overview: string;
  items: Array<{
    category: SkillSummaryCategory;
    fact: string;
    implication: string;
    paths: string[];
  }>;
  coverage: "complete" | "partial";
  omittedPaths: string[];
  redacted: boolean;
  files: Array<{ path: string; diff: string }>;
  usage?: { inputTokens?: number; outputTokens?: number };
  context?: string;
  changeInventory?: Array<{ path: string; action: "added" | "removed" | "modified"; coverage: "full" | "partial" | "omitted" }>;
  timings?: { preparationMs: number; requestMs: number };
}

export interface SkillSummaryGenerateInput {
  previewId: string;
  requestId: string;
  expectedEndpoint: string;
  expectedModel: string;
  confirmed: boolean;
  regenerate?: boolean;
  locale: string;
}

export interface SkillSummaryInput {
  skillId: string;
  beforeHash: string;
  afterHash: string;
  files: Array<{ path: string; diff: string }>;
  omittedPaths: string[];
  context?: string;
  changeInventory?: SkillSummary["changeInventory"];
}
