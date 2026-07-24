import type {
  ApplyIssue,
  ConversationDetail,
  ConversationDetailState,
  NativeMcpConnection,
  ProfileDetail,
  TargetActivationPreview,
  TargetDescriptor,
  TargetInstallationEvidence,
  TargetPaths,
  SkillRuntimeNativeState,
  SkillRuntimeSnapshot
} from "../../shared/types";

export interface TargetPathInput {
  homeDir: string;
  fakeHomeRoot?: string;
  rootDirOverride?: string;
}

export interface TargetAssetInput {
  profile: ProfileDetail;
  targetPaths: TargetPaths;
  skillLibraryDir?: string;
  skillSyncMethod?: "symlink" | "copy" | "auto";
  approvedUnmanagedSkillHashes?: ReadonlyMap<string, string>;
  replaceablePaths?: ReadonlySet<string>;
  plannedResourceRemovals?: ReadonlySet<string>;
  isolateSkillRoot?: boolean;
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
}

export interface TargetInstallationResult {
  found: boolean;
  evidence: TargetInstallationEvidence[];
}

export interface AgentConversationCandidate {
  sourceId: string;
  sourceVersion: string;
  sourceLocator: string;
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
  executablePath?: string;
  targetPaths: TargetPaths;
}

export interface ConversationLaunchSpec {
  executablePath: string;
  args: string[];
  cwd?: string;
}

export interface ConversationContinuationInput extends AgentConversationContext {
  conversation: ConversationDetail;
  contextFilePath: string;
}

export interface AgentConversationCapability {
  discover(context: AgentConversationContext): Promise<AgentConversationCandidate[]>;
  read(
    context: AgentConversationContext,
    candidate: AgentConversationCandidate
  ): Promise<ConversationDetail>;
  openOriginal?(
    context: AgentConversationContext,
    candidate: AgentConversationCandidate
  ): ConversationLaunchSpec | undefined;
  continueWithContext?(
    input: ConversationContinuationInput
  ): ConversationLaunchSpec | undefined;
}

export interface AgentTargetAdapter {
  descriptor: TargetDescriptor;
  detectInstallation(input: TargetInstallationInput): Promise<TargetInstallationResult>;
  createTargetPaths(input: TargetPathInput): TargetPaths;
  skills: {
    readNativeState(targetPaths: TargetPaths): Promise<SkillRuntimeNativeState>;
    inspectRuntime(targetPaths: TargetPaths): Promise<SkillRuntimeSnapshot>;
  };
  conversations?: AgentConversationCapability;
  createDefaultProfile(id: string): Omit<ProfileDetail, "profileDir">;
  captureProfile(targetPaths: TargetPaths): Promise<CapturedTargetProfile>;
  createPreview(input: TargetPreviewInput): Promise<TargetActivationPreview>;
  validateAssets(input: TargetAssetInput): Promise<ApplyIssue[]>;
  getAssetBackupPaths(input: TargetAssetInput): Promise<string[]>;
  applyAssets(input: TargetAssetInput): Promise<void>;
}
