import type { NativeMcpConnection, NativeMcpScope } from "../../shared/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const nativeMcpTransport = (value: Record<string, unknown>) => {
  const type =
    typeof value.type === "string" ? value.type.toLowerCase() : undefined;
  if (typeof value.command === "string" || Array.isArray(value.command)) {
    return "stdio" as const;
  }
  if (typeof value.url === "string" || typeof value.serverUrl === "string") {
    return type === "sse" ? ("sse" as const) : ("http" as const);
  }
  return undefined;
};

export const captureNativeJsonMcpConnections = (
  value: unknown,
  options: {
    targetId: string;
    sourcePath: string;
    scope?: NativeMcpScope;
    controllable: boolean;
  }
): NativeMcpConnection[] => {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter(([, raw]) => isRecord(raw))
    .map(([name, raw]) => ({
      targetId: options.targetId,
      name,
      scope: options.scope ?? "user",
      transport: nativeMcpTransport(raw as Record<string, unknown>),
      enabled:
        (raw as Record<string, unknown>).enabled !== false &&
        (raw as Record<string, unknown>).disabled !== true,
      controllable: options.controllable,
      sourcePath: options.sourcePath
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
};
