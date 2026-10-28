import type { AIRequestPhase } from "../../shared/aiReliability";
import { aiRequestProfile, type AIOutputSchema } from "./aiRequestProfile";
import { AIRequestError, httpAIError, responseRequestId } from "./aiRequestError";

export const AI_INPUT_BYTES = 96_000;
const completionEndpoint = (endpoint: string) => {
  const url = new URL(endpoint);
  const path = url.pathname.replace(/\/+$/, "");
  // Accept common API base URLs while preserving explicit custom endpoints.
  if (!path || /\/v\d+$/.test(path)) url.pathname = `${path}/chat/completions`;
  return url.href;
};
export const createAIJsonClient = (fetchImpl: typeof fetch = fetch) => {
  let busy = false;
  return async (input: { endpoint: string; key: string; model: string; system: string; content: string; signal: AbortSignal; maxTokens?: number; outputSchema?: AIOutputSchema; onProgress?(phase: AIRequestPhase): void }) => {
    if (busy) throw new Error("Another AI request is running. Wait or cancel it first.");
    if (Buffer.byteLength(input.content) > AI_INPUT_BYTES) throw new Error("AI input exceeds the size limit. No request was sent.");
    busy = true;
    const report = (phase: AIRequestPhase) => { try { input.onProgress?.(phase); } catch { /* Feedback is best effort. */ } };
    try {
      input.signal.throwIfAborted();
      const profile = aiRequestProfile(input.endpoint, input.model, input.outputSchema);
      const body = JSON.stringify({ model: input.model, messages: [
        { role: "system", content: input.system }, { role: "user", content: input.content }
      ], [profile.tokenParameter]: input.maxTokens ?? 2500, stream: false, response_format: profile.responseFormat,
      ...(profile.thinking ? { thinking: profile.thinking } : {}) });
      if (Buffer.byteLength(body) > AI_INPUT_BYTES) throw new Error("AI input exceeds the size limit. No request was sent.");
      report("waiting");
      let response: Response;
      try {
        response = await fetchImpl(completionEndpoint(input.endpoint), {
          method: "POST", redirect: "error", signal: input.signal,
          headers: { "Content-Type": "application/json", ...(input.key ? { Authorization: `Bearer ${input.key}` } : {}) },
          body
        });
      } catch {
        if (input.signal.aborted) throw new AIRequestError(input.signal.reason?.name === "TimeoutError"
          ? "AI request timed out. Previous results are kept. A sent request may still be billed."
          : "AI request cancelled. Previous results are kept. A sent request may still be billed.", input.signal.reason?.name === "TimeoutError" ? "AI_TIMEOUT" : "AI_CANCELLED");
        throw new AIRequestError("Could not reach the AI service. Check its address and connection; retry manually.", "AI_CONNECTION");
      }
      if (!response.ok) {
        let body: unknown;
        try { body = JSON.parse((await readResponse(response, 8192, input.signal)).toString("utf8")); } catch { /* Never include raw error bodies in diagnostics. */ }
        if (input.signal.aborted) throw new AIRequestError("AI request cancelled or timed out. A sent request may still be billed.", input.signal.reason?.name === "TimeoutError" ? "AI_TIMEOUT" : "AI_CANCELLED", responseRequestId(response));
        throw httpAIError(response, body);
      }
      report("receiving");
      let received: Buffer;
      try {
        received = await readResponse(response, 128_000, input.signal);
      } catch (error) {
        if (error instanceof AIRequestError) throw error;
        throw new AIRequestError(input.signal.aborted ? "AI request cancelled or timed out. A sent request may still be billed."
          : "The AI connection was interrupted while receiving the response. Previous results are kept; retry manually.",
        input.signal.aborted ? input.signal.reason?.name === "TimeoutError" ? "AI_TIMEOUT" : "AI_CANCELLED" : "AI_INTERRUPTED", responseRequestId(response));
      }
      input.signal.throwIfAborted();
      report("parsing");
      try { return JSON.parse(received.toString("utf8")) as unknown; }
      catch { throw new AIRequestError("AI service returned invalid JSON. Retry manually.", "AI_RESPONSE_JSON", responseRequestId(response)); }
    } finally { busy = false; }
  };
};

async function readResponse(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new AIRequestError("AI service returned an empty response.", "AI_EMPTY", responseRequestId(response));
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new AIRequestError("AI response exceeded the size limit.", "AI_RESPONSE_SIZE", responseRequestId(response));
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => undefined); }
}
