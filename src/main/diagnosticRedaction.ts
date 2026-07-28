import type { DiagnosticErrorDetail } from "../shared/types";

const credentialPatterns: Array<[RegExp, string]> = [
  [
    /(token|authorization|password|passwd|secret|api[_-]?key|client[_-]?secret)([\s"':=]+)[^\s,"'}]+/gi,
    "$1$2[redacted]"
  ],
  [/(gh[pousr]_[A-Za-z0-9_]{20,})/g, "[redacted-github-token]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[redacted]"],
  [/(Basic\s+)[A-Za-z0-9+/=]+/gi, "$1[redacted]"],
  [/(https?:\/\/)([^/\s:@]+):([^@/\s]+)@/gi, "$1[redacted]@"],
  [/(https?:\/\/[^\s?#]+)\?[^\s]+/gi, "$1?[redacted-query]"]
];
const credentialKeyPattern =
  /(?:token|authorization|password|passwd|secret|api[_-]?key|client[_-]?secret|credential)/i;

export const redactDiagnosticText = (
  value: string,
  homeDir: string,
  maxLength = 32 * 1024
): string => {
  let redacted = homeDir ? value.replaceAll(homeDir, "~") : value;
  for (const [pattern, replacement] of credentialPatterns) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.length > maxLength
    ? `${redacted.slice(0, maxLength)}\n[truncated]`
    : redacted;
};

const errorScalar = (value: unknown): string | number | undefined =>
  typeof value === "string" || typeof value === "number" ? value : undefined;

const errorPart = (error: unknown, homeDir: string) => {
  const candidate = error && typeof error === "object"
    ? error as Record<string, unknown>
    : undefined;
  const name = error instanceof Error
    ? error.name
    : typeof candidate?.name === "string"
      ? candidate.name
      : "Error";
  const message = error instanceof Error
    ? error.message
    : typeof candidate?.message === "string"
      ? candidate.message
      : String(error);
  const stack = error instanceof Error
    ? error.stack
    : typeof candidate?.stack === "string"
      ? candidate.stack
      : undefined;
  return {
    name: redactDiagnosticText(name, homeDir),
    message: redactDiagnosticText(message, homeDir, 8 * 1024),
    code: errorScalar(candidate?.code),
    errno: errorScalar(candidate?.errno),
    stack: stack ? redactDiagnosticText(stack, homeDir, 32 * 1024) : undefined,
    cause: candidate?.cause
  };
};

export const sanitizeDiagnosticError = (
  error: unknown,
  homeDir: string
): DiagnosticErrorDetail => {
  const root = errorPart(error, homeDir);
  const causes: DiagnosticErrorDetail["causes"] = [];
  const visited = new Set<unknown>([error]);
  let cause = root.cause;
  while (cause !== undefined && cause !== null && causes.length < 4 && !visited.has(cause)) {
    visited.add(cause);
    const part = errorPart(cause, homeDir);
    causes.push({
      name: part.name,
      message: part.message,
      code: typeof part.code === "string" ? part.code : undefined,
      errno: part.errno,
      stack: part.stack
    });
    cause = part.cause;
  }
  return {
    name: root.name,
    message: root.message,
    code: typeof root.code === "string" ? root.code : undefined,
    errno: root.errno,
    stack: root.stack,
    causes
  };
};

export const sanitizeDiagnosticValue = (
  value: unknown,
  homeDir: string,
  depth = 0
): unknown => {
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") return redactDiagnosticText(value, homeDir, 8 * 1024);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeDiagnosticValue(item, homeDir, depth + 1));
  }
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 80)
      .map(([key, item]) => [
        key,
        credentialKeyPattern.test(key)
          ? "[redacted]"
          : sanitizeDiagnosticValue(item, homeDir, depth + 1)
      ])
      .filter((entry) => entry[1] !== undefined)
  );
};
