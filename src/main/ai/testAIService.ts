import { z } from "zod";
import type { createAIJsonClient } from "./aiJsonClient";
import { decodeAIResponse, jsonObjectSchema } from "./aiResponse";

export const testAIService = async (
  credentials: { endpoint: string; key: string; model: string },
  request: ReturnType<typeof createAIJsonClient>
) => {
  const response = await request({ ...credentials, maxTokens: 64,
    system: 'Return only this JSON object: {"ok":true}.', content: "Connection test.",
    signal: AbortSignal.timeout(30_000), outputSchema: { name: "connection_test", schema: jsonObjectSchema({ ok: { type: "boolean", enum: [true] } }) } });
  try {
    const body = decodeAIResponse(response);
    if (body.responseIssues.length) throw new Error("Incomplete connection test");
    z.object({ ok: z.literal(true) }).parse(body.data);
  } catch {
    throw new Error("The service responded, but did not return the required JSON output. Check the model's JSON support.");
  }
};
