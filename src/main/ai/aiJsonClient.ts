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
  return async (input: { endpoint: string; key: string; model: string; system: string; content: string; signal: AbortSignal; maxTokens?: number }) => {
    if (busy) throw new Error("Another AI request is running. Wait or cancel it first.");
    if (Buffer.byteLength(input.content) > AI_INPUT_BYTES) throw new Error("AI input exceeds the size limit. No request was sent.");
    busy = true;
    try {
      let response: Response;
      try {
        response = await fetchImpl(completionEndpoint(input.endpoint), {
          method: "POST", redirect: "error", signal: input.signal,
          headers: { "Content-Type": "application/json", ...(input.key ? { Authorization: `Bearer ${input.key}` } : {}) },
          body: JSON.stringify({ model: input.model, messages: [
            { role: "system", content: input.system }, { role: "user", content: input.content }
          ], max_tokens: input.maxTokens ?? 2500, stream: false, response_format: { type: "json_object" },
          // V4 defaults to thinking, which shares the bounded output budget.
          ...(new URL(input.endpoint).hostname === "api.deepseek.com" && /^deepseek-v4-(flash|pro)(?:-|$)/.test(input.model)
            ? { thinking: { type: "disabled" } } : {}) })
        });
      } catch {
        throw new Error(input.signal.aborted ? "AI request cancelled or timed out. A sent request may still be billed." : "Could not reach the AI service. Check its address and connection; retry manually.");
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) throw new Error("AI service returned HTTP 404. Check the Chat Completions API address and model name in Settings > AI assistance, then retry.");
        throw new Error(`AI service returned HTTP ${response.status}. Check your API configuration or quota; retry manually.`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("AI service returned an empty response.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 128_000) throw new Error("AI response exceeded the size limit.");
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      input.signal.throwIfAborted();
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
      catch { throw new Error("AI service returned invalid JSON. Retry manually."); }
    } finally { busy = false; }
  };
};
