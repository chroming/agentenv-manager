import type { BackupRetentionDays } from "./types";

export interface ConversationDeletionMetadata {
  conversationId: string;
  title: string;
  agentId: string;
  sourceKey: string;
  workspacePath?: string;
  roots: string[];
}

export interface ConversationDeletePreview {
  previewId: string;
  title: string;
  files: string[];
  sizeBytes: number;
  retentionDays: BackupRetentionDays;
  warnings: string[];
}

export type ConversationDeletionPhase = "prepared" | "deleting" | "deleted" | "restoring" | "restored";
