const secretKeyPattern = /(api[_-]?key|token|secret|password|authorization)/i;
const envReferencePattern = /(_env_var|env_vars?)$/i;
const assignmentPattern = /([A-Za-z_][\w-]*)\s*=\s*"([^"]+)"/g;
const sensitiveValuePattern = /^(Bearer\s+|sk-[A-Za-z0-9_-]{12,})/i;

export const findSecretWarnings = (content: string): string[] => {
  const warnings = new Set<string>();

  for (const match of content.matchAll(assignmentPattern)) {
    const [, key, value] = match;

    if (envReferencePattern.test(key)) {
      continue;
    }

    const keyLooksSensitive = secretKeyPattern.test(key);
    const valueLooksSensitive =
      value.length >= 24 && (sensitiveValuePattern.test(value) || keyLooksSensitive);

    if (valueLooksSensitive) {
      warnings.add(`Possible literal secret in profile content: ${key}`);
    }
  }

  return Array.from(warnings);
};
