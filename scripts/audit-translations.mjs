import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const rendererRoot = resolve("src/renderer");
const i18nPath = join(rendererRoot, "i18n.tsx");
const generatedDictionaryPath = join(rendererRoot, "i18n.zhCN.generated.ts");

const listTypeScriptFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTypeScriptFiles(path));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
};

const parseSource = async (path) => ts.createSourceFile(
  path,
  await readFile(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
);

const translations = new Map();
const requiredDynamicMessages = [
  "Manage OpenCode instructions, Skills, and MCP activation.",
  "Manage Claude Code instructions and Skills.",
  "Manage Codex instructions, Skills, and MCP activation.",
  "Manage Antigravity instructions and Skills.",
  "Manage Trae CLI instructions, Skills, and MCP activation."
];
const addObjectTranslations = (object, source) => {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isStringLiteral(property.name) || ts.isNoSubstitutionTemplateLiteral(property.name)
      ? property.name.text
      : property.name.getText(source);
    if (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer)) {
      translations.set(key, property.initializer.text);
    }
  }
};
const collectDictionary = async (path, variableName) => {
  const source = await parseSource(path);
  const visitDictionary = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === variableName &&
    node.initializer &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    addObjectTranslations(node.initializer, source);
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "Object.assign" &&
    node.arguments[0]?.getText(source) === variableName &&
    node.arguments[1] &&
    ts.isObjectLiteralExpression(node.arguments[1])
  ) {
    addObjectTranslations(node.arguments[1], source);
  }
  ts.forEachChild(node, visitDictionary);
  };
  visitDictionary(source);
};
await collectDictionary(generatedDictionaryPath, "generatedZhCN");
await collectDictionary(i18nPath, "zhCN");

const usages = new Map();
const collectStrings = (node, source, file) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const locations = usages.get(node.text) ?? [];
    locations.push(`${relative(process.cwd(), file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    usages.set(node.text, locations);
    return;
  }
  ts.forEachChild(node, (child) => collectStrings(child, source, file));
};

for (const file of await listTypeScriptFiles(rendererRoot)) {
  if (file === i18nPath) continue;
  const source = await parseSource(file);
  const visitCalls = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "t" &&
      node.arguments[0]
    ) {
      collectStrings(node.arguments[0], source, file);
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(source);
}

const placeholderNames = (value) => [...value.matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();
const failures = [];
for (const [message, locations] of usages) {
  const translation = translations.get(message);
  if (translation === undefined) {
    failures.push(`Missing zh_CN translation: ${JSON.stringify(message)} (${locations[0]})`);
    continue;
  }
  if (placeholderNames(message).join(",") !== placeholderNames(translation).join(",")) {
    failures.push(`Placeholder mismatch: ${JSON.stringify(message)} (${locations[0]})`);
  }
}
for (const message of requiredDynamicMessages) {
  const translation = translations.get(message);
  if (translation === undefined || translation === message) {
    failures.push(`Missing zh_CN translation for runtime message: ${JSON.stringify(message)}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Translation audit failed:\n${failures.join("\n")}`);
}

console.log(`Translation audit passed for ${usages.size} renderer messages.`);
