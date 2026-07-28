import type { DiagnosticIssueDetail } from "../shared/types";

const remoteErrorPrefix = /^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i;
const referencePattern = /\n?Diagnostic reference:\s*(AEM-[A-Z0-9-]+)/i;

export const parseDiagnosticErrorMessage = (message: string) => {
  const reference = message.match(referencePattern)?.[1];
  return {
    reference,
    message: message
      .replace(remoteErrorPrefix, "")
      .replace(referencePattern, "")
      .trim()
  };
};

export const formatDiagnosticIssue = (issue: DiagnosticIssueDetail): string => {
  const lines = [
    "AgentEnv Manager diagnostic issue",
    `Reference: ${issue.reference}`,
    `Action: ${issue.action}`,
    `Time: ${issue.occurredAt}`,
    issue.durationMs === undefined ? undefined : `Duration: ${issue.durationMs} ms`,
    issue.context ? `Context:\n${JSON.stringify(issue.context, null, 2)}` : undefined,
    "",
    `${issue.error.name}: ${issue.error.message}`,
    issue.error.code ? `Code: ${issue.error.code}` : undefined,
    issue.error.errno === undefined ? undefined : `Errno: ${issue.error.errno}`,
    issue.error.stack ? `Stack:\n${issue.error.stack}` : undefined
  ].filter((line): line is string => line !== undefined);
  for (const [index, cause] of issue.error.causes.entries()) {
    lines.push(
      "",
      `Cause ${index + 1}: ${cause.name}: ${cause.message}`,
      ...(cause.code ? [`Code: ${cause.code}`] : []),
      ...(cause.errno === undefined ? [] : [`Errno: ${cause.errno}`]),
      ...(cause.stack ? [`Stack:\n${cause.stack}`] : [])
    );
  }
  return lines.join("\n");
};
