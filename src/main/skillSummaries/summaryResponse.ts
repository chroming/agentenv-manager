import { z } from "zod";
import { SummarySchema } from "./summaryStore";
import { decodeAIResponse, invalidAIFields, jsonObjectSchema, parseAIItems, referencesSchema, stringSchema } from "../ai/aiResponse";

const categoryAliases = new Map<string, string>([
  ["breaking", "important"], ["breaking_change", "important"], ["breaking_changes", "important"],
  ["compatibility", "usage"], ["security_risk", "security"], ["security_risks", "security"],
  ["重要变更", "important"], ["重要變更", "important"],
  ["使用变化", "usage"], ["使用變化", "usage"],
  ["安全风险", "security"], ["安全風險", "security"], ["其他", "other"]
]);
const ItemSchema = SummarySchema.shape.items.element;
const transportItemSchema = ItemSchema.omit({ evidenceStatus: true }).extend({
    paths: z.preprocess((value) => value == null ? [] : typeof value === "string" ? [value] : value, ItemSchema.shape.paths),
    implication: z.string().max(1500).nullish().transform((value) => value ?? "")
});
export const summaryModelSchema = (ids: string[]) => ({ name: "skill_summary", schema: jsonObjectSchema({ overview: stringSchema,
  items: { type: "array", items: jsonObjectSchema({ category: { type: "string", enum: ["important", "usage", "security", "other"] },
    fact: stringSchema, implication: stringSchema, paths: referencesSchema(ids) }) }
}) });

export const parseSummaryResponse = (response: unknown, suppliedPaths: string[], aliases = new Map<string, string>()) => {
  const decoded = decodeAIResponse(response);
  const root = z.object({ overview: SummarySchema.shape.overview, items: z.array(z.unknown()) }).safeParse(decoded.data);
  if (!root.success) throw new Error(`The AI summary has invalid fields (${invalidAIFields(root.error)}). The previous summary is kept; retry manually.`);
  const normalized = root.data.items.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const item = value as Record<string, unknown>;
    const label = typeof item.category === "string" ? item.category.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
    const category = categoryAliases.get(label) ?? label;
    return { ...item, category: ["important", "usage", "security", "other"].includes(category) ? category : "unclassified" };
  });
  const parsed = parseAIItems(normalized, transportItemSchema, 30);
  const responseIssues = [...decoded.responseIssues];
  if (parsed.invalid) responseIssues.push("invalid-items");
  if (parsed.items.some((item) => item.category === "unclassified")) responseIssues.push("unclassified");
  const paths = new Set(suppliedPaths);
  const canonicalPath = (path: string) => {
    if (paths.has(path)) return path;
    let normalized = path.trim();
    if (/^`[^`]+`$/.test(normalized)) normalized = normalized.slice(1, -1);
    normalized = normalized.replace(/^(\.\/)+/, "");
    return paths.has(normalized) ? normalized : aliases.get(normalized);
  };
  const items = parsed.items.map((item) => {
    const resolved = item.paths.map(canonicalPath);
    const unverified = !resolved.length || resolved.some((path) => path === undefined || !paths.has(path));
    return {
      ...item,
      paths: [...new Set(resolved.filter((path): path is string => path !== undefined && paths.has(path)))],
      ...(unverified ? { evidenceStatus: "unverified" as const } : {})
    };
  });
  return { parsed: { overview: root.data.overview, items,
    ...(responseIssues.length ? { responseIssues, ...(parsed.invalid ? { unparsedOutput: decoded.raw } : {}) } : {}) }, usage: decoded.usage };
};
