import { z } from "zod";
import { decodeAIResponse, invalidAIFields, jsonObjectSchema, parseAIItems, referencesSchema, resultQualityShape, stringSchema } from "./aiResponse";

const findingSchema = z.object({
    category: z.enum(["observation", "suggestion", "risk", "unclassified"]),
    title: z.string().max(120).optional(), detail: z.string().min(1).max(1600),
    suggestion: z.string().max(1600).nullish().transform((value) => value ?? ""),
    evidence: z.preprocess((value) => typeof value === "string" ? [value] : value ?? [], z.array(z.string().max(256)).max(12)),
    evidenceStatus: z.literal("unverified").optional()
});
export const analysisOutputSchema = z.object({
  overview: z.string().min(1).max(1600), findings: z.array(findingSchema).max(20),
  limitations: z.array(z.string().max(800)).max(10).default([]), ...resultQualityShape
});
export const analysisModelSchema = (ids: string[]) => ({ name: "analysis", schema: jsonObjectSchema({
  overview: stringSchema, findings: { type: "array", items: jsonObjectSchema({
    category: { type: "string", enum: ["observation", "suggestion", "risk"] }, title: { type: ["string", "null"] },
    detail: stringSchema, suggestion: stringSchema, evidence: referencesSchema(ids)
  }) }, limitations: { type: "array", items: stringSchema }
}) });

export function parseAnalysisResponse(response: unknown, ids: string[], aliases = new Map<string, string>()) {
  const decoded = decodeAIResponse(response);
  const root = z.object({ overview: analysisOutputSchema.shape.overview, findings: z.array(z.unknown()), limitations: z.unknown().optional() }).safeParse(decoded.data);
  if (!root.success) throw new Error(`AI analysis has invalid fields (${invalidAIFields(root.error)}). Previous results are kept; retry manually.`);
  const normalized = root.data.findings.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const item = value as Record<string, unknown>;
    const category = typeof item.category === "string" ? item.category.trim().toLowerCase() : "";
    return { ...item, title: item.title ?? undefined, category: ["observation", "suggestion", "risk"].includes(category) ? category : "unclassified" };
  });
  const parsed = parseAIItems(normalized, findingSchema.omit({ evidenceStatus: true }), 20);
  const limitations = analysisOutputSchema.shape.limitations.safeParse(root.data.limitations ?? []);
  const responseIssues = [...decoded.responseIssues];
  if (parsed.invalid || !limitations.success) responseIssues.push("invalid-items");
  if (parsed.items.some((item) => item.category === "unclassified")) responseIssues.push("unclassified");
  const allowed = new Set(ids);
  return { overview: root.data.overview, findings: parsed.items.map((finding) => {
    const references = finding.evidence.map((id) => id.trim().replace(/^`([^`]+)`$/, "$1"));
    const mapped = references.map((id) => allowed.has(id) ? id : aliases.get(id));
    const evidence = [...new Set(mapped.filter((id): id is string => id !== undefined && allowed.has(id)))];
    const unverified = !references.length || mapped.some((id) => id === undefined || !allowed.has(id));
    return { ...finding, evidence, ...(unverified ? { evidenceStatus: "unverified" as const } : {}) };
  }), limitations: limitations.success ? limitations.data : [],
    ...(responseIssues.length ? { responseIssues, ...(parsed.invalid || !limitations.success ? { unparsedOutput: decoded.raw } : {}) } : {}) };
}
