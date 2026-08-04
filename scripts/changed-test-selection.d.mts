export interface QuickVerificationSelection {
  audits: string[];
  extraTests: string[];
  relatedFiles: string[];
  runElectron: false;
}

export function selectQuickVerification(changedFiles: string[]): QuickVerificationSelection;
