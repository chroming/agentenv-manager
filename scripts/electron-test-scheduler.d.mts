export interface VitestAssertionResult {
  fullName: string;
  status: string;
  [key: string]: unknown;
}

export interface VitestFileResult {
  assertionResults: VitestAssertionResult[];
  name: string;
  status: string;
  [key: string]: unknown;
}

export interface VitestReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  success: boolean;
  testResults: VitestFileResult[];
  [key: string]: unknown;
}

export function partitionTestNames(names: string[], requestedShardCount: number): string[][];
export function executedAssertionsFromReport(report: VitestReport): VitestAssertionResult[];
export function assertExactTestCoverage(expectedNames: string[], executedNames: string[]): void;
export function mergeVitestReports(reports: VitestReport[]): VitestReport;
export function runElectronTestSuite(options: {
  heavyFile: string;
  outputFile?: string;
  projectRoot: string;
  testFiles: string[];
  vitestEntry: string;
}): Promise<VitestReport>;
