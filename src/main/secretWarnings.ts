import * as TOML from "@iarna/toml";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parseDocument } from "yaml";

const secretKeyPattern = /(?:^|[_-])(api[_-]?key|access[_-]?key|auth(?:orization)?|credential|password|private[_-]?key|secret|token)(?:$|[_-])/i;
const referenceKeyPattern = /(?:_env_var|env_vars?|key_ref|secret_key_ref|value_from|_file|_path)$/i;
const environmentReferencePattern = /^(?:\$\{?[A-Z_][A-Z0-9_]*\}?|\{env:[A-Z_][A-Z0-9_]*\}|[A-Z_][A-Z0-9_]*)$/;
const knownSecretValuePattern = /^(?:Bearer\s+|sk-[A-Za-z0-9_-]{12,}|gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[A-Z0-9]{16})/i;
const privateKeyBlockPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const redactedValue = "<redacted>";

const normalizeKey = (key: string) => key.trim().replace(/^['"]|['"]$/g, "");
const canonicalKey = (key: string) =>
  normalizeKey(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

const isEnvironmentReference = (key: string, value: string) =>
  referenceKeyPattern.test(canonicalKey(key)) || environmentReferencePattern.test(value.trim());

const looksSensitive = (key: string, value: string) => {
  const normalizedKey = normalizeKey(key);
  const normalizedValue = value.trim();
  if (!normalizedValue || normalizedValue === redactedValue) return false;
  if (isEnvironmentReference(normalizedKey, normalizedValue)) return false;
  return secretKeyPattern.test(canonicalKey(normalizedKey)) || knownSecretValuePattern.test(normalizedValue);
};

const visitObject = (
  value: unknown,
  onValue: (key: string, value: string) => void
) => {
  if (Array.isArray(value)) {
    for (const entry of value) visitObject(entry, onValue);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") onValue(key, entry);
    else visitObject(entry, onValue);
  }
};

const parsedDocuments = (content: string): unknown[] => {
  const documents: unknown[] = [];
  const jsonErrors: ParseError[] = [];
  const jsonValue = parseJsonc(content, jsonErrors, { allowTrailingComma: true });
  if (jsonErrors.length === 0 && jsonValue !== undefined) documents.push(jsonValue);

  try {
    documents.push(TOML.parse(content));
  } catch {
    // The same content is intentionally tried against every supported Profile format.
  }

  try {
    const document = parseDocument(content);
    if (document.errors.length === 0) documents.push(document.toJS());
  } catch {
    // Free-form Instructions are expected to fail structured parsing.
  }
  return documents;
};

const collectTextAssignments = (
  content: string,
  onValue: (key: string, value: string) => void
) => {
  const quotedAssignments = /(?:^|[{,\s])['"]?([A-Za-z_][\w.-]*)['"]?\s*[:=]\s*(["'])((?:\\.|(?!\2).)*)\2/gm;
  for (const match of content.matchAll(quotedAssignments)) {
    onValue(match[1], match[3]);
  }

  const plainAssignments = /^\s*['"]?([A-Za-z_][\w.-]*)['"]?\s*[:=]\s*([^#\r\n,}\]]+)\s*(?:#.*)?$/gm;
  for (const match of content.matchAll(plainAssignments)) {
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    onValue(match[1], value);
  }
};

export const findSecretWarnings = (content: string): string[] => {
  const warnings = new Set<string>();
  const inspect = (key: string, value: string) => {
    if (looksSensitive(key, value)) {
      warnings.add(`Possible literal secret in profile content: ${normalizeKey(key)}`);
    }
  };

  for (const document of parsedDocuments(content)) visitObject(document, inspect);
  collectTextAssignments(content, inspect);
  if (privateKeyBlockPattern.test(content)) {
    warnings.add("Possible literal secret in profile content: private_key");
  }
  privateKeyBlockPattern.lastIndex = 0;
  return Array.from(warnings);
};

const redactQuotedAssignments = (content: string, quote: "\"" | "'") => {
  const valuePattern = quote === "\"" ? "((?:\\\\.|[^\"\\\\])*)" : "((?:\\\\.|[^'\\\\])*)";
  const pattern = new RegExp(
    `((?:[\"']?)([A-Za-z_][\\w.-]*)(?:[\"']?)\\s*[:=]\\s*)${quote}${valuePattern}${quote}`,
    "g"
  );
  return content.replace(pattern, (match, prefix: string, key: string, value: string) =>
    looksSensitive(key, value) ? `${prefix}${quote}${redactedValue}${quote}` : match
  );
};

export const redactSensitiveValues = (content: string): string => {
  let redacted = content.replace(privateKeyBlockPattern, redactedValue);
  redacted = redactQuotedAssignments(redacted, "\"");
  redacted = redactQuotedAssignments(redacted, "'");
  redacted = redacted.replace(
    /^(\s*['"]?([A-Za-z_][\w.-]*)['"]?\s*[:=]\s*)([^#\r\n,}\]]+)(\s*(?:#.*)?)$/gm,
    (match, prefix: string, key: string, value: string, suffix: string) =>
      looksSensitive(key, value) ? `${prefix}${redactedValue}${suffix}` : match
  );
  redacted = redacted.replace(
    /(\b([A-Za-z_][\w.-]*)\s*[:=]\s*)([^\s,;}\]]+)/g,
    (match, prefix: string, key: string, value: string) =>
      looksSensitive(key, value) ? `${prefix}${redactedValue}` : match
  );
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi, `Bearer ${redactedValue}`);
  redacted = redacted.replace(
    /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[A-Z0-9]{16})\b/gi,
    redactedValue
  );
  return redacted;
};
