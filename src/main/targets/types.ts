import type {
  ApplyIssue,
  ConversationDetail,
  ConversationDetailState,
  NativeMcpConnection,
  ManagedResourceSnapshot,
  ProfileDetail,
  TargetActivationPreview,
  TargetDescriptor,
  TargetExecutableStatus,
  TargetInstallationEvidence,
  TargetPaths,
  SkillRuntimeNativeState,
  SkillRuntimeSnapshot
} from "../../shared/types";
import type {
  OneShotEvaluationFidelity,
  OneShotEvaluationUsage
} from "../../shared/evaluations";

export interface TargetPathInput {
  homeDir: string;
  fakeHomeRoot?: string;
  rootDirOverride?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}

export type TargetMutationClaimer = ((path: string) => Promise<void>) & {
  recordMutation?: (...paths: string[]) => Promise<void>;
};

export interface TargetAssetInput {
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  skillLibraryDir?: string;
  skillSyncMethod?: "symlink" | "copy" | "auto";
  approvedUnmanagedSkillHashes?: ReadonlyMap<string, string>;
  replaceablePaths?: ReadonlySet<string>;
  managedResources?: readonly ManagedResourceSnapshot[];
  plannedResourceWrites?: ReadonlySet<string>;
  plannedResourceRemovals?: ReadonlySet<string>;
  isolateSkillRoot?: boolean;
  claimMutationPath?: TargetMutationClaimer;
}

export interface TargetPreviewInput extends TargetAssetInput {
  state: {
    managedMcpNames: string[];
  };
}

export interface CapturedTargetProfile {
  instructions: string;
  mcpConnections?: NativeMcpConnection[];
  warnings: string[];
  excluded: string[];
}

export interface TargetInstallationInput {
  platform: NodeJS.Platform;
  homeDir: string;
  allowSystemApplicationLookup: boolean;
  findExecutable(name: string): Promise<string | undefined>;
  pathExists(path: string): Promise<boolean>;
  findMacApplicationsByBundleIdentifier?(bundleIdentifier: string): Promise<string[]>;
  readMacApplicationBundleIdentifier?(applicationPath: string): Promise<string | undefined>;
  probeExecutable?(
    executablePath: string,
    args?: string[]
  ): Promise<{
    status: TargetExecutableStatus;
    version?: string;
    error?: string;
  }>;
}

export interface TargetInstallationResult {
  found: boolean;
  evidence: TargetInstallationEvidence[];
  runtime?: {
    source: "bundled-runtime";
    label: string;
    path: string;
    status: TargetExecutableStatus;
    version?: string;
    error?: string;
  };
}

export interface AgentConversationCandidate {
  recordId: string;
  source: {
    version: string;
    locator: string;
    runtimeHome?: string;
  };
  providerSession?: {
    kind: "native" | "file" | "database";
    id: string;
    resumeLocator?: string;
  };
  title?: string;
  snippet?: string;
  workspacePath?: string;
  createdAt?: string;
  updatedAt: string;
  messageCount?: number;
  detailState: ConversationDetailState;
  archived?: boolean;
}

export interface AgentConversationContext {
  homeDir: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  executablePath?: string;
  targetPaths: TargetPaths;
}

export interface AgentLaunchSpec {
  executablePath: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  envToDelete?: string[];
}

export interface ConversationLaunchSpec extends AgentLaunchSpec {
  resumeAfterExit?: {
    kind: "json-session";
    sessionIdField: string;
    argsBeforeSessionId: string[];
    argsAfterSessionId?: string[];
  };
}

export type ProjectSupportLevel = "supported" | "partial" | "unsupported";

export interface ProjectResourceSupport {
  inspect: ProjectSupportLevel;
  mutate: ProjectSupportLevel;
}

export interface ProjectCapabilitySupport {
  instructions: ProjectResourceSupport;
  skills: ProjectResourceSupport;
  mcp: ProjectResourceSupport;
  effectivePreview: ProjectSupportLevel;
  cliLaunch: ProjectSupportLevel;
}

export interface ProjectLaunchInput {
  executablePath?: string;
  projectRoot: string;
}

export interface ProjectSkillLocationDeclaration {
  relativePath: string;
  scope: "shared" | "agent-specific";
  writable: boolean;
  priority: number;
}

export interface AgentProjectCapability {
  support: ProjectCapabilitySupport;
  instructionFiles: readonly string[];
  instructionCreateFile?: string;
  skillLocations: readonly ProjectSkillLocationDeclaration[];
  mcpFiles: readonly string[];
  compareResourcePaths: readonly string[];
  createLaunchSpec(input: ProjectLaunchInput): AgentLaunchSpec | undefined;
}

export interface ConversationContinuationInput extends AgentConversationContext {
  conversation: ConversationDetail;
  contextFilePath: string;
}

export interface ConversationMoveCommit {
  rollback(): Promise<void>;
  finalize?(): Promise<void>;
}

export interface ConversationMoveCheck {
  warnings?: string[];
}

export interface ConversationMoveAdapterInput extends AgentConversationContext {
  candidate: AgentConversationCandidate;
  destinationPath: string;
}

export interface AgentConversationCapability {
  historyDetail: ConversationDetailState;
  discover(context: AgentConversationContext): Promise<{
    candidates: AgentConversationCandidate[];
    complete: boolean;
    failures?: string[];
  }>;
  read(
    context: AgentConversationContext,
    candidate: AgentConversationCandidate,
    previous?: {
      detail: ConversationDetail;
      sourceVersion: string;
    }
  ): Promise<ConversationDetail>;
  openOriginal?(
    context: AgentConversationContext,
    candidate: AgentConversationCandidate
  ): ConversationLaunchSpec | undefined;
  continueWithContext?(
    input: ConversationContinuationInput
  ): ConversationLaunchSpec | undefined;
  checkMove?(
    input: ConversationMoveAdapterInput
  ): Promise<ConversationMoveCheck>;
  move?(
    input: ConversationMoveAdapterInput
  ): Promise<ConversationMoveCommit>;
}

export interface EvaluationProbeInput {
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  sourceHomeDir: string;
  executablePath?: string;
  knownCliVersion?: string;
  excludeMcp: boolean;
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
}

export interface EvaluationAvailability {
  available: boolean;
  reason?: string;
  cliVersion?: string;
  fidelity: OneShotEvaluationFidelity;
  mcpIncludedCount: number;
  mcpOmittedCount: number;
  requiresMcpExclusion: boolean;
  warnings: string[];
}

export interface EvaluationLaunchInput extends EvaluationProbeInput {
  evaluationHome: string;
  evaluationProject: string;
  evaluationTargetPaths: TargetPaths;
  evaluationTempDir: string;
  prompt: string;
}

export interface EvaluationLaunchSpec {
  executablePath: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  envToDelete?: string[];
  writableRoot: string;
  readDeniedRoots?: string[];
  runtimeReadRoots?: string[];
  cliVersion?: string;
  model?: string;
  fidelity: OneShotEvaluationFidelity;
  warnings: string[];
}

export type EvaluationEvent =
  | {
      type: "response";
      text: string;
      usage?: OneShotEvaluationUsage;
      model?: string;
    }
  | { type: "usage"; usage: OneShotEvaluationUsage; model?: string }
  | { type: "error"; message: string };

export interface AgentEvaluationCapability {
  projectResourcePaths?: readonly string[];
  checkAvailability(input: EvaluationProbeInput): Promise<EvaluationAvailability>;
  createLaunchSpec(input: EvaluationLaunchInput): Promise<EvaluationLaunchSpec>;
  parseEvent(line: string): EvaluationEvent | undefined;
}

export interface AgentTargetAdapter {
  descriptor: TargetDescriptor;
  detectInstallation(input: TargetInstallationInput): Promise<TargetInstallationResult>;
  createTargetPaths(input: TargetPathInput): TargetPaths;
  skills: {
    readNativeState(targetPaths: TargetPaths): Promise<SkillRuntimeNativeState>;
    inspectRuntime(targetPaths: TargetPaths): Promise<SkillRuntimeSnapshot>;
  };
  projects?: AgentProjectCapability;
  conversations?: AgentConversationCapability;
  evaluations?: AgentEvaluationCapability;
  createDefaultProfile(id: string): Omit<ProfileDetail, "profileDir">;
  captureProfile(targetPaths: TargetPaths): Promise<CapturedTargetProfile>;
  createPreview(input: TargetPreviewInput): Promise<TargetActivationPreview>;
  validateAssets(input: TargetAssetInput): Promise<ApplyIssue[]>;
  getAssetBackupPaths(input: TargetAssetInput): Promise<string[]>;
  applyAssets(input: TargetAssetInput): Promise<void>;
}
