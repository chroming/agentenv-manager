import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMap, parseDocument } from "yaml";
import { supportsManualSkillInvocation, type SkillInvocationMode } from "../shared/skillInvocation";
import { hashSkillContent } from "./skillContentHash";

export const manualInvocationContent = (content: string): string => {
  const match = content.match(/^---[\t ]*\r?\n([\s\S]*?)\r?\n---(?:[\t ]*\r?\n|[\t ]*$)/);
  if (!match) throw new Error("Manual invocation requires a valid SKILL.md frontmatter mapping");
  const document = parseDocument(match[1]);
  if (document.errors.length || !isMap(document.contents)) {
    throw new Error("Manual invocation requires a valid SKILL.md frontmatter mapping");
  }
  if (document.get("disable-model-invocation") === true && document.get("user-invocable") !== false) return content;
  document.set("disable-model-invocation", true);
  // An author may have hidden the slash command; manual-only must remain usable.
  if (document.get("user-invocable") === false) document.set("user-invocable", true);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  return `---${newline}${document.toString().replace(/\r?\n/g, newline)}---${newline}${content.slice(match[0].length)}`;
};

export const skillInvocationOverrides = async (
  sourceDir: string,
  targetId: string,
  mode?: SkillInvocationMode
): Promise<ReadonlyMap<string, Buffer>> => {
  if (mode !== "manual") return new Map();
  if (!supportsManualSkillInvocation(targetId)) {
    throw new Error("This Agent does not support manual-only Skills. Choose Default invocation or turn off the Skill before Apply.");
  }
  return new Map([["SKILL.md", Buffer.from(manualInvocationContent(await readFile(join(sourceDir, "SKILL.md"), "utf8")))]]);
};

export const hashInvokedSkill = async (sourceDir: string, targetId: string, mode?: SkillInvocationMode) =>
  hashSkillContent(sourceDir, { fileOverrides: await skillInvocationOverrides(sourceDir, targetId, mode) });

export const writeSkillInvocationOverrides = async (staging: string, overrides: ReadonlyMap<string, Buffer>) => {
  for (const [path, content] of overrides) await writeFile(join(staging, path), content);
};
