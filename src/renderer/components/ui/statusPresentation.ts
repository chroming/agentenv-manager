export type SemanticStatusKind =
  | "neutral"
  | "working"
  | "update-available"
  | "changes-available"
  | "warning"
  | "error";

export type SemanticStatusTone = "neutral" | "accent" | "warning" | "danger";

const statusTones: Record<SemanticStatusKind, SemanticStatusTone> = {
  neutral: "neutral",
  working: "accent",
  "update-available": "accent",
  "changes-available": "warning",
  warning: "warning",
  error: "danger"
};

export const statusToneFor = (kind: SemanticStatusKind): SemanticStatusTone =>
  statusTones[kind];
