export interface SkillTagSuggestion {
  schemaVersion: 1;
  key: string;
  skillId: string;
  contentHash: string;
  vocabularyHash: string;
  locale: string;
  generatedAt: string;
  model: string;
  partial: boolean;
  tags: Array<{ tag: string; reason: string }>;
}

export interface SkillTagAnalysis {
  skillId: string;
  key: string;
  contentHash: string;
  partial: boolean;
  cached?: SkillTagSuggestion;
}

export interface SkillTagAnalysisBatch {
  items: SkillTagAnalysis[];
  errors: Array<{ skillId: string; message: string }>;
}

export interface SkillTagGenerateInput {
  skillId: string;
  expectedKey: string;
  requestId: string;
  expectedEndpoint: string;
  expectedModel: string;
  confirmed: boolean;
  locale: string;
  regenerate?: boolean;
}
