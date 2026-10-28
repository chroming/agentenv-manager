export class AIRequestError extends Error {
  constructor(message: string, readonly code: string, readonly requestId?: string, readonly status?: number,
    readonly retryAfterMs?: number, readonly providerCode?: string) {
    const metadata = [status && `HTTP ${status}`, requestId && `request ${requestId}`, retryAfterMs !== undefined && `retry-after ${retryAfterMs} ms`, providerCode && `code ${providerCode}`].filter(Boolean).join("; ");
    super(message, metadata ? { cause: new Error(`AI request metadata: ${metadata}`) } : undefined);
    this.name = "AIRequestError";
  }
}
const safeId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
export const responseRequestId = (response: Response) => safeId(response.headers.get("x-request-id") ?? response.headers.get("request-id"));

export function httpAIError(response: Response, body: unknown) {
  const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const rawCode = safeId(detail.code) ?? safeId(detail.type);
  // Only known machine codes are retained; provider messages can echo private input.
  const providerCode = rawCode && /^(?:insufficient_quota|quota_exceeded|rate_limit_exceeded|invalid_api_key|model_not_found|unsupported_parameter|invalid_request_error|context_length_exceeded)$/.test(rawCode) ? rawCode : undefined;
  const parameter = ["response_format", "max_tokens", "max_completion_tokens", "model"].includes(String(detail.param)) ? String(detail.param) : undefined;
  const retry = response.headers.get("retry-after");
  const delay = retry ? /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now() : undefined;
  const retryAfterMs = delay !== undefined && Number.isFinite(delay) ? Math.min(86_400_000, Math.max(0, Math.round(delay))) : undefined;
  const prefix = `AI service returned HTTP ${response.status}. `;
  let code = "AI_HTTP";
  let message = "The service could not complete the request. Retry manually.";
  if (response.status === 401) { code = "AI_AUTH"; message = "The API key was rejected. Update it in Settings > AI assistance."; }
  else if (response.status === 403) { code = "AI_PERMISSION"; message = "Access was denied. Check the API key's permissions and model access."; }
  else if (response.status === 404) { code = "AI_NOT_FOUND"; message = "Check the Chat Completions API address and model name in Settings > AI assistance, then retry."; }
  else if (response.status === 402 || providerCode === "insufficient_quota" || providerCode === "quota_exceeded") { code = "AI_QUOTA"; message = "The account has no available quota. Check billing with your provider."; }
  else if (response.status === 429) { code = "AI_RATE_LIMIT"; message = "The service is rate-limiting requests. Wait before retrying manually."; }
  else if (providerCode === "context_length_exceeded") { code = "AI_CONTEXT"; message = "The selected input exceeds this model's context limit. Use a model with a larger context window or select fewer items."; }
  else if (response.status === 400 || response.status === 422) { code = "AI_PARAMETERS"; message = parameter
    ? `The model rejected the ${parameter} parameter. Check model and API compatibility in Settings > AI assistance.`
    : "The model rejected the request parameters. Check model and API compatibility in Settings > AI assistance."; }
  else if (response.status >= 500) { code = "AI_UNAVAILABLE"; message = "The service is temporarily unavailable. Retry manually later."; }
  return new AIRequestError(prefix + message, code, responseRequestId(response), response.status, retryAfterMs, providerCode);
}
